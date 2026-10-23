import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { BrokerProfile, RiskConfig } from '../config/schemas';
import { computeStats, goLiveGates, groupStats, sessionOf } from '../core/stats';
import type { TradingCore } from '../core/TradingCore';
import type { Feed } from '../feed/types';
import type { Journal } from '../journal/Journal';
import { dir } from '../types';
import { log } from '../util/log';
import { dayKey } from '../util/time';
import type { CandleDTO, JournalDTO, StateDTO } from './types';

export interface DashboardDeps {
  core: TradingCore;
  journal: Journal;
  /** Shadow journal — the go-live gates are always measured on shadow results. */
  shadowJournal: Journal;
  feed: Feed;
  profile: BrokerProfile;
  risk: RiskConfig;
  startBalance: number;
  feedKind: StateDTO['feed'];
  port: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function buildState(d: DashboardDeps): StateDTO {
  const snap = d.core.snapshot();
  const now = snap.quote?.time ?? new Date();
  const day = dayKey(now, d.profile.dayResetUtcHour);
  const dayStats = d.journal.dayStats(day);
  const todayTrades = d.journal.closedTrades(`${day}T00:00:00.000Z`, new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000).toISOString());
  const lastSl = d.journal.lastSlAt();
  const sinceSl = lastSl ? (now.getTime() - lastSl.getTime()) / 60_000 : Infinity;
  const q = snap.quote;
  const zoneStatus = new Map(snap.zones.map((z) => [z.zone.id, z]));

  return {
    mode: snap.mode,
    symbol: d.profile.symbol,
    broker: `${d.profile.broker} · ${d.profile.account}`,
    serverTime: now.toISOString(),
    feed: q ? d.feedKind : 'connecting',
    quote: q ? { time: q.time.toISOString(), bid: q.bid, ask: q.ask, spread: r2(q.ask - q.bid) } : null,
    account: snap.account ? { balance: snap.account.balance, equity: snap.account.equity, startBalance: d.startBalance } : null,
    killed: snap.killed,
    session: sessionOf(now.toISOString()),
    today: {
      date: day,
      ...dayStats,
      pnlUsd: r2(todayTrades.reduce((a, t) => a + (t.pnl ?? 0), 0)),
      r: r2(todayTrades.reduce((a, t) => a + (t.r ?? 0), 0)),
    },
    limits: {
      fixedLot: d.risk.fixedLot,
      maxSlPts: d.risk.maxSlPts,
      dailyLossUsd: d.risk.dailyLossUsd,
      dailyMaxLosses: d.risk.dailyMaxLosses,
      maxTradesPerDay: d.risk.maxTradesPerDay,
      maxSpreadPts: d.risk.maxSpreadPts,
      equityFloorUsd: d.risk.equityFloorUsd,
      maxOpenPositions: d.risk.maxOpenPositions,
      slCooldownMin: d.risk.slCooldownMin,
    },
    cooldownLeftMin: sinceSl < d.risk.slCooldownMin ? Math.ceil(d.risk.slCooldownMin - sinceSl) : null,
    positions: d.core.positions().map((p) => {
      const mark = q ? (p.side === 'BUY' ? q.bid : q.ask) : p.openPrice;
      return { id: p.id, side: p.side, lot: p.lot, openPrice: p.openPrice, sl: p.sl, tp: p.tp, zoneId: p.zoneId, pnl: r2((mark - p.openPrice) * dir(p.side) * p.lot * d.profile.contractSize) };
    }),
    news: {
      available: snap.news.available,
      next: snap.news.windows
        .filter((w) => w.end >= now)
        .sort((a, b) => a.start.getTime() - b.start.getTime())
        .slice(0, 3)
        .map((w) => ({ title: w.title, start: w.start.toISOString(), end: w.end.toISOString() })),
    },
    plan: snap.plan
      ? {
          date: snap.plan.plan.date,
          bias: snap.plan.plan.bias,
          refSpot: snap.plan.plan.refSpot,
          gcRef: snap.plan.plan.gcRef,
          basis: snap.plan.plan.basis,
          expectedMove: snap.plan.plan.expectedMove,
          iv: snap.plan.plan.iv,
          createdBy: snap.plan.plan.createdBy,
          createdAt: snap.plan.plan.createdAt,
          notes: snap.plan.plan.notes,
          planIssues: snap.plan.planIssues,
          zones: snap.plan.zones.map((c) => {
            const st = zoneStatus.get(c.zone.id);
            return { ...c.zone, ok: c.ok, issues: c.issues, rr: c.rr, slDistance: c.slDistance, status: st?.status ?? 'disabled', note: st?.note ?? '' };
          }),
        }
      : null,
    stats: computeStats(d.journal.closedTrades()),
    gates: goLiveGates(computeStats(d.shadowJournal.closedTrades()), d.risk.goLive),
    decisions: d.journal.recentDecisions(20),
    events: d.journal.recentEvents(20),
  };
}

export function buildJournal(d: DashboardDeps, from?: string, to?: string, trigger?: string): JournalDTO {
  let trades = d.journal.closedTrades(from, to);
  if (trigger) trades = trades.filter((t) => t.strategy === `zone-${trigger}`);
  const spreads = trades.map((t) => t.spread_open);
  return {
    trades: [...trades].reverse(),
    stats: computeStats(trades),
    byTrigger: groupStats(trades, (t) => t.strategy.replace('zone-', '')),
    bySession: groupStats(trades, (t) => sessionOf(t.open_time)),
    rejects: d.journal.rejectCounts(from ?? '0000'),
    avgSpread: spreads.length ? Math.round((spreads.reduce((a, b) => a + b, 0) / spreads.length) * 1000) / 1000 : null,
  };
}

export async function startDashboard(d: DashboardDeps) {
  const app = Fastify({ logger: false });
  const dist = resolve('web/dist');
  if (existsSync(dist)) await app.register(fastifyStatic, { root: dist });
  else app.get('/', async () => 'web/dist not built — run `npm run web:build`');

  let candleCache: { at: number; rows: CandleDTO[] } | null = null;

  app.get('/api/state', async () => buildState(d));
  app.get<{ Querystring: { from?: string; to?: string; trigger?: string } }>('/api/journal', async (req) =>
    buildJournal(d, req.query.from, req.query.to, req.query.trigger),
  );
  app.get('/api/candles', async () => {
    if (!candleCache || Date.now() - candleCache.at > 60_000) {
      const bars = await d.feed.history(300).catch(() => []);
      candleCache = { at: Date.now(), rows: bars.map((b) => ({ time: Math.floor(b.time.getTime() / 1000), open: b.open, high: b.high, low: b.low, close: b.close })) };
    }
    return candleCache.rows;
  });
  app.post<{ Body: { reason?: string } }>('/api/kill', async (req) => {
    await d.core.kill(`dashboard: ${req.body?.reason ?? 'manual'}`);
    return { ok: true };
  });
  app.get('/api/stream', (req, reply) => {
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    const push = () => reply.raw.write(`data: ${JSON.stringify(buildState(d))}\n\n`);
    push();
    const timer = setInterval(push, 2000);
    const onEvent = () => push();
    for (const e of ['open', 'close', 'kill', 'plan', 'decision']) d.core.on(e, onEvent);
    req.raw.on('close', () => {
      clearInterval(timer);
      for (const e of ['open', 'close', 'kill', 'plan', 'decision']) d.core.off(e, onEvent);
    });
  });

  await app.listen({ host: '127.0.0.1', port: d.port });
  log.info(`dashboard on http://localhost:${d.port}`);
  return app;
}
