import { ShadowBroker } from '../broker/ShadowBroker';
import type { BrokerProfile, RiskConfig } from '../config/schemas';
import { TradingCore } from '../core/TradingCore';
import { computeStats, groupStats, sessionOf } from '../core/stats';
import type { Stats } from '../core/stats';
import { CsvBarFeed, SpreadModel } from '../feed/CsvBarFeed';
import { Journal } from '../journal/Journal';
import { NoNews } from '../news/calendar';
import type { PlanSource } from '../plan/validator';
import type { Bar } from '../types';
import { dayKey } from '../util/time';

export interface BacktestOptions {
  profile: BrokerProfile;
  risk: RiskConfig;
  bars: string | Bar[];
  plans: PlanSource;
  spreads: SpreadModel;
  from?: Date;
  to?: Date;
  dbPath?: string;
}

export interface BacktestResult {
  bars: number;
  stats: Stats;
  byTrigger: Record<string, Stats>;
  bySession: Record<string, Stats>;
  rejects: { code: string; n: number }[];
  endBalance: number;
  journal: Journal;
}

/**
 * Replays saved daily plans over M1 history with the exact live components
 * (TradingCore + Gateway + ShadowBroker). Only days that have a plan file can trade.
 */
export async function runBacktest(o: BacktestOptions): Promise<BacktestResult> {
  const journal = new Journal(o.dbPath ?? ':memory:', 'backtest', (d) => dayKey(d, o.profile.dayResetUtcHour));
  const exec = new ShadowBroker(o.profile, o.risk.shadowStartBalance);
  const core = new TradingCore({
    mode: 'backtest',
    profile: o.profile,
    risk: o.risk,
    journal,
    exec,
    news: new NoNews(),
    plans: o.plans,
    barLevelFills: true,
  });
  const feed = new CsvBarFeed(o.bars, o.profile, o.spreads, { from: o.from, to: o.to });
  await feed.start({
    onQuote: (q) => core.onQuote(q),
    onBar1: (b, s) => core.onBar1(b, s),
    onBar15: (b) => core.onBar15(b),
  });
  const trades = journal.closedTrades();
  return {
    bars: feed.size,
    stats: computeStats(trades),
    byTrigger: groupStats(trades, (t) => t.strategy),
    bySession: groupStats(trades, (t) => sessionOf(t.open_time)),
    rejects: journal.rejectCounts('0000'),
    endBalance: Math.round((o.risk.shadowStartBalance + journal.realisedPnl()) * 100) / 100,
    journal,
  };
}
