import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RiskConfig } from '../config/schemas';
import { PlanSchema } from './schema';
import type { Plan, Zone } from './schema';

export interface ZoneCheck {
  zone: Zone;
  ok: boolean;
  issues: string[];
  slDistance: number;
  rr: number;
}

export interface ValidatedPlan {
  plan: Plan;
  /** Plan-level problems disable every zone. */
  planIssues: string[];
  zones: ZoneCheck[];
}

/** Basis may drift a little between the GC and spot snapshots. */
export const BASIS_TOLERANCE = 2;
const r2 = (n: number) => Math.round(n * 100) / 100;

export function validatePlan(plan: Plan, risk: RiskConfig): ValidatedPlan {
  const planIssues: string[] = [];
  if (plan.bias === 'no-trade') planIssues.push('bias is no-trade');
  if (plan.gcRef !== undefined) {
    const implied = r2(plan.gcRef - plan.refSpot);
    if (Math.abs(implied - plan.basis) > BASIS_TOLERANCE)
      planIssues.push(`basis ${plan.basis} ≠ gcRef − refSpot (${implied})`);
  }
  const seen = new Set<string>();

  const zones = plan.zones.map((z): ZoneCheck => {
    const issues: string[] = [];
    if (seen.has(z.id)) issues.push(`duplicate id ${z.id}`);
    seen.add(z.id);
    if (z.low >= z.high) issues.push('low must be < high');
    if (z.entry < z.low || z.entry > z.high) issues.push(`entry ${z.entry} outside zone`);
    const tp = z.tp[0]!;
    if (z.side === 'BUY') {
      if (z.sl >= z.low) issues.push('BUY SL must be below the zone');
      if (tp <= z.high) issues.push('BUY TP must be above the zone');
    } else {
      if (z.sl <= z.high) issues.push('SELL SL must be above the zone');
      if (tp >= z.low) issues.push('SELL TP must be below the zone');
    }
    const slDistance = r2(Math.abs(z.entry - z.sl));
    const rr = slDistance > 0 ? r2(Math.abs(tp - z.entry) / slDistance) : 0;
    if (slDistance > risk.maxSlPts) issues.push(`SL ${slDistance} pts > ${risk.maxSlPts}`);
    if (rr < risk.minRR) issues.push(`R:R ${rr} < ${risk.minRR}`);
    const mid = (z.low + z.high) / 2;
    if (Math.abs(mid - plan.refSpot) > plan.expectedMove)
      issues.push(`zone is outside expected move ±${plan.expectedMove} of ${plan.refSpot}`);
    return { zone: z, ok: issues.length === 0 && planIssues.length === 0, issues, slDistance, rr };
  });
  return { plan, planIssues, zones };
}

/** A plan written far from the current price is stale: every zone is disabled. */
export function staleCheck(vp: ValidatedPlan, price: number): ValidatedPlan {
  const drift = Math.abs(price - vp.plan.refSpot);
  if (drift <= vp.plan.expectedMove) return vp;
  const issue = `price ${price} is ${r2(drift)} pts from refSpot (> expected move) — plan stale`;
  return {
    ...vp,
    planIssues: [...vp.planIssues, issue],
    zones: vp.zones.map((z) => ({ ...z, ok: false })),
  };
}

export type PlanLoad =
  | { kind: 'missing' }
  | { kind: 'invalid'; errors: string[]; raw: unknown }
  | { kind: 'ok'; vp: ValidatedPlan };

export function parsePlan(raw: unknown, risk: RiskConfig): PlanLoad {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success)
    return { kind: 'invalid', raw, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  return { kind: 'ok', vp: validatePlan(parsed.data, risk) };
}

export interface PlanSource {
  load(date: string): PlanLoad;
}

/** Reads config/plans/YYYY-MM-DD.json. */
export class FilePlanSource implements PlanSource {
  constructor(
    private readonly dir: string,
    private readonly risk: RiskConfig,
  ) {}

  load(date: string): PlanLoad {
    const path = join(this.dir, `${date}.json`);
    if (!existsSync(path)) return { kind: 'missing' };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      return { kind: 'invalid', raw: null, errors: [`not valid JSON: ${(err as Error).message}`] };
    }
    const res = parsePlan(raw, this.risk);
    if (res.kind === 'ok' && res.vp.plan.date !== date)
      return { kind: 'invalid', raw, errors: [`file is for ${date} but plan.date is ${res.vp.plan.date}`] };
    return res;
  }
}
