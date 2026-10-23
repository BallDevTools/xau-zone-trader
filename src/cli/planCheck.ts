// Usage: npm run plan:check -- <YYYY-MM-DD | path/to/plan.json> [--price=4181.4]
import { existsSync, readFileSync } from 'node:fs';
import { loadRiskConfig } from '../config/schemas';
import { parsePlan, staleCheck } from '../plan/validator';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
const price = Number(args.find((a) => a.startsWith('--price='))?.split('=')[1]);
if (!target) {
  console.error('usage: npm run plan:check -- <YYYY-MM-DD | file.json> [--price=<XAUUSDm mid>]');
  process.exit(2);
}
const path = existsSync(target) ? target : `config/plans/${target}.json`;
if (!existsSync(path)) {
  console.error(`✗ ${path} not found`);
  process.exit(1);
}

const risk = loadRiskConfig();
let raw: unknown;
try {
  raw = JSON.parse(readFileSync(path, 'utf8'));
} catch (err) {
  console.error(`✗ ${path}: not valid JSON — ${(err as Error).message}`);
  process.exit(1);
}
const res = parsePlan(raw, risk);
if (res.kind !== 'ok') {
  console.error(`✗ ${path}: schema errors`);
  for (const e of res.kind === 'invalid' ? res.errors : []) console.error(`  - ${e}`);
  process.exit(1);
}
const vp = Number.isFinite(price) ? staleCheck(res.vp, price) : res.vp;
const p = vp.plan;
console.log(`plan ${p.date} · bias ${p.bias} · refSpot ${p.refSpot} · basis ${p.basis} · expected move ±${p.expectedMove}`);
for (const i of vp.planIssues) console.log(`  ✗ plan: ${i}`);
for (const z of vp.zones) {
  const head = `${z.ok ? '✓' : '✗'} ${z.zone.id.padEnd(3)} ${z.zone.side.padEnd(4)} ${z.zone.low}–${z.zone.high} entry ${z.zone.entry} SL ${z.zone.sl} (${z.slDistance}) TP ${z.zone.tp[0]} R:R ${z.rr} [${z.zone.trigger}]`;
  console.log(`  ${head}`);
  for (const i of z.issues) console.log(`      - ${i}`);
}
const usable = vp.zones.filter((z) => z.ok).length;
console.log(`${usable}/${vp.zones.length} zones usable`);
// Strict: every zone must pass, so /plan drops failing zones instead of leaving them in the file.
process.exit(usable > 0 && usable === vp.zones.length ? 0 : 1);
