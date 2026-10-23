// API contract between the dashboard server and the web app (type-only import on the web side).
import type { GateItem, Stats } from '../core/stats';
import type { DecisionRow, EventRow, TradeRow } from '../journal/Journal';
import type { Mode, Side } from '../types';

export type { DecisionRow, EventRow, GateItem, Stats, TradeRow };

export interface ZoneDTO {
  id: string;
  side: Side;
  low: number;
  high: number;
  entry: number;
  sl: number;
  tp: number[];
  trigger: 'reject' | 'break';
  source: string;
  ok: boolean;
  issues: string[];
  rr: number;
  slDistance: number;
  status: string;
  note: string;
}

export interface PlanDTO {
  date: string;
  bias: string;
  refSpot: number;
  gcRef?: number;
  basis: number;
  expectedMove: number;
  iv?: number;
  createdBy: string;
  createdAt?: string;
  notes?: string;
  planIssues: string[];
  zones: ZoneDTO[];
}

export interface StateDTO {
  mode: Mode;
  symbol: string;
  broker: string;
  serverTime: string;
  feed: 'live' | 'replay' | 'connecting';
  quote: { time: string; bid: number; ask: number; spread: number } | null;
  account: { balance: number; equity: number; startBalance: number } | null;
  killed: { reason: string; at: string } | null;
  session: 'asia' | 'london' | 'newyork';
  today: { date: string; trades: number; losses: number; lossUsd: number; pnlUsd: number; r: number };
  limits: {
    fixedLot: number;
    maxSlPts: number;
    dailyLossUsd: number;
    dailyMaxLosses: number;
    maxTradesPerDay: number;
    maxSpreadPts: number;
    equityFloorUsd: number;
    maxOpenPositions: number;
    slCooldownMin: number;
  };
  cooldownLeftMin: number | null;
  positions: { id: string; side: Side; lot: number; openPrice: number; sl: number; tp: number; zoneId: string; pnl: number }[];
  news: { available: boolean; next: { title: string; start: string; end: string }[] };
  plan: PlanDTO | null;
  stats: Stats;
  gates: { pass: boolean; items: GateItem[] };
  decisions: DecisionRow[];
  events: EventRow[];
}

export interface JournalDTO {
  trades: TradeRow[];
  stats: Stats;
  byTrigger: Record<string, Stats>;
  bySession: Record<string, Stats>;
  rejects: { code: string; n: number }[];
  avgSpread: number | null;
}

export interface CandleDTO {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
