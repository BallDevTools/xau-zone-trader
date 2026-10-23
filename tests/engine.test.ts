import { describe, expect, it } from 'vitest';
import { validatePlan } from '../src/plan/validator';
import { SignalEngine } from '../src/signal/Engine';
import type { Bar } from '../src/types';
import { risk } from './helpers';
import { basePlan } from './synthetic';

let minute = 0;
const bar = (open: number, high: number, low: number, close: number): Bar => ({
  time: new Date(Date.UTC(2026, 9, 21, 8, 15 * minute++)),
  open, high, low, close,
});
const engine = (zones = basePlan().zones) => new SignalEngine(validatePlan(basePlan({ zones }), risk));

describe('SignalEngine — reject', () => {
  it('BUY fires on a lower-wick rejection that closes back above zone.low', () => {
    const e = engine();
    expect(e.onBar(bar(4180, 4181, 4176, 4177))).toEqual([]); // did not reach zone
    const [s] = e.onBar(bar(4176, 4178, 4168, 4174)); // wick 6/10
    expect(s).toMatchObject({ zoneId: 'B1', side: 'BUY', trigger: 'reject', sl: 4165, tp: 4190 });
  });

  it('no signal when the wick is too small or the close is below the zone', () => {
    const e = engine();
    expect(e.onBar(bar(4171, 4178, 4168, 4177))).toEqual([]); // wick 3/10
    expect(e.onBar(bar(4176, 4177, 4166, 4169))).toEqual([]); // close below zone.low
  });

  it('a close through the SL invalidates the zone for the rest of the day', () => {
    const e = engine();
    e.onBar(bar(4170, 4171, 4160, 4164));
    expect(e.states().find((z) => z.zone.id === 'B1')?.status).toBe('invalid');
    expect(e.onBar(bar(4176, 4178, 4168, 4174))).toEqual([]);
  });

  it('SELL mirror: upper-wick rejection closing back below zone.high', () => {
    const e = engine();
    const [s] = e.onBar(bar(4195, 4201, 4192, 4194)); // wick 6/9
    expect(s).toMatchObject({ zoneId: 'S1', side: 'SELL' });
  });

  it('a used zone never fires again', () => {
    const e = engine();
    e.markUsed('B1', 'opened');
    expect(e.onBar(bar(4176, 4178, 4168, 4174))).toEqual([]);
  });
});

describe('SignalEngine — break & retest', () => {
  const zones = [{ id: 'B2', side: 'BUY' as const, low: 4176, high: 4180, entry: 4178, sl: 4170, tp: [4195], trigger: 'break' as const, source: 'x' }];

  it('needs two closes above, then a retest that holds the edge', () => {
    const e = engine(zones);
    expect(e.onBar(bar(4178, 4183, 4177, 4182))).toEqual([]);
    expect(e.onBar(bar(4182, 4186, 4181, 4185))).toEqual([]);
    expect(e.states()[0]!.status).toBe('broken');
    expect(e.onBar(bar(4185, 4188, 4182, 4187))).toEqual([]); // no retest yet
    const [s] = e.onBar(bar(4187, 4188, 4179.5, 4184)); // retest of 4180 that holds
    expect(s).toMatchObject({ zoneId: 'B2', trigger: 'break', side: 'BUY' });
  });

  it('a close back inside below the zone resets to armed (failed break)', () => {
    const e = engine(zones);
    e.onBar(bar(4178, 4183, 4177, 4182));
    e.onBar(bar(4182, 4186, 4181, 4185));
    e.onBar(bar(4185, 4185, 4174, 4175));
    expect(e.states()[0]).toMatchObject({ status: 'armed', note: 'failed break' });
  });
});
