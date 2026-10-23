import type { BrokerProfile } from '../config/schemas';
import type { SymbolSpec } from './types';

export interface SpecDiff {
  field: string;
  profile: unknown;
  live: unknown;
  /** Critical diffs change P&L or order validity; the system refuses to start on them. */
  critical: boolean;
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Compare broker_profile.json with the live MT5 spec so backtest/shadow/live share one cost model. */
export function diffSpec(profile: BrokerProfile, spec: SymbolSpec): SpecDiff[] {
  const out: SpecDiff[] = [];
  const check = (field: string, p: number | null, l: number | undefined, critical: boolean) => {
    if (l === undefined || l === null) return;
    if (p === null || !near(p, l)) out.push({ field, profile: p, live: l, critical });
  };
  if (profile.symbol !== spec.symbol) out.push({ field: 'symbol', profile: profile.symbol, live: spec.symbol, critical: true });
  check('contractSize', profile.contractSize, spec.contractSize, true);
  check('minLot', profile.minLot, spec.minVolume, true);
  check('lotStep', profile.lotStep, spec.volumeStep, true);
  check('digits', profile.digits, spec.digits, true);
  check('point', profile.point, spec.point, true);
  check('maxLot', profile.maxLot, spec.maxVolume, false);
  check('stopsLevelPoints', profile.stopsLevelPoints, spec.stopsLevel, false);
  check('swapLong', profile.swapLong, spec.swapLong, false);
  check('swapShort', profile.swapShort, spec.swapShort, false);
  check('leverage', profile.leverage, spec.leverage, false);
  return out;
}

/** Non-critical live values win (stops level, swaps, leverage); critical ones must be fixed by hand. */
export function applyLiveSpec(profile: BrokerProfile, spec: SymbolSpec): BrokerProfile {
  return {
    ...profile,
    maxLot: spec.maxVolume,
    stopsLevelPoints: spec.stopsLevel,
    swapLong: spec.swapLong ?? profile.swapLong,
    swapShort: spec.swapShort ?? profile.swapShort,
    leverage: spec.leverage ?? profile.leverage,
  };
}
