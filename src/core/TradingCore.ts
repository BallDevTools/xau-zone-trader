import { EventEmitter } from 'node:events';
import type { Execution } from '../broker/types';
import type { BrokerProfile, RiskConfig } from '../config/schemas';
import type { Journal } from '../journal/Journal';
import type { NewsProvider } from '../news/calendar';
import type { Notifier } from '../notify/telegram';
import { silent } from '../notify/telegram';
import type { PlanSource, ValidatedPlan } from '../plan/validator';
import { staleCheck } from '../plan/validator';
import type { Decision } from '../risk/Gateway';
import { Gateway } from '../risk/Gateway';
import { SignalEngine } from '../signal/Engine';
import type { ZoneState } from '../signal/Engine';
import type { AccountState, Bar, ClosedTrade, Mode, NewsStatus, Quote } from '../types';
import { log } from '../util/log';
import { dayKey, minutesUntilWeekly, utcAt } from '../util/time';

export interface CoreDeps {
  mode: Mode;
  profile: BrokerProfile;
  risk: RiskConfig;
  journal: Journal;
  exec: Execution;
  news: NewsProvider;
  plans: PlanSource;
  notifier?: Notifier;
  /** Backtest/replay: SL/TP are checked per M1 bar (SL first when both are touched). */
  barLevelFills?: boolean;
  /** Live feeds: store spread samples for the backtest spread model. */
  sampleSpreads?: boolean;
}

export interface CoreSnapshot {
  mode: Mode;
  quote: Quote | null;
  account: AccountState | null;
  killed: { reason: string; at: string } | null;
  planDate: string | null;
  plan: ValidatedPlan | null;
  zones: ZoneState[];
  news: NewsStatus;
}

const SPREAD_SAMPLE_MS = 10_000;

/**
 * Wires feed → signal engine → risk gateway → execution → journal. The same object runs
 * backtest, replay, shadow and live; only the feed and the Execution differ.
 */
export class TradingCore extends EventEmitter {
  readonly gateway: Gateway;
  private quote: Quote | null = null;
  private acct: AccountState | null = null;
  private engine: SignalEngine | null = null;
  private plan: ValidatedPlan | null = null;
  private planDate: string | null = null;
  private lastSpreadSample = 0;
  private readonly notifier: Notifier;

  constructor(private readonly d: CoreDeps) {
    super();
    this.gateway = new Gateway(d.risk, d.profile);
    this.notifier = d.notifier ?? silent;
  }

  private day(t: Date) {
    return dayKey(t, this.d.profile.dayResetUtcHour);
  }

  get killed() {
    return this.d.journal.getKill();
  }

  // ── feed handlers ──

  async onQuote(q: Quote) {
    this.quote = q;
    this.record(this.d.exec.onQuote(q));
    if (this.d.exec.drainClosed) this.record(this.d.exec.drainClosed());

    if (this.d.sampleSpreads && q.time.getTime() - this.lastSpreadSample >= SPREAD_SAMPLE_MS) {
      this.lastSpreadSample = q.time.getTime();
      this.d.journal.spreadSample(q.time, Math.round((q.ask - q.bid) * 1000) / 1000);
    }

    this.acct = await this.d.exec.account(q);
    if (!this.killed && this.acct.equity < this.d.risk.equityFloorUsd)
      await this.kill(`equity $${this.acct.equity} below floor $${this.d.risk.equityFloorUsd}`, 'FLOOR');

    const { weekday, timeUtc } = this.d.profile.weekendClose;
    if (this.d.exec.positions().length && minutesUntilWeekly(q.time, weekday, timeUtc) <= this.d.risk.flatBeforeWeekendMin)
      await this.closeAll('WEEKEND');

    this.emit('quote', q);
  }

  async onBar1(bar: Bar, spread: number) {
    if (this.d.barLevelFills) this.record(this.d.exec.onBar(bar, spread));
  }

  async onBar15(bar: Bar) {
    const closeTime = new Date(bar.time.getTime() + 15 * 60_000);
    this.ensurePlan(this.day(closeTime));
    if (!this.engine || !this.plan) return;

    const signals = this.engine.onBar(bar);
    for (const s of signals) {
      const q = this.quote;
      if (!q) continue;
      const signalId = this.d.journal.signal(s.time, this.plan.plan.date, s.zoneId, s.side, s.trigger, s.sl, s.tp);
      const account = this.acct ?? (await this.d.exec.account(q));
      const decision: Decision = this.gateway.decide({
        now: q.time,
        quote: q,
        account,
        positions: this.d.exec.positions(),
        day: this.d.journal.dayStats(this.day(q.time)),
        lastSlAt: this.d.journal.lastSlAt(),
        killed: !!this.killed,
        news: this.newsStatus(q.time),
        intent: { side: s.side, sl: s.sl, tp: s.tp, zoneId: s.zoneId, planDate: this.plan.plan.date, strategy: `zone-${s.trigger}`, signalId },
      });
      this.d.journal.decision(q.time, signalId, s.zoneId, s.side, decision, account.equity);
      this.emit('decision', decision);
      if (!decision.ok) {
        log.info({ zone: s.zoneId, code: decision.code, reason: decision.reason }, 'gateway rejected');
        continue;
      }
      try {
        const intent = { side: s.side, sl: s.sl, tp: s.tp, zoneId: s.zoneId, planDate: this.plan.plan.date, strategy: `zone-${s.trigger}` };
        const pos = await this.d.exec.open(intent, decision.lot, q);
        pos.tradeId = this.d.journal.openTrade(pos);
        this.engine.markUsed(s.zoneId, `opened ${pos.side} @ ${pos.openPrice}`);
        this.notifier.send(`🟢 ${this.d.mode.toUpperCase()} ${pos.side} ${pos.lot} ${this.d.profile.symbol} @ ${pos.openPrice}\nzone ${s.zoneId} (${s.trigger}) SL ${pos.sl} TP ${pos.tp}`);
        this.emit('open', pos);
      } catch (err) {
        this.d.journal.event(q.time, 'order_error', (err as Error).message, { zone: s.zoneId });
        log.error({ err }, 'order failed');
      }
    }
  }

  // ── plan ──

  private ensurePlan(day: string) {
    if (this.planDate === day) return;
    this.planDate = day;
    this.engine = null;
    this.plan = null;
    const res = this.d.plans.load(day);
    const now = this.quote?.time ?? new Date(`${day}T00:00:00Z`);
    if (res.kind === 'missing') {
      this.d.journal.event(now, 'plan_missing', `no plan for ${day} — no trading`);
      return;
    }
    if (res.kind === 'invalid') {
      this.d.journal.savePlan(day, now, res.raw, res.errors);
      this.d.journal.event(now, 'plan_invalid', res.errors.join('; '));
      this.notifier.send(`⚠️ plan ${day} invalid: ${res.errors.join('; ')}`);
      return;
    }
    const vp = this.quote ? staleCheck(res.vp, (this.quote.bid + this.quote.ask) / 2) : res.vp;
    this.plan = vp;
    this.engine = new SignalEngine(vp);
    const issues = { plan: vp.planIssues, zones: vp.zones.filter((z) => !z.ok).map((z) => ({ id: z.zone.id, issues: z.issues })) };
    this.d.journal.savePlan(day, now, vp.plan, issues);
    const usable = vp.zones.filter((z) => z.ok).length;
    this.d.journal.event(now, 'plan_loaded', `plan ${day}: ${usable}/${vp.zones.length} zones usable`, issues);
    this.emit('plan', vp);
  }

  newsStatus(now: Date): NewsStatus {
    const base = this.d.news.status(now);
    const fromPlan = (this.plan?.plan.newsBlackout ?? []).map((w) => ({
      start: utcAt(this.plan!.plan.date, w.start),
      end: utcAt(this.plan!.plan.date, w.end),
      title: w.title,
    }));
    return { available: base.available, windows: [...base.windows, ...fromPlan] };
  }

  // ── closing & kill switch ──

  private record(closed: ClosedTrade[]) {
    for (const t of closed) {
      this.d.journal.closeTrade(t);
      const icon = t.pnl >= 0 ? '✅' : '🔴';
      this.notifier.send(`${icon} ${this.d.mode.toUpperCase()} ${t.position.side} zone ${t.position.zoneId} closed ${t.reason} @ ${t.closePrice}\n${t.r >= 0 ? '+' : ''}${t.r}R · $${t.pnl}`);
      this.emit('close', t);
    }
  }

  async closeAll(reason: ClosedTrade['reason']) {
    const q = this.quote;
    if (!q) return;
    for (const p of this.d.exec.positions()) {
      const t = await this.d.exec.close(p.id, q, reason);
      if (t) this.record([t]);
    }
  }

  async kill(reason: string, closeReason: ClosedTrade['reason'] = 'KILL') {
    const at = this.quote?.time ?? new Date();
    this.d.journal.setKill(reason, at);
    this.d.journal.event(at, 'kill', reason);
    await this.closeAll(closeReason);
    this.notifier.send(`🛑 KILL SWITCH (${this.d.mode}): ${reason}`);
    log.warn({ reason }, 'kill switch activated');
    this.emit('kill', reason);
  }

  positions() {
    return this.d.exec.positions();
  }

  snapshot(): CoreSnapshot {
    const now = this.quote?.time ?? new Date();
    return {
      mode: this.d.mode,
      quote: this.quote,
      account: this.acct,
      killed: this.killed,
      planDate: this.planDate,
      plan: this.plan,
      zones: this.engine?.states() ?? [],
      news: this.newsStatus(now),
    };
  }
}
