import { describe, expect, it } from 'vitest';
import { runBacktest } from '../src/backtest/run';
import { SpreadModel } from '../src/feed/CsvBarFeed';
import { parseBars } from '../src/feed/CsvBarFeed';
import { profile, risk } from './helpers';
import { basePlan, m1FromM15, MemoryPlans } from './synthetic';

const spreads = new SpreadModel(new Map(), 0.3);
const plans = new MemoryPlans({ '2026-10-21': basePlan() });
const lead: [number, number, number, number][] = [
  [4182, 4183, 4179, 4180],
  [4180, 4181, 4176, 4177],
  [4176, 4178, 4168, 4174], // BUY rejection at B1 → entry at ask 4174.3 after 08:45 close
];

describe('backtest end-to-end (core + gateway + shadow broker + journal)', () => {
  it('rejection → BUY → TP books the exact R and USD', async () => {
    const bars = m1FromM15('2026-10-21T08:00:00Z', [...lead, [4174, 4182, 4172, 4181], [4181, 4191, 4180, 4189]]);
    const res = await runBacktest({ profile, risk, bars, plans, spreads });
    const [t] = res.journal.closedTrades();
    expect(t).toMatchObject({ zone_id: 'B1', side: 'BUY', open_price: 4174.3, exit_reason: 'TP', close_price: 4190, pnl: 15.7, mae: -2.3, mfe: 15.7 });
    expect(res.stats).toMatchObject({ setups: 1, wins: 1, totalR: 1.69 });
    expect(res.endBalance).toBe(115.7);
  });

  it('SL books about −1R, then the global cooldown blocks the next signal', async () => {
    const bars = m1FromM15('2026-10-21T08:00:00Z', [
      ...lead,
      [4174, 4175, 4164, 4166], // SL 4165 hit (fill 4164.8)
      [4166, 4201, 4166, 4196],
      [4196, 4201, 4192, 4194], // SELL rejection at S1, 40 min after the SL
    ]);
    const res = await runBacktest({ profile, risk: { ...risk, slCooldownMin: 60 }, bars, plans, spreads });
    const trades = res.journal.closedTrades();
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ exit_reason: 'SL', close_price: 4164.8, pnl: -9.5, r: -1.02 });
    expect(res.rejects).toEqual([{ code: 'COOLDOWN', n: 1 }]);
  });

  it('days without a plan never trade', async () => {
    const bars = m1FromM15('2026-10-22T08:00:00Z', lead);
    const res = await runBacktest({ profile, risk, bars, plans, spreads });
    expect(res.stats.setups).toBe(0);
    expect(res.journal.recentEvents().some((e) => e.kind === 'plan_missing')).toBe(true);
  });

  it('parses MT5 exported bars (server time → UTC, spread points → pts)', () => {
    const txt = '<DATE>\t<TIME>\t<OPEN>\t<HIGH>\t<LOW>\t<CLOSE>\t<TICKVOL>\t<VOL>\t<SPREAD>\n2026.10.21\t08:00:00\t4180.1\t4181\t4179.5\t4180.4\t120\t0\t320\n';
    const [b] = parseBars(txt, { ...profile, serverUtcOffsetHours: 2 });
    expect(b).toMatchObject({ open: 4180.1, close: 4180.4, spread: 0.32 });
    expect(b!.time.toISOString()).toBe('2026-10-21T06:00:00.000Z');
  });
});
