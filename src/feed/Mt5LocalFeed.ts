import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import type { Bar } from '../types';
import { log } from '../util/log';
import { QuoteRouter } from './QuoteRouter';
import type { Feed, FeedHandlers, SymbolSpec } from './types';

export interface Mt5LocalOptions {
  symbol: string;
  /** Broker server time − UTC. MT5 stamps ticks and bars in server time. */
  serverUtcOffsetHours: number;
  /** Python with the MetaTrader5 package (default `python` on Windows, else `python3`). */
  python?: string;
  /** terminal64.exe path, when more than one terminal is installed. */
  terminalPath?: string;
  /** Override the bridge command (tests). */
  command?: { cmd: string; args: string[] };
  readyTimeoutMs?: number;
  restartDelayMs?: number;
}

type Msg =
  | { type: 'ready'; spec: SymbolSpec; account: { login: number; server: string; company: string; tradeMode: number } }
  | { type: 'tick'; msc: number; bid: number; ask: number }
  | { type: 'status'; connected: boolean }
  | { type: 'history'; id: number; bars: Array<{ t: number; o: number; h: number; l: number; c: number }> }
  | { type: 'error'; message: string };

const BRIDGE = fileURLToPath(new URL('../../bridge/mt5_bridge.py', import.meta.url));
const MAX_SKEW_MS = 5 * 60_000;

/**
 * Prices from a locally running MT5 terminal via bridge/mt5_bridge.py (Windows).
 * Read-only: the bridge never sends orders, so this feed pairs with ShadowBroker only.
 * The bridge is restarted if it dies; bars resume from the next tick.
 */
export class Mt5LocalFeed implements Feed {
  private child: ChildProcessWithoutNullStreams | null = null;
  private router: QuoteRouter | null = null;
  private spec_: SymbolSpec | null = null;
  private pending = new Map<number, (bars: Bar[]) => void>();
  private nextId = 1;
  private stopping = false;
  private onReady: ((spec: SymbolSpec) => void) | null = null;
  private firstTick = true;
  private skewWarned = false;
  private readonly offsetMs: number;

  constructor(private readonly o: Mt5LocalOptions) {
    this.offsetMs = o.serverUtcOffsetHours * 3_600_000;
  }

  /** Spawns the bridge and waits until the terminal answered with the symbol spec. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onReady = null;
        this.child?.kill();
        reject(new Error('MT5 bridge not ready — is the terminal open, logged in, and `pip install MetaTrader5` done?'));
      }, this.o.readyTimeoutMs ?? 60_000);
      this.onReady = () => {
        clearTimeout(timer);
        resolve();
      };
      this.spawn((code) => {
        if (!this.onReady) return false;
        clearTimeout(timer);
        this.onReady = null;
        this.stopping = true;
        reject(new Error(`MT5 bridge exited (${code}) before it was ready`));
        return true;
      });
    });
  }

  private spawn(onEarlyExit?: (code: number | null) => boolean) {
    const python = this.o.python ?? (process.platform === 'win32' ? 'python' : 'python3');
    const { cmd, args } = this.o.command ?? {
      cmd: python,
      args: [BRIDGE, '--symbol', this.o.symbol, ...(this.o.terminalPath ? ['--path', this.o.terminalPath] : [])],
    };
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child = child;
    this.firstTick = true;
    createInterface({ input: child.stdout }).on('line', (l) => this.onLine(l));
    createInterface({ input: child.stderr }).on('line', (l) => log.warn({ bridge: l }, 'MT5 bridge stderr'));
    child.on('error', (err) => {
      log.error({ err }, `cannot start MT5 bridge (${cmd})`);
      onEarlyExit?.(null);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      for (const done of this.pending.values()) done([]);
      this.pending.clear();
      if (this.stopping || onEarlyExit?.(code)) return;
      // No ticks while the bridge is down: the core simply sees no quotes until it is back.
      log.error({ code }, 'MT5 bridge exited — restarting');
      setTimeout(() => this.stopping || this.spawn(), this.o.restartDelayMs ?? 5_000);
    });
  }

  private onLine(line: string) {
    let m: Msg;
    try {
      m = JSON.parse(line) as Msg;
    } catch {
      log.warn({ line }, 'MT5 bridge: unparsable line');
      return;
    }
    switch (m.type) {
      case 'ready': {
        const a = m.account;
        log.info(
          { login: a.login, server: a.server, company: a.company, account: ['demo', 'contest', 'real'][a.tradeMode] ?? a.tradeMode },
          'MT5 terminal attached',
        );
        this.spec_ = m.spec;
        this.onReady?.(m.spec);
        this.onReady = null;
        break;
      }
      case 'tick': {
        const time = new Date(m.msc - this.offsetMs);
        // The first tick after (re)attach can be hours old (market closed); later ones are live.
        if (!this.firstTick && !this.skewWarned && Math.abs(Date.now() - time.getTime()) > MAX_SKEW_MS) {
          this.skewWarned = true;
          const guess = Math.round((m.msc - Date.now()) / 3_600_000);
          log.error(
            { tickUtc: time.toISOString(), suggestedServerUtcOffsetHours: guess },
            'MT5 tick time is far from the clock — check serverUtcOffsetHours in broker_profile.json (sessions, news and weekend close depend on it)',
          );
        }
        this.firstTick = false;
        this.router?.push({ time, bid: m.bid, ask: m.ask });
        break;
      }
      case 'status':
        if (m.connected) log.info('MT5 terminal connected to broker server');
        else log.warn('MT5 terminal is NOT connected to the broker server — no prices');
        break;
      case 'history':
        this.pending.get(m.id)?.(
          m.bars.map((b) => ({ time: new Date(b.t * 1000 - this.offsetMs), open: b.o, high: b.h, low: b.l, close: b.c })),
        );
        this.pending.delete(m.id);
        break;
      case 'error':
        log.error({ bridge: m.message }, 'MT5 bridge error');
        break;
    }
  }

  async start(h: FeedHandlers) {
    this.router = new QuoteRouter(h);
  }

  async stop() {
    this.stopping = true;
    this.child?.kill();
    await this.router?.idle();
  }

  spec(): SymbolSpec | null {
    return this.spec_;
  }

  history(bars: number): Promise<Bar[]> {
    const child = this.child;
    if (!child) return Promise.resolve([]);
    const id = this.nextId++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve([]);
      }, 10_000);
      this.pending.set(id, (b) => {
        clearTimeout(timer);
        resolve(b);
      });
      child.stdin.write(`${JSON.stringify({ id, cmd: 'history', n: bars })}\n`);
    });
  }
}
