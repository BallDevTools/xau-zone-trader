import { describe, expect, it } from 'vitest';
import { BarBuilder } from '../src/feed/BarBuilder';
import { applyLiveSpec, diffSpec } from '../src/feed/specSync';
import { profile } from './helpers';

const t = (hhmmss: string) => new Date(`2026-10-21T${hhmmss}Z`);

describe('BarBuilder', () => {
  it('emits a 15m bar only when the next bucket starts', () => {
    const b = new BarBuilder(15);
    expect(b.push(t('10:00:01'), 4170, 0.3)).toBeNull();
    expect(b.push(t('10:07:00'), 4175, 0.6)).toBeNull();
    expect(b.push(t('10:14:59'), 4168, 0.3)).toBeNull();
    const done = b.push(t('10:15:00'), 4169, 0.3);
    expect(done?.bar).toEqual({ time: t('10:00:00'), open: 4170, high: 4175, low: 4168, close: 4168 });
    expect(done?.spread).toBe(0.6);
  });

  it('aggregates M1 bars and knows the last minute of a bucket', () => {
    const b = new BarBuilder(15);
    const m1 = (hhmm: string, o: number, h: number, l: number, c: number) => ({ time: t(`${hhmm}:00`), open: o, high: h, low: l, close: c });
    b.pushBar(m1('10:00', 1, 3, 0.5, 2));
    expect(b.isLastMinute(m1('10:13', 0, 0, 0, 0))).toBe(false);
    const last = m1('10:14', 2, 5, 1, 4);
    b.pushBar(last);
    expect(b.isLastMinute(last)).toBe(true);
    expect(b.flush()).toEqual({ time: t('10:00:00'), open: 1, high: 5, low: 0.5, close: 4 });
  });
});

describe('spec sync', () => {
  const live = { symbol: 'XAUUSDm', contractSize: 100, minVolume: 0.01, maxVolume: 200, volumeStep: 0.01, digits: 3, point: 0.001, stopsLevel: 0, leverage: 3000 };

  it('matching spec only reports unset optional fields', () => {
    expect(diffSpec(profile, live).filter((d) => d.critical)).toEqual([]);
  });

  it('flags a contract size or symbol mismatch as critical', () => {
    const diffs = diffSpec(profile, { ...live, symbol: 'XAUUSDc', contractSize: 1 });
    expect(diffs.filter((d) => d.critical).map((d) => d.field)).toEqual(['symbol', 'contractSize']);
  });

  it('adopts live stops level / leverage', () => {
    expect(applyLiveSpec(profile, { ...live, stopsLevel: 50, leverage: 2000 })).toMatchObject({ stopsLevelPoints: 50, leverage: 2000 });
  });
});
