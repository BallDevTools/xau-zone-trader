import { describe, expect, it } from 'vitest';
import { parsePlan, staleCheck, validatePlan } from '../src/plan/validator';
import { basePlan } from './synthetic';
import { risk } from './helpers';

describe('plan validator', () => {
  it('accepts a sane plan', () => {
    const vp = validatePlan(basePlan(), risk);
    expect(vp.planIssues).toEqual([]);
    expect(vp.zones.map((z) => [z.zone.id, z.ok, z.rr])).toEqual([
      ['B1', true, 2.13],
      ['S1', true, 1.63],
    ]);
  });

  it('skips a zone whose SL is wider than maxSlPts and whose R:R is too low', () => {
    const vp = validatePlan(
      basePlan({ zones: [{ id: 'S9', side: 'SELL', low: 4211, high: 4217, entry: 4214, sl: 4226, tp: [4200], trigger: 'reject', source: 'x' }] }),
      risk,
    );
    expect(vp.zones[0]!.ok).toBe(false);
    expect(vp.zones[0]!.issues).toEqual(['SL 12 pts > 10', 'R:R 1.17 < 1.5']);
  });

  it('rejects geometry errors (SL inside zone, TP on wrong side, entry outside)', () => {
    const vp = validatePlan(
      basePlan({ zones: [{ id: 'B9', side: 'BUY', low: 4170, high: 4175, entry: 4176, sl: 4171, tp: [4174], trigger: 'reject', source: 'x' }] }),
      risk,
    );
    expect(vp.zones[0]!.issues.slice(0, 3)).toEqual(['entry 4176 outside zone', 'BUY SL must be below the zone', 'BUY TP must be above the zone']);
  });

  it('zones outside the expected move are skipped', () => {
    const vp = validatePlan(basePlan({ expectedMove: 5 }), risk);
    expect(vp.zones.every((z) => !z.ok)).toBe(true);
  });

  it('basis mismatch disables the whole plan', () => {
    const vp = validatePlan(basePlan({ gcRef: 4214.7 }), risk); // implied basis 34.7 vs 24.7
    expect(vp.planIssues[0]).toMatch(/basis/);
    expect(vp.zones.some((z) => z.ok)).toBe(false);
  });

  it('a plan far from the live price is stale', () => {
    const vp = staleCheck(validatePlan(basePlan(), risk), 4230);
    expect(vp.zones.some((z) => z.ok)).toBe(false);
  });

  it('schema errors are reported with paths', () => {
    const res = parsePlan({ ...basePlan(), zones: [{ id: 'b1' }] }, risk);
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.errors.some((e) => e.startsWith('zones.0.id'))).toBe(true);
  });
});
