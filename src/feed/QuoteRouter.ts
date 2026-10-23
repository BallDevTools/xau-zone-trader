import type { Quote } from '../types';
import { log } from '../util/log';
import { BarBuilder } from './BarBuilder';
import type { FeedHandlers } from './types';

/** Turns a live quote stream into closed M1 / M15 bars plus the quote, handled strictly in order. */
export class QuoteRouter {
  private m1 = new BarBuilder(1);
  private m15 = new BarBuilder(15);
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly h: FeedHandlers) {}

  push(q: Quote) {
    const spread = q.ask - q.bid;
    const b1 = this.m1.push(q.time, q.bid, spread);
    const b15 = this.m15.push(q.time, q.bid, spread);
    // Ticks are processed strictly one after another (no overlapping order logic).
    // Order matters: close bars first, then the quote that opened the new bucket.
    this.chain = this.chain
      .then(async () => {
        if (b1) await this.h.onBar1(b1.bar, b1.spread);
        if (b15) await this.h.onBar15(b15.bar);
        await this.h.onQuote(q);
      })
      .catch((err) => log.error({ err }, 'feed handler failed'));
  }

  /** Resolves once every queued handler has run. */
  idle(): Promise<void> {
    return this.chain;
  }
}
