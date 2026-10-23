// Usage: npm run unkill -- --mode=shadow|live
// Clearing the kill switch is deliberately a manual, local action (never from the dashboard).
import { Journal } from '../journal/Journal';
import type { Mode } from '../types';
import { dayKey } from '../util/time';

const mode = (process.argv.find((a) => a.startsWith('--mode='))?.split('=')[1] ?? 'shadow') as Mode;
const j = new Journal('data/trader.db', mode, (d) => dayKey(d));
const k = j.getKill();
if (!k) console.log(`kill switch (${mode}) is not active`);
else {
  j.clearKill();
  j.event(new Date(), 'unkill', `cleared kill switch set at ${k.at}: ${k.reason}`);
  console.log(`cleared kill switch (${mode}) — was: ${k.reason} (${k.at})`);
}
