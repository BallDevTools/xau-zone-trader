import { readFileSync } from 'node:fs';
import type { BrokerProfile } from '../config/schemas';
import type { Bar } from '../types';
import { BarBuilder } from './BarBuilder';
import type { Feed, FeedHandlers, SymbolSpec } from './types';

/** Spread per UTC hour: measured p75 where available, otherwise the profile default. */
export class SpreadModel {
  constructor(
    private readonly byHour: Map<number, number>,
    private readonly fallback: number,
  ) {}

  at(time: Date, barSpread?: number): number {
    if (barSpread !== undefined && barSpread > 0) return barSpread;
    return this.byHour.get(time.getUTCHours()) ?? this.fallback;
  }

  get measuredHours() {
    return this.byHour.size;
  }
}

/**
 * Parse M1 bars. Accepts the MT5 "Export bars" format (tab-separated, <DATE> <TIME> … <SPREAD>,
 * broker server time, spread in points) or a plain CSV with a header time,open,high,low,close[,spread]
 * (ISO UTC time, spread in pts).
 */
export function parseBars(text: string, profile: BrokerProfile): Bar[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const head = lines.shift() ?? '';
  const bars: Bar[] = [];
  const offsetMs = profile.serverUtcOffsetHours * 3_600_000;
  if (head.includes('<DATE>')) {
    const cols = head.split('\t');
    const ix = (n: string) => cols.indexOf(`<${n}>`);
    const [iD, iT, iO, iH, iL, iC, iS] = ['DATE', 'TIME', 'OPEN', 'HIGH', 'LOW', 'CLOSE', 'SPREAD'].map(ix) as number[];
    for (const l of lines) {
      const f = l.split('\t');
      const iso = `${f[iD!]!.replaceAll('.', '-')}T${f[iT!] ?? '00:00:00'}Z`;
      const spreadPts = iS! >= 0 ? Number(f[iS!]) * profile.point : undefined;
      bars.push({
        time: new Date(new Date(iso).getTime() - offsetMs),
        open: Number(f[iO!]),
        high: Number(f[iH!]),
        low: Number(f[iL!]),
        close: Number(f[iC!]),
        spread: spreadPts,
      });
    }
  } else {
    const cols = head.split(',').map((c) => c.trim().toLowerCase());
    const ix = (n: string) => cols.indexOf(n);
    for (const l of lines) {
      const f = l.split(',');
      const s = ix('spread') >= 0 ? Number(f[ix('spread')]) : undefined;
      bars.push({
        time: new Date(f[ix('time')]!),
        open: Number(f[ix('open')]),
        high: Number(f[ix('high')]),
        low: Number(f[ix('low')]),
        close: Number(f[ix('close')]),
        spread: s,
      });
    }
  }
  const bad = bars.findIndex((b) => [b.open, b.high, b.low, b.close, b.time.getTime()].some((v) => !Number.isFinite(v)));
  if (bad >= 0) throw new Error(`bad bar at data line ${bad + 2}`);
  return bars.sort((a, b) => a.time.getTime() - b.time.getTime());
}

/**
 * Replays M1 bars through the same handlers a live feed uses. Per bar:
 * 1) onBar1 (bar-level SL/TP), 2) onQuote at the bar close, 3) onBar15 when an M15 bucket completes.
 */
export class CsvBarFeed implements Feed {
  private stopped = false;
  private readonly bars: Bar[];

  constructor(
    source: string | Bar[],
    private readonly profile: BrokerProfile,
    private readonly spreads: SpreadModel,
    private readonly opts: { from?: Date; to?: Date; delayMs?: number } = {},
  ) {
    const all = typeof source === 'string' ? parseBars(readFileSync(source, 'utf8'), profile) : source;
    this.bars = all.filter((b) => (!opts.from || b.time >= opts.from) && (!opts.to || b.time < opts.to));
  }

  get size() {
    return this.bars.length;
  }

  async start(h: FeedHandlers) {
    const m15 = new BarBuilder(15);
    for (const b of this.bars) {
      if (this.stopped) break;
      const spread = Math.round(this.spreads.at(b.time, b.spread) * 1000) / 1000;
      await h.onBar1(b, spread);
      const gapBar = m15.pushBar(b);
      if (gapBar) await h.onBar15(gapBar); // previous bucket had missing minutes
      const closeTime = new Date(b.time.getTime() + 60_000);
      await h.onQuote({ time: closeTime, bid: b.close, ask: Math.round((b.close + spread) * 1000) / 1000 });
      if (m15.isLastMinute(b)) {
        const done = m15.flush();
        if (done) await h.onBar15(done);
      }
      if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    }
  }

  async stop() {
    this.stopped = true;
  }

  spec(): SymbolSpec | null {
    return null;
  }

  async history(n: number): Promise<Bar[]> {
    const m15 = new BarBuilder(15);
    const out: Bar[] = [];
    for (const b of this.bars) {
      const done = m15.pushBar(b);
      if (done) out.push(done);
    }
    const last = m15.flush();
    if (last) out.push(last);
    return out.slice(-n);
  }
}
