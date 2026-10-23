import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ShadowBroker } from '../src/broker/ShadowBroker';
import { TradingCore } from '../src/core/TradingCore';
import { Journal } from '../src/journal/Journal';
import { ForexFactoryNews, NoNews } from '../src/news/calendar';
import { dayKey } from '../src/util/time';
import { profile, quote, risk } from './helpers';
import { basePlan, MemoryPlans } from './synthetic';

function setup() {
  const journal = new Journal(':memory:', 'shadow', (d) => dayKey(d));
  const exec = new ShadowBroker(profile, 100);
  const core = new TradingCore({
    mode: 'shadow', profile, risk, journal, exec, news: new NoNews(),
    plans: new MemoryPlans({ '2026-10-23': basePlan({ date: '2026-10-23' }) }),
  });
  return { journal, exec, core };
}
const intent = { side: 'BUY' as const, sl: 4100, tp: 4300, zoneId: 'B1', planDate: '2026-10-23', strategy: 'zone-reject' };

describe('TradingCore safety nets', () => {
  it('equity below the floor fires the kill switch, closes positions and persists', async () => {
    const { core, exec, journal } = setup();
    const t0 = new Date('2026-10-21T10:00:00Z');
    const p = await exec.open(intent, 0.01, quote(4174, 0.3, t0));
    journal.openTrade(p);
    await core.onQuote(quote(4130, 0.3, new Date('2026-10-21T10:05:00Z'))); // −$44.3 → equity 55.7
    expect(journal.getKill()?.reason).toMatch(/floor/);
    expect(exec.positions()).toHaveLength(0);
    expect(journal.closedTrades()[0]).toMatchObject({ exit_reason: 'FLOOR' });
  });

  it('flattens before the weekend close', async () => {
    const { core, exec, journal } = setup();
    const p = await exec.open(intent, 0.01, quote(4174, 0.3, new Date('2026-10-23T18:00:00Z')));
    journal.openTrade(p);
    await core.onQuote(quote(4176, 0.3, new Date('2026-10-23T19:30:00Z'))); // 85 min to close: keep
    expect(exec.positions()).toHaveLength(1);
    await core.onQuote(quote(4177, 0.3, new Date('2026-10-23T19:56:00Z'))); // 59 min: flatten
    expect(exec.positions()).toHaveLength(0);
    expect(journal.closedTrades()[0]).toMatchObject({ exit_reason: 'WEEKEND' });
  });
});

describe('news calendar', () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-'));

  it('is unavailable without a cache (gateway fails closed)', () => {
    expect(new ForexFactoryNews(join(dir, 'none.json'), 30, 15).status(new Date()).available).toBe(false);
  });

  it('builds blackout windows and goes stale after 26h', () => {
    const path = join(dir, 'cache.json');
    writeFileSync(path, JSON.stringify({ fetchedAt: '2026-10-21T00:00:00Z', events: [{ time: '2026-10-21T12:30:00Z', title: 'CPI' }] }));
    const n = new ForexFactoryNews(path, 30, 15);
    const s = n.status(new Date('2026-10-21T10:00:00Z'));
    expect(s.windows[0]).toMatchObject({ title: 'CPI', start: new Date('2026-10-21T12:00:00Z'), end: new Date('2026-10-21T12:45:00Z') });
    expect(n.status(new Date('2026-10-22T03:00:00Z')).available).toBe(false);
  });
});
