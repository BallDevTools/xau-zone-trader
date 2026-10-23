import type { Bar } from '../types';
import { bucketStart } from '../util/time';

/**
 * Aggregates bid prices into fixed-length bars. A bar is emitted when the first price of
 * the next bucket arrives, so a bar is only ever reported once it is complete.
 */
export class BarBuilder {
  private cur: Bar | null = null;
  private maxSpread = 0;

  constructor(private readonly minutes: number) {}

  /** Returns the bar that just closed, if this price started a new bucket. */
  push(time: Date, bid: number, spread = 0): { bar: Bar; spread: number } | null {
    const t = bucketStart(time, this.minutes);
    if (this.cur && t.getTime() < this.cur.time.getTime()) return null; // late tick
    let done: { bar: Bar; spread: number } | null = null;
    if (this.cur && t.getTime() !== this.cur.time.getTime()) {
      done = { bar: this.cur, spread: this.maxSpread };
      this.cur = null;
    }
    if (!this.cur) {
      this.cur = { time: t, open: bid, high: bid, low: bid, close: bid };
      this.maxSpread = spread;
    } else {
      this.cur.high = Math.max(this.cur.high, bid);
      this.cur.low = Math.min(this.cur.low, bid);
      this.cur.close = bid;
      this.maxSpread = Math.max(this.maxSpread, spread);
    }
    return done;
  }

  /** Feed a finished lower-timeframe bar (backtests aggregate M1 → M15 this way). */
  pushBar(b: Bar): Bar | null {
    const t = bucketStart(b.time, this.minutes);
    let done: Bar | null = null;
    if (this.cur && t.getTime() !== this.cur.time.getTime()) {
      done = this.cur;
      this.cur = null;
    }
    if (!this.cur) this.cur = { time: t, open: b.open, high: b.high, low: b.low, close: b.close };
    else {
      this.cur.high = Math.max(this.cur.high, b.high);
      this.cur.low = Math.min(this.cur.low, b.low);
      this.cur.close = b.close;
    }
    return done;
  }

  /** True when `b` (a 1-minute bar) is the last minute of its bucket. */
  isLastMinute(b: Bar): boolean {
    return bucketStart(new Date(b.time.getTime() + 60_000), this.minutes).getTime() !== bucketStart(b.time, this.minutes).getTime();
  }

  flush(): Bar | null {
    const b = this.cur;
    this.cur = null;
    return b;
  }
}
