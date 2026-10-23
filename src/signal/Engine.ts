import type { Zone } from '../plan/schema';
import type { ValidatedPlan } from '../plan/validator';
import type { Bar, Side } from '../types';

export type ZoneStatus = 'armed' | 'broken' | 'used' | 'invalid' | 'disabled';

export interface ZoneState {
  zone: Zone;
  status: ZoneStatus;
  note: string;
  /** Consecutive closes beyond the zone (break trigger). */
  beyond: number;
}

export interface Signal {
  time: Date;
  zoneId: string;
  side: Side;
  trigger: Zone['trigger'];
  sl: number;
  tp: number;
}

export interface EngineOptions {
  /** Rejection wick must be at least this share of the bar range. */
  wickRatio: number;
  /** Consecutive M15 closes beyond the zone that confirm a break. */
  breakCloses: number;
}

export const DEFAULT_ENGINE: EngineOptions = { wickRatio: 0.5, breakCloses: 2 };

/**
 * Deterministic M15 trigger rules over the zones of one plan. Every rule reads only the
 * closed bar, so backtest and live produce the same signals for the same bars.
 *
 * reject  BUY : low reaches the zone (stays above SL), close back above zone.low,
 *               lower wick ≥ wickRatio of range.          SELL: mirror image.
 * break   BUY : `breakCloses` consecutive closes above zone.high, then a retest bar whose
 *               low touches zone.high and closes above it.  SELL: mirror image.
 * invalid      close beyond SL, or beyond invalidIfCloseAbove / invalidIfCloseBelow.
 */
export class SignalEngine {
  private readonly zones: ZoneState[];

  constructor(
    vp: ValidatedPlan,
    private readonly opts: EngineOptions = DEFAULT_ENGINE,
  ) {
    this.zones = vp.zones.map((c) => ({
      zone: c.zone,
      status: c.ok ? 'armed' : 'disabled',
      note: c.ok ? '' : [...vp.planIssues, ...c.issues].join('; '),
      beyond: 0,
    }));
  }

  states(): ZoneState[] {
    return this.zones.map((z) => ({ ...z }));
  }

  markUsed(zoneId: string, note: string) {
    const z = this.zones.find((s) => s.zone.id === zoneId);
    if (z) {
      z.status = 'used';
      z.note = note;
    }
  }

  onBar(bar: Bar): Signal[] {
    const out: Signal[] = [];
    const closeTime = new Date(bar.time.getTime() + 15 * 60_000);
    for (const s of this.zones) {
      if (s.status !== 'armed' && s.status !== 'broken') continue;
      const z = s.zone;
      if (this.invalidated(z, bar)) {
        s.status = 'invalid';
        s.note = `invalidated by close ${bar.close}`;
        continue;
      }
      const fire = z.trigger === 'reject' ? this.reject(z, bar) : this.breakRetest(s, bar);
      if (fire) out.push({ time: closeTime, zoneId: z.id, side: z.side, trigger: z.trigger, sl: z.sl, tp: z.tp[0]! });
    }
    return out;
  }

  private invalidated(z: Zone, b: Bar): boolean {
    if (z.invalidIfCloseAbove !== undefined && b.close > z.invalidIfCloseAbove) return true;
    if (z.invalidIfCloseBelow !== undefined && b.close < z.invalidIfCloseBelow) return true;
    return z.side === 'BUY' ? b.close <= z.sl : b.close >= z.sl;
  }

  private reject(z: Zone, b: Bar): boolean {
    const range = b.high - b.low;
    if (range <= 0) return false;
    if (z.side === 'BUY') {
      const touched = b.low <= z.high && b.low > z.sl;
      const wick = Math.min(b.open, b.close) - b.low;
      return touched && b.close > z.low && wick / range >= this.opts.wickRatio;
    }
    const touched = b.high >= z.low && b.high < z.sl;
    const wick = b.high - Math.max(b.open, b.close);
    return touched && b.close < z.high && wick / range >= this.opts.wickRatio;
  }

  private breakRetest(s: ZoneState, b: Bar): boolean {
    const z = s.zone;
    const up = z.side === 'BUY';
    const beyond = up ? b.close > z.high : b.close < z.low;
    const backInside = up ? b.close < z.low : b.close > z.high;

    if (s.status === 'armed') {
      s.beyond = beyond ? s.beyond + 1 : 0;
      if (s.beyond >= this.opts.breakCloses) {
        s.status = 'broken';
        s.note = 'break confirmed, waiting for retest';
      }
      return false;
    }
    // broken: wait for a retest of the broken edge that holds
    if (backInside) {
      s.status = 'armed';
      s.beyond = 0;
      s.note = 'failed break';
      return false;
    }
    const edge = up ? z.high : z.low;
    return up ? b.low <= edge && b.close > edge : b.high >= edge && b.close < edge;
  }
}
