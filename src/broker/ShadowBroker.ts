import type { BrokerProfile } from '../config/schemas';
import type { AccountState, Bar, ClosedTrade, ExitReason, OrderIntent, Position, Quote } from '../types';
import { dir } from '../types';
import type { Execution } from './types';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Simulated broker with the same cost model as the live account:
 * BUY fills at ask / exits at bid, SELL fills at bid / exits at ask, SL exits pay `slSlippage`.
 */
export class ShadowBroker implements Execution {
  readonly kind = 'shadow' as const;
  private balance: number;
  private readonly open_ = new Map<string, Position>();
  private seq = 0;

  constructor(
    private readonly profile: BrokerProfile,
    startBalance: number,
  ) {
    this.balance = startBalance;
  }

  /** Restore state after a restart (balance from the journal, positions still open in shadow). */
  restore(balance: number, positions: Position[]) {
    this.balance = balance;
    this.open_.clear();
    for (const p of positions) this.open_.set(p.id, { ...p });
    this.seq = positions.length;
  }

  positions(): Position[] {
    return [...this.open_.values()];
  }

  async account(quote: Quote): Promise<AccountState> {
    return this.accountSync(quote);
  }

  accountSync(quote: Quote): AccountState {
    let floating = 0;
    let margin = 0;
    for (const p of this.open_.values()) {
      const mark = p.side === 'BUY' ? quote.bid : quote.ask;
      floating += (mark - p.openPrice) * dir(p.side) * p.lot * this.profile.contractSize;
      margin += (p.openPrice * this.profile.contractSize * p.lot) / this.profile.leverage;
    }
    const equity = r2(this.balance + floating);
    return { balance: r2(this.balance), equity, freeMargin: r2(equity - margin), leverage: this.profile.leverage };
  }

  async open(intent: OrderIntent, lot: number, quote: Quote): Promise<Position> {
    const p: Position = {
      id: `S${Date.now().toString(36)}-${++this.seq}`,
      side: intent.side,
      lot,
      openPrice: intent.side === 'BUY' ? quote.ask : quote.bid,
      openTime: quote.time,
      sl: intent.sl,
      tp: intent.tp,
      zoneId: intent.zoneId,
      planDate: intent.planDate,
      strategy: intent.strategy,
      spreadAtOpen: r3(quote.ask - quote.bid),
      mae: 0,
      mfe: 0,
    };
    this.open_.set(p.id, p);
    return { ...p };
  }

  async close(id: string, quote: Quote, reason: ExitReason): Promise<ClosedTrade | null> {
    const p = this.open_.get(id);
    if (!p) return null;
    return this.settle(p, p.side === 'BUY' ? quote.bid : quote.ask, quote.time, reason);
  }

  onQuote(quote: Quote): ClosedTrade[] {
    const closed: ClosedTrade[] = [];
    for (const p of [...this.open_.values()]) {
      const mark = p.side === 'BUY' ? quote.bid : quote.ask;
      this.track(p, mark);
      const hitSl = p.side === 'BUY' ? mark <= p.sl : mark >= p.sl;
      const hitTp = p.side === 'BUY' ? mark >= p.tp : mark <= p.tp;
      if (hitSl) closed.push(this.settle(p, this.slFill(p), quote.time, 'SL'));
      else if (hitTp) closed.push(this.settle(p, p.tp, quote.time, 'TP'));
    }
    return closed;
  }

  onBar(bar: Bar, spread: number): ClosedTrade[] {
    const closed: ClosedTrade[] = [];
    const end = new Date(bar.time.getTime() + 60_000);
    for (const p of [...this.open_.values()]) {
      // BUY exits on bid (bar prices); SELL exits on ask (bid + spread).
      const lo = p.side === 'BUY' ? bar.low : bar.low + spread;
      const hi = p.side === 'BUY' ? bar.high : bar.high + spread;
      const worst = p.side === 'BUY' ? lo : hi;
      const best = p.side === 'BUY' ? hi : lo;
      this.track(p, worst);
      const hitSl = p.side === 'BUY' ? lo <= p.sl : hi >= p.sl;
      const hitTp = p.side === 'BUY' ? hi >= p.tp : lo <= p.tp;
      if (hitSl) {
        closed.push(this.settle(p, this.slFill(p), end, 'SL'));
        continue;
      }
      // Excursion after the TP fill is not ours: cap the best mark at the TP.
      this.track(p, hitTp ? p.tp : best);
      if (hitTp) closed.push(this.settle(p, p.tp, end, 'TP'));
    }
    return closed;
  }

  private slFill(p: Position) {
    return r3(p.sl - this.profile.slSlippage * dir(p.side));
  }

  private track(p: Position, mark: number) {
    const move = r3((mark - p.openPrice) * dir(p.side));
    if (move < p.mae) p.mae = move;
    if (move > p.mfe) p.mfe = move;
  }

  private settle(p: Position, price: number, time: Date, reason: ExitReason): ClosedTrade {
    this.track(p, price);
    const d = dir(p.side);
    const pnl = r2((price - p.openPrice) * d * p.lot * this.profile.contractSize - this.profile.commissionPerLot * p.lot);
    const risk = Math.abs(p.openPrice - p.sl);
    const r = risk > 0 ? r2(((price - p.openPrice) * d) / risk) : 0;
    this.balance = r2(this.balance + pnl);
    this.open_.delete(p.id);
    return { position: { ...p }, closePrice: price, closeTime: time, reason, pnl, r };
  }
}
