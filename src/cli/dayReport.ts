// Usage: npm run day:report -- <YYYY-MM-DD> [--mode=shadow]
// Dumps the plan, gateway decisions, trades and events of one trading day as JSON (used by /review).
import { Journal } from '../journal/Journal';
import type { Mode } from '../types';
import { dayKey } from '../util/time';

const args = process.argv.slice(2);
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const mode = (args.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'shadow') as Mode;
if (!date) {
  console.error('usage: npm run day:report -- <YYYY-MM-DD> [--mode=shadow|live]');
  process.exit(2);
}
const j = new Journal('data/trader.db', mode, (d) => dayKey(d));
const from = `${date}T00:00:00.000Z`;
const to = new Date(new Date(from).getTime() + 86_400_000).toISOString();
const q = <T>(sql: string, ...p: unknown[]) => j.db.prepare(sql).all(...p) as T[];

const plan = j.db.prepare('SELECT json, issues FROM plans WHERE date = ?').get(date) as { json: string; issues: string } | undefined;
console.log(
  JSON.stringify(
    {
      date,
      mode,
      plan: plan ? { ...JSON.parse(plan.json), validatorIssues: JSON.parse(plan.issues) } : null,
      signals: q('SELECT time, zone_id, side, trigger, sl, tp FROM signals WHERE mode = ? AND time >= ? AND time < ?', mode, from, to),
      decisions: q('SELECT time, zone_id, side, ok, code, reason, spread FROM risk_decisions WHERE mode = ? AND time >= ? AND time < ?', mode, from, to),
      trades: j.closedTrades(from, to),
      events: q('SELECT time, kind, message FROM events WHERE mode = ? AND time >= ? AND time < ?', mode, from, to),
    },
    null,
    2,
  ),
);
