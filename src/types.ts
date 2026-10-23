// Prices are in quote units: 1 "pt" = $1 of gold price. Lots × contractSize × pts = USD.

export type Side = 'BUY' | 'SELL';
export type Mode = 'shadow' | 'live' | 'backtest' | 'replay';

export interface Quote {
  time: Date;
  bid: number;
  ask: number;
}

/** Bid-price bar; `time` is the bar open (UTC). `spread` in pts when the source provides it. */
export interface Bar {
  time: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  spread?: number;
}

export interface Position {
  id: string;
  side: Side;
  lot: number;
  openPrice: number;
  openTime: Date;
  sl: number;
  tp: number;
  zoneId: string;
  planDate: string;
  strategy: string;
  spreadAtOpen: number;
  /** Worst / best excursion from entry in pts (mae ≤ 0 ≤ mfe). */
  mae: number;
  mfe: number;
  tradeId?: number;
}

export type ExitReason = 'SL' | 'TP' | 'KILL' | 'WEEKEND' | 'FLOOR' | 'MANUAL';

export interface ClosedTrade {
  position: Position;
  closePrice: number;
  closeTime: Date;
  reason: ExitReason;
  pnl: number;
  r: number;
}

export interface AccountState {
  balance: number;
  equity: number;
  freeMargin: number;
  leverage: number;
}

export interface OrderIntent {
  side: Side;
  sl: number;
  tp: number;
  zoneId: string;
  planDate: string;
  strategy: string;
  signalId?: number;
}

export interface BlackoutWindow {
  start: Date;
  end: Date;
  title: string;
}

export interface NewsStatus {
  /** false = calendar could not be loaded; the gateway then blocks entries (fail-closed). */
  available: boolean;
  windows: BlackoutWindow[];
}

export const dir = (side: Side): 1 | -1 => (side === 'BUY' ? 1 : -1);
