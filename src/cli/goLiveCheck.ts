// Usage: npm run golive:check — go-live gates measured on shadow results.
import { loadRiskConfig } from '../config/schemas';
import { computeStats, goLiveGates } from '../core/stats';
import { Journal } from '../journal/Journal';
import { dayKey } from '../util/time';

const risk = loadRiskConfig();
const stats = computeStats(new Journal('data/trader.db', 'shadow', (d) => dayKey(d)).closedTrades());
const g = goLiveGates(stats, risk.goLive);
for (const i of g.items) console.log(`${i.pass ? '✓' : '✗'} ${i.label.padEnd(13)} ${i.value.padEnd(10)} ${i.rule}`);
console.log(g.pass ? '\nAll gates passed — live may start at fixed 0.01 lot.' : '\nNot ready for live.');
process.exit(g.pass ? 0 : 1);
