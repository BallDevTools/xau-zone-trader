import type { BrokerProfile, RiskConfig } from '../config/schemas';
import type { AccountState, NewsStatus, OrderIntent, Position, Quote } from '../types';
import { dir } from '../types';
import { minutesUntilWeekly } from '../util/time';

export interface DayStats {
  /** Trades opened in the current trading day. */
  trades: number;
  /** Trades closed at a loss in the current trading day. */
  losses: number;
  /** Sum of realised losses today in USD (positive number, wins are not netted). */
  lossUsd: number;
}

export interface GatewayInput {
  now: Date;
  quote: Quote;
  account: AccountState;
  positions: Position[];
  day: DayStats;
  lastSlAt: Date | null;
  killed: boolean;
  news: NewsStatus;
  intent: OrderIntent;
}

export type RejectCode =
  | 'KILL'
  | 'EQUITY_FLOOR'
  | 'WEEKEND'
  | 'NEWS_UNAVAILABLE'
  | 'NEWS_BLACKOUT'
  | 'SPREAD'
  | 'COOLDOWN'
  | 'DAILY_LOSSES'
  | 'DAILY_TRADES'
  | 'DAILY_LOSS_USD'
  | 'MAX_POSITIONS'
  | 'ADD_TO_LOSER'
  | 'SL_SIDE'
  | 'TP_SIDE'
  | 'SL_TOO_WIDE'
  | 'STOPS_LEVEL'
  | 'RR'
  | 'LOT'
  | 'MARGIN';

export type Decision =
  | {
      ok: true;
      lot: number;
      entryPrice: number;
      slDistance: number;
      rr: number;
      /** Worst-case loss in USD including SL slippage and commission. */
      riskUsd: number;
      spread: number;
    }
  | { ok: false; code: RejectCode; reason: string; spread: number };

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * The single choke point for every order. Pure: all state is passed in, so the same rules
 * run identically in backtest, shadow and live.
 */
export class Gateway {
  constructor(
    private readonly risk: RiskConfig,
    private readonly profile: BrokerProfile,
  ) {}

  decide(input: GatewayInput): Decision {
    const { risk, profile } = this;
    const { now, quote, account, positions, day, intent } = input;
    const spread = round(quote.ask - quote.bid, 3);
    const reject = (code: RejectCode, reason: string): Decision => ({ ok: false, code, reason, spread });

    if (input.killed) return reject('KILL', 'kill switch is active');
    if (account.equity < risk.equityFloorUsd)
      return reject('EQUITY_FLOOR', `equity $${round(account.equity)} < floor $${risk.equityFloorUsd}`);

    const toWeekend = minutesUntilWeekly(now, profile.weekendClose.weekday, profile.weekendClose.timeUtc);
    if (toWeekend <= risk.noNewTradesBeforeWeekendMin)
      return reject('WEEKEND', `${Math.round(toWeekend)} min to weekend close`);

    if (!input.news.available) return reject('NEWS_UNAVAILABLE', 'news calendar unavailable (fail-closed)');
    const blackout = input.news.windows.find((w) => now >= w.start && now <= w.end);
    if (blackout) return reject('NEWS_BLACKOUT', `news blackout: ${blackout.title}`);

    if (spread > risk.maxSpreadPts) return reject('SPREAD', `spread ${spread} > ${risk.maxSpreadPts}`);

    if (input.lastSlAt) {
      const sinceSl = (now.getTime() - input.lastSlAt.getTime()) / 60_000;
      if (sinceSl < risk.slCooldownMin)
        return reject('COOLDOWN', `global cooldown after SL: ${Math.ceil(risk.slCooldownMin - sinceSl)} min left`);
    }

    if (day.losses >= risk.dailyMaxLosses) return reject('DAILY_LOSSES', `${day.losses} losses today`);
    if (day.trades >= risk.maxTradesPerDay) return reject('DAILY_TRADES', `${day.trades} trades today`);
    if (positions.length >= risk.maxOpenPositions)
      return reject('MAX_POSITIONS', `${positions.length} position(s) already open`);

    const markOf = (p: Position) => (p.side === 'BUY' ? quote.bid : quote.ask);
    const loser = positions.find((p) => p.side === intent.side && (markOf(p) - p.openPrice) * dir(p.side) < 0);
    if (loser && !risk.allowAddToLoser) return reject('ADD_TO_LOSER', `open ${loser.side} ${loser.id} is losing`);

    const entryPrice = intent.side === 'BUY' ? quote.ask : quote.bid;
    const d = dir(intent.side);
    const slDistance = round((entryPrice - intent.sl) * d, 3);
    const tpDistance = round((intent.tp - entryPrice) * d, 3);
    if (slDistance <= 0) return reject('SL_SIDE', `SL ${intent.sl} is not beyond entry ${entryPrice}`);
    if (tpDistance <= 0) return reject('TP_SIDE', `TP ${intent.tp} is not beyond entry ${entryPrice}`);
    if (slDistance > risk.maxSlPts) return reject('SL_TOO_WIDE', `SL ${slDistance} pts > ${risk.maxSlPts}`);
    if (profile.stopsLevelPoints) {
      const min = profile.stopsLevelPoints * profile.point;
      if (slDistance < min || tpDistance < min) return reject('STOPS_LEVEL', `SL/TP closer than stops level ${min}`);
    }
    const rr = round(tpDistance / slDistance, 2);
    if (rr < risk.minRR) return reject('RR', `R:R ${rr} < ${risk.minRR}`);

    const lot = risk.fixedLot;
    const steps = lot / profile.lotStep;
    if (lot < profile.minLot || lot > risk.maxLot || lot > profile.maxLot || Math.abs(steps - Math.round(steps)) > 1e-9)
      return reject('LOT', `lot ${lot} outside broker/risk limits`);

    const riskUsd = round((slDistance + profile.slSlippage) * lot * profile.contractSize + profile.commissionPerLot * lot);
    if (day.lossUsd + riskUsd > risk.dailyLossUsd)
      return reject('DAILY_LOSS_USD', `loss today $${round(day.lossUsd)} + risk $${riskUsd} > $${risk.dailyLossUsd}`);

    const leverage = Math.min(account.leverage, profile.leverage);
    const margin = (entryPrice * profile.contractSize * lot) / leverage;
    if (margin > account.freeMargin) return reject('MARGIN', `margin $${round(margin)} > free $${round(account.freeMargin)}`);

    return { ok: true, lot, entryPrice, slDistance, rr, riskUsd, spread };
  }
}
