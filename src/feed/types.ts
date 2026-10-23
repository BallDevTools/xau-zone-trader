import type { Bar, Quote } from '../types';

export interface FeedHandlers {
  onQuote(q: Quote): Promise<void>;
  /** Closed M1 bar (bid). Replay feeds use it for bar-level SL/TP. */
  onBar1(bar: Bar, spread: number): Promise<void>;
  /** Closed M15 bar (bid) — drives the signal engine. */
  onBar15(bar: Bar): Promise<void>;
}

/** The subset of the MT5 symbol specification the system depends on. */
export interface SymbolSpec {
  symbol: string;
  contractSize: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  digits: number;
  point: number;
  stopsLevel: number;
  swapLong?: number;
  swapShort?: number;
  leverage?: number;
}

export interface Feed {
  start(h: FeedHandlers): Promise<void>;
  stop(): Promise<void>;
  spec(): SymbolSpec | null;
  /** Recent M15 bars for charts and warm-up. */
  history(bars: number): Promise<Bar[]>;
}
