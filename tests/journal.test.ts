import { describe, expect, it } from 'vitest';
import { Journal } from '../src/journal/Journal';
import type { ClosedTrade, Position } from '../src/types';
import { dayKey } from '../src/util/time';

const pos = (id: string, openIso: string): Position => ({
  id, side: 'BUY', lot: 0.01, openPrice: 4174.3, openTime: new Date(openIso), sl: 4165, tp: 4190,
  zoneId: 'B1', planDate: '2026-10-21', strategy: 'zone', spreadAtOpen: 0.3, mae: -2, mfe: 5,
});
const closed = (p: Position, iso: string, pnl: number, reason: ClosedTrade['reason']): ClosedTrade => ({
  position: p, closePrice: 0, closeTime: new Date(iso), reason, pnl, r: pnl / 9.5,
});

describe('Journal', () => {
  it('counts day stats per trading day and finds the last SL', () => {
    const j = new Journal(':memory:', 'shadow', (d) => dayKey(d));
    const a = pos('A', '2026-10-21T09:00:00Z');
    const b = pos('B', '2026-10-21T11:00:00Z');
    const c = pos('C', '2026-10-20T11:00:00Z');
    [a, b, c].forEach((p) => j.openTrade(p));
    j.closeTrade(closed(a, '2026-10-21T09:40:00Z', -9.5, 'SL'));
    j.closeTrade(closed(b, '2026-10-21T12:00:00Z', 14, 'TP'));
    j.closeTrade(closed(c, '2026-10-20T12:00:00Z', -9.6, 'SL'));
    expect(j.dayStats('2026-10-21')).toEqual({ trades: 2, losses: 1, lossUsd: 9.5 });
    expect(j.lastSlAt()?.toISOString()).toBe('2026-10-21T09:40:00.000Z');
    expect(j.realisedPnl()).toBeCloseTo(-5.1);
  });

  it('keeps modes apart and persists the kill switch', () => {
    const j = new Journal(':memory:', 'live', (d) => dayKey(d));
    expect(j.getKill()).toBeNull();
    j.setKill('equity floor', new Date('2026-10-21T10:00:00Z'));
    expect(j.getKill()?.reason).toBe('equity floor');
    j.clearKill();
    expect(j.getKill()).toBeNull();
  });

  it('computes hourly p75 spread', () => {
    const j = new Journal(':memory:', 'shadow', (d) => dayKey(d));
    for (let i = 1; i <= 40; i++) j.spreadSample(new Date('2026-10-21T13:05:00Z'), i / 100);
    expect(j.hourlySpreadP75().get(13)).toBe(0.31);
  });
});
