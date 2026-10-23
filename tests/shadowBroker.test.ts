import { describe, expect, it } from 'vitest';
import { ShadowBroker } from '../src/broker/ShadowBroker';
import type { OrderIntent } from '../src/types';
import { profile, quote, WED } from './helpers';

const buy: OrderIntent = { side: 'BUY', sl: 4165, tp: 4190, zoneId: 'B1', planDate: '2026-10-21', strategy: 'zone' };
const sell: OrderIntent = { side: 'SELL', sl: 4183, tp: 4160, zoneId: 'S1', planDate: '2026-10-21', strategy: 'zone' };
const bar = (o: number, h: number, l: number, c: number) => ({ time: WED, open: o, high: h, low: l, close: c });

describe('ShadowBroker', () => {
  it('BUY fills at ask; TP on bid pays exactly (tp - entry) × 100 × lot', async () => {
    const b = new ShadowBroker(profile, 100);
    const p = await b.open(buy, 0.01, quote(4174));
    expect(p.openPrice).toBe(4174.3);
    expect(b.onQuote(quote(4189.9))).toHaveLength(0);
    const [t] = b.onQuote(quote(4190));
    expect(t).toMatchObject({ reason: 'TP', closePrice: 4190, pnl: 15.7 });
    expect(t!.r).toBeCloseTo(15.7 / 9.3, 2);
    expect((await b.account(quote(4190))).balance).toBe(115.7);
  });

  it('SL pays slippage and is about −1R', async () => {
    const b = new ShadowBroker(profile, 100);
    await b.open(buy, 0.01, quote(4174));
    const [t] = b.onQuote(quote(4164.9));
    expect(t).toMatchObject({ reason: 'SL', closePrice: 4164.8, pnl: -9.5 });
    expect(t!.r).toBeCloseTo(-1.02, 2);
  });

  it('SELL exits on ask (bid + spread)', async () => {
    const b = new ShadowBroker(profile, 100);
    const p = await b.open(sell, 0.01, quote(4174));
    expect(p.openPrice).toBe(4174);
    expect(b.onQuote(quote(4159.8))).toHaveLength(0); // ask 4160.1 has not reached TP 4160
    expect(b.onQuote(quote(4159.7))[0]).toMatchObject({ reason: 'TP', pnl: 14 });
  });

  it('bar touching both SL and TP is booked as SL (conservative)', async () => {
    const b = new ShadowBroker(profile, 100);
    await b.open(buy, 0.01, quote(4174));
    expect(b.onBar(bar(4174, 4195, 4160, 4180), 0.3)[0]!.reason).toBe('SL');
  });

  it('TP bar caps MFE at the TP (excursion past the fill is not ours)', async () => {
    const b = new ShadowBroker(profile, 100);
    await b.open(buy, 0.01, quote(4174));
    const [t] = b.onBar(bar(4174, 4195, 4172, 4193), 0.3);
    expect(t).toMatchObject({ reason: 'TP', closePrice: 4190, pnl: 15.7 });
    expect(t!.position).toMatchObject({ mae: -2.3, mfe: 15.7 });
  });

  it('tracks MAE / MFE and floating equity', async () => {
    const b = new ShadowBroker(profile, 100);
    await b.open(buy, 0.01, quote(4174));
    b.onQuote(quote(4170));
    b.onQuote(quote(4180));
    expect(b.positions()[0]).toMatchObject({ mae: -4.3, mfe: 5.7 });
    expect((await b.account(quote(4180))).equity).toBe(105.7);
  });
});
