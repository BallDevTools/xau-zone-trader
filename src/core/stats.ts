import type { RiskConfig } from '../config/schemas';
import type { TradeRow } from '../journal/Journal';

export interface Stats {
  setups: number;
  wins: number;
  losses: number;
  winRate: number;
  totalR: number;
  expectancyR: number;
  profitFactor: number | null;
  avgWinR: number;
  avgLossR: number;
  maxDrawdownR: number;
  pnlUsd: number;
  /** Cumulative R after each trade (for the equity curve). */
  curve: number[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function computeStats(trades: TradeRow[]): Stats {
  const rs = trades.filter((t) => t.r !== null).map((t) => t.r as number);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r <= 0);
  const sumW = wins.reduce((a, b) => a + b, 0);
  const sumL = -losses.reduce((a, b) => a + b, 0);
  let cum = 0;
  let peak = 0;
  let maxDd = 0;
  const curve: number[] = [];
  for (const r of rs) {
    cum += r;
    curve.push(r2(cum));
    peak = Math.max(peak, cum);
    maxDd = Math.max(maxDd, peak - cum);
  }
  return {
    setups: rs.length,
    wins: wins.length,
    losses: losses.length,
    winRate: rs.length ? r2((wins.length / rs.length) * 100) / 100 : 0,
    totalR: r2(cum),
    expectancyR: rs.length ? r2(cum / rs.length) : 0,
    profitFactor: sumL > 0 ? r2(sumW / sumL) : null,
    avgWinR: wins.length ? r2(sumW / wins.length) : 0,
    avgLossR: losses.length ? r2(-sumL / losses.length) : 0,
    maxDrawdownR: r2(maxDd),
    pnlUsd: r2(trades.reduce((a, t) => a + (t.pnl ?? 0), 0)),
    curve,
  };
}

export interface GateItem {
  label: string;
  value: string;
  rule: string;
  pass: boolean;
}

export function goLiveGates(s: Stats, cfg: RiskConfig['goLive']): { pass: boolean; items: GateItem[] } {
  const items: GateItem[] = [
    { label: 'Setups', value: `${s.setups} / ${cfg.minSetups}`, rule: `≥ ${cfg.minSetups} in shadow`, pass: s.setups >= cfg.minSetups },
    { label: 'Win rate', value: `${(s.winRate * 100).toFixed(1)}%`, rule: `≥ ${cfg.minWinRate * 100}%`, pass: s.winRate >= cfg.minWinRate },
    { label: 'Expectancy', value: `${s.expectancyR >= 0 ? '+' : ''}${s.expectancyR.toFixed(2)}R`, rule: `≥ +${cfg.minExpectancyR}R after spread`, pass: s.expectancyR >= cfg.minExpectancyR },
    { label: 'Max drawdown', value: `−${s.maxDrawdownR.toFixed(2)}R`, rule: `≤ ${cfg.maxDrawdownR}R`, pass: s.maxDrawdownR <= cfg.maxDrawdownR },
  ];
  return { pass: items.every((i) => i.pass), items };
}

export function groupStats<K extends string>(trades: TradeRow[], key: (t: TradeRow) => K): Record<string, Stats> {
  const groups: Record<string, TradeRow[]> = {};
  for (const t of trades) (groups[key(t)] ??= []).push(t);
  return Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, computeStats(v)]));
}

/** London 07–12, New York 12–21, Asia otherwise (UTC). */
export function sessionOf(iso: string): 'asia' | 'london' | 'newyork' {
  const h = new Date(iso).getUTCHours();
  return h >= 7 && h < 12 ? 'london' : h >= 12 && h < 21 ? 'newyork' : 'asia';
}
