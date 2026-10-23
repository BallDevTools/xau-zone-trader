import type { AccountState, Bar, ClosedTrade, ExitReason, OrderIntent, Position, Quote } from '../types';

/** Order execution. ShadowBroker simulates fills; MetaApiExecution sends real orders. */
export interface Execution {
  readonly kind: 'shadow' | 'live';
  account(quote: Quote): Promise<AccountState>;
  positions(): Position[];
  open(intent: OrderIntent, lot: number, quote: Quote): Promise<Position>;
  close(id: string, quote: Quote, reason: ExitReason): Promise<ClosedTrade | null>;
  /** Tick-level SL/TP + excursion tracking. Returns trades closed by this quote. */
  onQuote(quote: Quote): ClosedTrade[];
  /** Bar-level SL/TP for backtests (SL assumed first when a bar touches both). */
  onBar(bar: Bar, spread: number): ClosedTrade[];
  /** Live only: trades the broker closed (SL/TP hit server-side) since the last call. */
  drainClosed?(): ClosedTrade[];
}
