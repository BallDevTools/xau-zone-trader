import type { Plan } from '../src/plan/schema';
import type { PlanLoad, PlanSource } from '../src/plan/validator';
import { parsePlan } from '../src/plan/validator';
import type { Bar } from '../src/types';
import { risk } from './helpers';

type OHLC = [open: number, high: number, low: number, close: number];

/**
 * Expand M15 OHLC specs into M1 bars that aggregate back to exactly those values.
 * Path inside each 15m bar: open → low (min 5) → high (min 10) → close (min 15).
 */
export function m1FromM15(startIso: string, specs: OHLC[]): Bar[] {
  const out: Bar[] = [];
  let t = new Date(startIso).getTime();
  for (const [o, h, l, c] of specs) {
    const way = [o, l, h, c];
    const at = (m: number) => {
      const seg = Math.min(2, Math.floor(m / 5));
      const k = (m - seg * 5) / 5;
      return Math.round((way[seg]! + (way[seg + 1]! - way[seg]!) * k) * 1000) / 1000;
    };
    for (let m = 0; m < 15; m++) {
      const a = at(m);
      const b = at(m + 1);
      out.push({ time: new Date(t + m * 60_000), open: a, high: Math.max(a, b), low: Math.min(a, b), close: b });
    }
    t += 15 * 60_000;
  }
  return out;
}

export const basePlan = (over: Partial<Plan> = {}): Plan => ({
  date: '2026-10-21',
  createdBy: 'test',
  bias: 'range',
  refSpot: 4180,
  basis: 24.7,
  expectedMove: 38,
  newsBlackout: [],
  zones: [
    { id: 'B1', side: 'BUY', low: 4170, high: 4175, entry: 4173, sl: 4165, tp: [4190], trigger: 'reject', source: 'Put OI 4195 GC' },
    { id: 'S1', side: 'SELL', low: 4196, high: 4200, entry: 4198, sl: 4206, tp: [4185], trigger: 'reject', source: 'Call OI 4222 GC' },
  ],
  ...over,
});

export class MemoryPlans implements PlanSource {
  constructor(private readonly plans: Record<string, unknown>) {}
  load(date: string): PlanLoad {
    const raw = this.plans[date];
    return raw ? parsePlan(raw, risk) : { kind: 'missing' };
  }
}
