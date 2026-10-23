import type { BrokerProfile } from '../config/schemas';
import { QuoteRouter } from '../feed/QuoteRouter';
import type { Feed, FeedHandlers, SymbolSpec } from '../feed/types';
import type { AccountState, Bar, ClosedTrade, ExitReason, OrderIntent, Position, Quote } from '../types';
import { dir } from '../types';
import { log } from '../util/log';
import type { Execution } from './types';

/** Magic number that tags every order this system sends, so manual trades are never touched. */
export const MAGIC = 20261024;
const SDK = 'metaapi.cloud-sdk';

/* The SDK ships loose .ts sources; it is loaded untyped and wrapped behind the small
   interfaces below so the rest of the code never depends on SDK internals. */
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * One streaming connection shared by the feed (prices, spec, account) and, in live mode,
 * the execution adapter. Uses the streaming terminal state instead of RPC getSymbolPrice,
 * which avoids the keepSubscription pitfall of the previous project.
 */
export class MetaApiSession {
  private api: Any;
  private account: Any;
  conn: Any;
  private listeners: Array<(name: string, args: unknown[]) => void> = [];

  constructor(
    private readonly token: string,
    private readonly accountId: string,
    readonly symbol: string,
  ) {}

  async connect() {
    const mod: Any = await import(SDK);
    const MetaApi = mod.default ?? mod;
    this.api = new MetaApi(this.token);
    this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);
    if (this.account.state !== 'DEPLOYED') {
      log.info('deploying MetaAPI account');
      await this.account.deploy();
    }
    await this.account.waitConnected();
    this.conn = this.account.getStreamingConnection();

    const Base = mod.SynchronizationListener;
    const fanOut = (name: string, args: unknown[]) => this.listeners.forEach((l) => l(name, args));
    class Listener extends Base {
      async onSymbolPriceUpdated(...a: unknown[]) { fanOut('price', a); }
      async onDealAdded(...a: unknown[]) { fanOut('deal', a); }
    }
    this.conn.addSynchronizationListener(new Listener());
    await this.conn.connect();
    await this.conn.waitSynchronized({ timeoutInSeconds: 300 });
    await this.conn.subscribeToMarketData(this.symbol, [{ type: 'quotes' }]);
    log.info({ symbol: this.symbol }, 'MetaAPI synchronized');
  }

  on(fn: (name: string, args: unknown[]) => void) {
    this.listeners.push(fn);
  }

  get terminal(): Any {
    return this.conn.terminalState;
  }

  async historicalCandles(timeframe: string, limit: number): Promise<Any[]> {
    return this.account.getHistoricalCandles(this.symbol, timeframe, undefined, limit);
  }

  async close() {
    try {
      await this.conn?.unsubscribeFromMarketData?.(this.symbol);
      await this.conn?.close?.();
    } catch (err) {
      log.warn({ err }, 'MetaAPI close failed');
    }
  }
}

export class MetaApiFeed implements Feed {
  constructor(private readonly s: MetaApiSession) {}

  async start(h: FeedHandlers) {
    const router = new QuoteRouter(h);
    this.s.on((name, args) => {
      if (name !== 'price') return;
      const p = args[1] as { symbol: string; bid: number; ask: number; time: Date };
      if (p.symbol !== this.s.symbol) return;
      router.push({ time: new Date(p.time), bid: p.bid, ask: p.ask });
    });
  }

  async stop() {
    await this.s.close();
  }

  spec(): SymbolSpec | null {
    const sp = this.s.terminal?.specification(this.s.symbol);
    if (!sp) return null;
    const info = this.s.terminal.accountInformation;
    return {
      symbol: sp.symbol,
      contractSize: sp.contractSize,
      minVolume: sp.minVolume,
      maxVolume: sp.maxVolume,
      volumeStep: sp.volumeStep,
      digits: sp.digits,
      point: sp.point,
      stopsLevel: sp.stopsLevel,
      swapLong: sp.swapLong,
      swapShort: sp.swapShort,
      leverage: info?.leverage,
    };
  }

  async history(bars: number): Promise<Bar[]> {
    const rows = await this.s.historicalCandles('15m', bars);
    return rows
      .map((c: Any) => ({ time: new Date(c.time), open: c.open, high: c.high, low: c.low, close: c.close }))
      .sort((a: Bar, b: Bar) => a.time.getTime() - b.time.getTime());
  }
}

const exitReason = (r?: string): ExitReason =>
  r === 'DEAL_REASON_SL' ? 'SL' : r === 'DEAL_REASON_TP' ? 'TP' : r === 'DEAL_REASON_SO' ? 'FLOOR' : 'MANUAL';

/** Real orders. SL/TP live on the broker server; closes arrive as deals and are drained by the core. */
export class MetaApiExecution implements Execution {
  readonly kind = 'live' as const;
  private readonly mine = new Map<string, Position>();
  private closed: ClosedTrade[] = [];

  constructor(
    private readonly s: MetaApiSession,
    private readonly profile: BrokerProfile,
  ) {
    s.on((name, args) => {
      if (name !== 'deal') return;
      const d = args[1] as Any;
      if (d.entryType !== 'DEAL_ENTRY_OUT' || !d.positionId) return;
      const p = this.mine.get(String(d.positionId));
      if (!p) return;
      this.mine.delete(p.id);
      const pnl = Math.round(((d.profit ?? 0) + (d.commission ?? 0) + (d.swap ?? 0)) * 100) / 100;
      const price = d.price ?? p.sl;
      const risk = Math.abs(p.openPrice - p.sl);
      const r = risk > 0 ? Math.round((((price - p.openPrice) * dir(p.side)) / risk) * 100) / 100 : 0;
      this.closed.push({ position: p, closePrice: price, closeTime: new Date(d.time), reason: exitReason(d.reason), pnl, r });
    });
  }

  /** Re-attach positions this system opened before a restart (matched by magic + journal). */
  adopt(positions: Position[]) {
    const live = new Set<string>(
      (this.s.terminal.positions as Any[])
        .filter((p) => p.magic === MAGIC && p.symbol === this.s.symbol)
        .map((p) => String(p.id)),
    );
    for (const p of positions) if (live.has(p.id)) this.mine.set(p.id, { ...p });
  }

  async account(): Promise<AccountState> {
    const a = this.s.terminal.accountInformation;
    // Bonus credit is never counted as our money.
    const equity = a.equity - (a.credit ?? 0);
    return { balance: a.balance, equity, freeMargin: a.freeMargin, leverage: a.leverage };
  }

  positions(): Position[] {
    return [...this.mine.values()];
  }

  async open(intent: OrderIntent, lot: number, quote: Quote): Promise<Position> {
    const opts = { comment: `zone ${intent.zoneId}`, magic: MAGIC };
    const res: Any =
      intent.side === 'BUY'
        ? await this.s.conn.createMarketBuyOrder(this.s.symbol, lot, intent.sl, intent.tp, opts)
        : await this.s.conn.createMarketSellOrder(this.s.symbol, lot, intent.sl, intent.tp, opts);
    const id = String(res.positionId ?? res.orderId);
    const broker = (this.s.terminal.positions as Any[]).find((p) => String(p.id) === id);
    const p: Position = {
      id,
      side: intent.side,
      lot,
      openPrice: broker?.openPrice ?? (intent.side === 'BUY' ? quote.ask : quote.bid),
      openTime: broker?.time ? new Date(broker.time) : quote.time,
      sl: intent.sl,
      tp: intent.tp,
      zoneId: intent.zoneId,
      planDate: intent.planDate,
      strategy: intent.strategy,
      spreadAtOpen: Math.round((quote.ask - quote.bid) * 1000) / 1000,
      mae: 0,
      mfe: 0,
    };
    this.mine.set(id, p);
    log.info({ id, side: p.side, lot, price: p.openPrice, sl: p.sl, tp: p.tp }, 'LIVE order filled');
    return { ...p };
  }

  async close(id: string): Promise<ClosedTrade | null> {
    if (!this.mine.has(id)) return null;
    await this.s.conn.closePosition(id, {});
    return null; // the closing deal arrives through drainClosed()
  }

  onQuote(quote: Quote): ClosedTrade[] {
    for (const p of this.mine.values()) {
      const move = ((p.side === 'BUY' ? quote.bid : quote.ask) - p.openPrice) * dir(p.side);
      p.mae = Math.min(p.mae, Math.round(move * 1000) / 1000);
      p.mfe = Math.max(p.mfe, Math.round(move * 1000) / 1000);
    }
    return [];
  }

  onBar(): ClosedTrade[] {
    return [];
  }

  drainClosed(): ClosedTrade[] {
    const out = this.closed;
    this.closed = [];
    return out;
  }
}
