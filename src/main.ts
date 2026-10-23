import 'dotenv/config';
import { existsSync, rmSync } from 'node:fs';
import { runBacktest } from './backtest/run';
import { MetaApiExecution, MetaApiFeed, MetaApiSession } from './broker/metaapi';
import { ShadowBroker } from './broker/ShadowBroker';
import type { Execution } from './broker/types';
import { loadBrokerProfile, loadRiskConfig } from './config/schemas';
import type { BrokerProfile } from './config/schemas';
import { computeStats, goLiveGates } from './core/stats';
import { TradingCore } from './core/TradingCore';
import { startDashboard } from './dashboard/server';
import { CsvBarFeed, SpreadModel } from './feed/CsvBarFeed';
import { Mt5LocalFeed } from './feed/Mt5LocalFeed';
import { applyLiveSpec, diffSpec } from './feed/specSync';
import type { Feed } from './feed/types';
import { Journal } from './journal/Journal';
import { ForexFactoryNews, NoNews } from './news/calendar';
import { telegram } from './notify/telegram';
import { FilePlanSource } from './plan/validator';
import type { Mode, Position } from './types';
import { log } from './util/log';
import { dayKey } from './util/time';

const DB = 'data/trader.db';
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k!, v ?? 'true'];
  }),
);
const mode = (args.mode ?? 'shadow') as Mode;
const fail = (msg: string): never => {
  log.fatal(msg);
  process.exit(1);
};

async function main() {
  let profile = loadBrokerProfile();
  const risk = loadRiskConfig();
  const day = (d: Date) => dayKey(d, profile.dayResetUtcHour);
  const plans = new FilePlanSource(args.plans ?? 'config/plans', risk);
  const port = Number(process.env.DASHBOARD_PORT ?? 3000);
  const notifier = telegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID);

  const spreadModel = () => {
    const measured = existsSync(DB) ? new Journal(DB, 'shadow', day).hourlySpreadP75() : new Map<number, number>();
    return new SpreadModel(measured, profile.defaultSpread);
  };

  if (mode === 'backtest') {
    const data = args.data ?? fail('backtest needs --data=<M1 csv>');
    const spreads = spreadModel();
    const res = await runBacktest({
      profile, risk, bars: data, plans, spreads,
      from: args.from ? new Date(args.from) : undefined,
      to: args.to ? new Date(args.to) : undefined,
      dbPath: args.db,
    });
    const s = res.stats;
    console.log(`\nBacktest ${data} · ${res.bars} M1 bars · spread model: ${spreads.measuredHours} measured hours, default ${profile.defaultSpread}`);
    console.log('Only days with a plan file in config/plans/ can trade. Historical news is not filtered.\n');
    console.log(`setups ${s.setups} · WR ${(s.winRate * 100).toFixed(1)}% · total ${s.totalR}R · expectancy ${s.expectancyR}R · PF ${s.profitFactor ?? '—'} · max DD ${s.maxDrawdownR}R`);
    console.log(`balance $${risk.shadowStartBalance} → $${res.endBalance}`);
    for (const [k, v] of Object.entries(res.byTrigger)) console.log(`  ${k.padEnd(12)} n=${v.setups} WR ${(v.winRate * 100).toFixed(0)}% exp ${v.expectancyR}R`);
    for (const [k, v] of Object.entries(res.bySession)) console.log(`  ${k.padEnd(12)} n=${v.setups} WR ${(v.winRate * 100).toFixed(0)}% exp ${v.expectancyR}R`);
    if (res.rejects.length) console.log(`gateway rejects: ${res.rejects.map((r) => `${r.code}×${r.n}`).join(', ')}`);
    const g = goLiveGates(s, risk.goLive);
    console.log(`\ngo-live gates (backtest, informational): ${g.items.map((i) => `${i.pass ? '✓' : '✗'} ${i.label} ${i.value}`).join(' · ')}`);
    return;
  }

  let feed: Feed;
  let exec: Execution;
  let journal: Journal;
  let feedKind: 'live' | 'replay' = 'live';
  let startBalance = risk.shadowStartBalance;

  if (mode === 'replay') {
    // Demo / UI testing: replays M1 history through the full stack with a throwaway journal.
    const data = args.data ?? fail('replay needs --data=<M1 csv>');
    const path = 'data/replay.db';
    for (const f of [path, `${path}-wal`, `${path}-shm`]) rmSync(f, { force: true });
    journal = new Journal(path, 'replay', day);
    feed = new CsvBarFeed(data, profile, spreadModel(), {
      from: args.from ? new Date(args.from) : undefined,
      delayMs: Number(args.delay ?? 50),
    });
    exec = new ShadowBroker(profile, startBalance);
    feedKind = 'replay';
  } else {
    if (mode !== 'shadow' && mode !== 'live') fail(`unknown mode ${mode}`);
    // Live is refused before anything connects unless shadow results passed every go-live gate.
    if (mode === 'live') {
      const gates = goLiveGates(computeStats(new Journal(DB, 'shadow', day).closedTrades()), risk.goLive);
      if (!gates.pass) {
        for (const i of gates.items) log.error(`${i.pass ? '✓' : '✗'} ${i.label}: ${i.value} (${i.rule})`);
        fail('go-live gates not met on shadow results — live mode refused');
      }
      if (args.confirm !== 'real-money') fail('live mode places real orders: add --confirm=real-money');
    }
    // Price source: MetaAPI (cloud, no terminal needed) or a local MT5 terminal (Windows, read-only bridge).
    const source = args.feed ?? process.env.FEED ?? 'metaapi';
    if (source !== 'metaapi' && source !== 'mt5') fail(`unknown feed ${source} (metaapi | mt5)`);
    if (mode === 'live' && source !== 'metaapi') fail('live orders go through MetaAPI only — the local MT5 bridge is read-only');
    journal = new Journal(DB, mode, day);

    let session: MetaApiSession | null = null;
    if (source === 'mt5') {
      const mt5 = new Mt5LocalFeed({
        symbol: profile.symbol,
        serverUtcOffsetHours: profile.serverUtcOffsetHours,
        python: process.env.MT5_PYTHON || undefined,
        terminalPath: process.env.MT5_PATH || undefined,
      });
      await mt5.connect();
      feed = mt5;
    } else {
      const token = process.env.METAAPI_TOKEN ?? fail('METAAPI_TOKEN missing in .env');
      const accountId = process.env.METAAPI_ACCOUNT_ID ?? fail('METAAPI_ACCOUNT_ID missing in .env');
      session = new MetaApiSession(token, accountId, profile.symbol);
      await session.connect();
      feed = new MetaApiFeed(session);
    }
    const spec = feed.spec() ?? fail(`symbol ${profile.symbol} not found on the account`);
    const diffs = diffSpec(profile, spec);
    for (const df of diffs) log[df.critical ? 'error' : 'warn']({ ...df }, 'broker_profile differs from MT5 spec');
    if (diffs.some((df) => df.critical)) fail('critical spec mismatch — fix config/broker_profile.json first');
    profile = applyLiveSpec(profile, spec) as BrokerProfile;

    const openRows = journal.openTrades();
    const restored: Position[] = openRows.map((t) => ({
      id: t.position_id, side: t.side, lot: t.lot, openPrice: t.open_price, openTime: new Date(t.open_time),
      sl: t.sl, tp: t.tp, zoneId: t.zone_id, planDate: t.plan_date, strategy: t.strategy, spreadAtOpen: t.spread_open,
      mae: t.mae ?? 0, mfe: t.mfe ?? 0, tradeId: t.id,
    }));
    if (mode === 'live') {
      const live = new MetaApiExecution(session ?? fail('live needs a MetaAPI session'), profile);
      live.adopt(restored);
      exec = live;
      startBalance = (await live.account()).balance;
    } else {
      const shadow = new ShadowBroker(profile, risk.shadowStartBalance);
      shadow.restore(risk.shadowStartBalance + journal.realisedPnl(), restored);
      exec = shadow;
    }
  }

  const news =
    mode === 'replay'
      ? new NoNews()
      : new ForexFactoryNews('data/news_cache.json', risk.newsBlackoutBeforeMin, risk.newsBlackoutAfterMin);
  if (news instanceof ForexFactoryNews) {
    await news.refresh();
    setInterval(() => void news.refresh(), 6 * 3_600_000).unref();
  }

  const core = new TradingCore({
    mode, profile, risk, journal, exec, news, plans, notifier,
    barLevelFills: mode === 'replay',
    sampleSpreads: mode === 'shadow' || mode === 'live',
  });
  // Go-live gates are measured on shadow results (replay shows its own run as a demo).
  const shadowJournal = mode === 'live' ? new Journal(DB, 'shadow', day) : journal;

  await startDashboard({ core, journal, shadowJournal, feed, profile, risk, startBalance, feedKind, port });
  const killed = journal.getKill();
  if (killed) log.warn(`kill switch is ACTIVE since ${killed.at}: ${killed.reason} — run \`npm run unkill -- --mode=${mode}\` to clear`);
  notifier.send(`▶️ XAU Zone Trader started (${mode})${killed ? ' — KILL SWITCH ACTIVE' : ''}`);

  const shutdown = async () => {
    log.info('shutting down');
    await feed.stop();
    journal.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await feed.start({
    onQuote: (q) => core.onQuote(q),
    onBar1: (b, s) => core.onBar1(b, s),
    onBar15: (b) => core.onBar15(b),
  });
  if (mode === 'replay') log.info('replay finished — dashboard stays up, Ctrl+C to exit');
}

main().catch((err) => {
  log.fatal({ err }, 'fatal');
  process.exit(1);
});
