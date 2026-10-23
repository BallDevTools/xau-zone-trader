import { describe, expect, it } from 'vitest';
import { Gateway } from '../src/risk/Gateway';
import type { Position } from '../src/types';
import { gatewayInput, profile, quote, risk, WED } from './helpers';

const gw = new Gateway(risk, profile);
const codeOf = (over: Parameters<typeof gatewayInput>[0]) => {
  const d = gw.decide(gatewayInput(over));
  return d.ok ? 'OK' : d.code;
};

const openBuy = (openPrice: number): Position => ({
  id: 'P1', side: 'BUY', lot: 0.01, openPrice, openTime: WED, sl: openPrice - 9, tp: openPrice + 15,
  zoneId: 'B0', planDate: '2026-10-21', strategy: 'zone', spreadAtOpen: 0.3, mae: 0, mfe: 0,
});

describe('Gateway — accepts a valid order', () => {
  it('approves with fixed lot, fills at ask, computes risk incl. SL slippage', () => {
    const d = gw.decide(gatewayInput());
    expect(d).toMatchObject({ ok: true, lot: 0.01, entryPrice: 4174.3, slDistance: 9.3, rr: 1.69, riskUsd: 9.5 });
  });

  it('SELL fills at bid', () => {
    const d = gw.decide(gatewayInput({ intent: { side: 'SELL', sl: 4183, tp: 4160, zoneId: 'S1', planDate: '', strategy: 'zone' } }));
    expect(d).toMatchObject({ ok: true, entryPrice: 4174, slDistance: 9 });
  });
});

describe('Gateway — every rule rejects', () => {
  it('kill switch', () => expect(codeOf({ killed: true })).toBe('KILL'));
  it('equity floor', () =>
    expect(codeOf({ account: { balance: 59, equity: 59.9, freeMargin: 59, leverage: 3000 } })).toBe('EQUITY_FLOOR'));
  it('no new trades near weekend close (Fri 19:00 UTC, close 20:55)', () => {
    const q = quote(4174, 0.3, new Date('2026-10-23T19:00:00Z'));
    expect(codeOf({ quote: q, now: q.time })).toBe('WEEKEND');
  });
  it('news calendar unavailable → fail closed', () =>
    expect(codeOf({ news: { available: false, windows: [] } })).toBe('NEWS_UNAVAILABLE'));
  it('inside news blackout', () =>
    expect(
      codeOf({
        news: { available: true, windows: [{ start: new Date('2026-10-21T09:30Z'), end: new Date('2026-10-21T10:15Z'), title: 'CPI' }] },
      }),
    ).toBe('NEWS_BLACKOUT'));
  it('spread too wide', () => expect(codeOf({ quote: quote(4174, 0.78) })).toBe('SPREAD'));
  it('global cooldown after any SL', () =>
    expect(codeOf({ lastSlAt: new Date(WED.getTime() - 10 * 60_000) })).toBe('COOLDOWN'));
  it('cooldown expires', () => expect(codeOf({ lastSlAt: new Date(WED.getTime() - 31 * 60_000) })).toBe('OK'));
  it('daily max losses', () => expect(codeOf({ day: { trades: 2, losses: 2, lossUsd: 8 } })).toBe('DAILY_LOSSES'));
  it('daily max trades', () => expect(codeOf({ day: { trades: 3, losses: 0, lossUsd: 0 } })).toBe('DAILY_TRADES'));
  it('max open positions', () => expect(codeOf({ positions: [openBuy(4170)] })).toBe('MAX_POSITIONS'));
  it('never adds to a losing position, even when more positions are allowed', () => {
    const g = new Gateway({ ...risk, maxOpenPositions: 3 }, profile);
    const d = g.decide(gatewayInput({ positions: [openBuy(4180)] }));
    expect(d.ok ? 'OK' : d.code).toBe('ADD_TO_LOSER');
  });
  it('SL on the wrong side', () =>
    expect(codeOf({ intent: { side: 'BUY', sl: 4176, tp: 4190, zoneId: 'B1', planDate: '', strategy: 'zone' } })).toBe('SL_SIDE'));
  it('TP on the wrong side', () =>
    expect(codeOf({ intent: { side: 'BUY', sl: 4165, tp: 4170, zoneId: 'B1', planDate: '', strategy: 'zone' } })).toBe('TP_SIDE'));
  it('SL wider than maxSlPts', () =>
    expect(codeOf({ intent: { side: 'BUY', sl: 4164, tp: 4200, zoneId: 'B1', planDate: '', strategy: 'zone' } })).toBe('SL_TOO_WIDE'));
  it('R:R below minimum', () =>
    expect(codeOf({ intent: { side: 'BUY', sl: 4165, tp: 4182, zoneId: 'B1', planDate: '', strategy: 'zone' } })).toBe('RR'));
  it('broker stops level', () => {
    const g = new Gateway(risk, { ...profile, stopsLevelPoints: 20000 });
    const d = g.decide(gatewayInput());
    expect(d.ok ? 'OK' : d.code).toBe('STOPS_LEVEL');
  });
  it('lot above risk max can never pass, whatever the leverage', () => {
    const g = new Gateway({ ...risk, fixedLot: 0.26, maxLot: 0.25 }, profile);
    expect((g.decide(gatewayInput()) as { code: string }).code).toBe('LOT');
  });
  it('lot not on the broker step', () => {
    const g = new Gateway({ ...risk, fixedLot: 0.015, maxLot: 0.02 }, profile);
    expect((g.decide(gatewayInput()) as { code: string }).code).toBe('LOT');
  });
  it('trade would breach the daily loss limit', () =>
    expect(codeOf({ day: { trades: 1, losses: 1, lossUsd: 10.6 } })).toBe('DAILY_LOSS_USD'));
  it('insufficient free margin', () =>
    expect(codeOf({ account: { balance: 100, equity: 100, freeMargin: 0.05, leverage: 3000 } })).toBe('MARGIN'));
});
