import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Mt5LocalFeed } from '../src/feed/Mt5LocalFeed';
import type { Bar, Quote } from '../src/types';

const FAKE = fileURLToPath(new URL('./fixtures/fakeMt5Bridge.mjs', import.meta.url));
const feed = (env?: string) => {
  if (env) process.env.FAKE_MODE = env;
  else delete process.env.FAKE_MODE;
  return new Mt5LocalFeed({ symbol: 'XAUUSDm', serverUtcOffsetHours: 2, command: { cmd: process.execPath, args: [FAKE] }, readyTimeoutMs: 5_000 });
};
const t = (hhmmss: string) => new Date(`2026-10-21T${hhmmss}Z`);

describe('Mt5LocalFeed', () => {
  it('reads the spec, converts server time to UTC and builds M15 bars from ticks', async () => {
    const f = feed();
    await f.connect();
    expect(f.spec()).toMatchObject({ symbol: 'XAUUSDm', contractSize: 100, volumeStep: 0.01 });

    const quotes: Quote[] = [];
    const m15: Bar[] = [];
    await f.start({ onQuote: async (q) => void quotes.push(q), onBar1: async () => {}, onBar15: async (b) => void m15.push(b) });
    await new Promise((r) => setTimeout(r, 500));

    expect(quotes[0]).toEqual({ time: t('10:00:01'), bid: 4170, ask: 4170.3 });
    expect(m15).toEqual([{ time: t('10:00:00'), open: 4170, high: 4175, low: 4168, close: 4168 }]);
    expect(await f.history(1)).toEqual([{ time: t('10:00:00'), open: 4170, high: 4175, low: 4168, close: 4172 }]);
    await f.stop();
  });

  it('fails to connect when the bridge dies before it is ready', async () => {
    await expect(feed('die').connect()).rejects.toThrow(/exited \(3\) before it was ready/);
  });
});
