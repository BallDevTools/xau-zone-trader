import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { DayStats, Decision } from '../risk/Gateway';
import type { ClosedTrade, Mode, Position, Side } from '../types';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE events (
    id INTEGER PRIMARY KEY, time TEXT NOT NULL, mode TEXT NOT NULL, kind TEXT NOT NULL,
    message TEXT NOT NULL, data TEXT
  );
  CREATE TABLE plans (
    date TEXT PRIMARY KEY, loaded_at TEXT NOT NULL, json TEXT NOT NULL, issues TEXT NOT NULL
  );
  CREATE TABLE signals (
    id INTEGER PRIMARY KEY, time TEXT NOT NULL, mode TEXT NOT NULL, plan_date TEXT NOT NULL,
    zone_id TEXT NOT NULL, side TEXT NOT NULL, trigger TEXT NOT NULL, sl REAL NOT NULL, tp REAL NOT NULL
  );
  CREATE TABLE risk_decisions (
    id INTEGER PRIMARY KEY, time TEXT NOT NULL, mode TEXT NOT NULL, signal_id INTEGER,
    zone_id TEXT, side TEXT, ok INTEGER NOT NULL, code TEXT, reason TEXT, lot REAL,
    spread REAL, risk_usd REAL, equity REAL
  );
  CREATE TABLE trades (
    id INTEGER PRIMARY KEY, mode TEXT NOT NULL, position_id TEXT NOT NULL, strategy TEXT NOT NULL,
    plan_date TEXT NOT NULL, zone_id TEXT NOT NULL, side TEXT NOT NULL, lot REAL NOT NULL,
    open_time TEXT NOT NULL, open_day TEXT NOT NULL, open_price REAL NOT NULL,
    sl REAL NOT NULL, tp REAL NOT NULL, spread_open REAL NOT NULL,
    close_time TEXT, close_day TEXT, close_price REAL, exit_reason TEXT,
    pnl REAL, r REAL, mae REAL, mfe REAL
  );
  CREATE INDEX trades_mode_open ON trades (mode, open_day);
  CREATE INDEX trades_mode_close ON trades (mode, close_day);
  CREATE TABLE spreads (time TEXT NOT NULL, hour INTEGER NOT NULL, spread REAL NOT NULL);
  CREATE INDEX spreads_hour ON spreads (hour);
  `,
];

export interface TradeRow {
  id: number;
  mode: Mode;
  position_id: string;
  strategy: string;
  plan_date: string;
  zone_id: string;
  side: Side;
  lot: number;
  open_time: string;
  open_price: number;
  sl: number;
  tp: number;
  spread_open: number;
  close_time: string | null;
  close_price: number | null;
  exit_reason: string | null;
  pnl: number | null;
  r: number | null;
  mae: number | null;
  mfe: number | null;
}

export interface DecisionRow {
  id: number;
  time: string;
  zone_id: string | null;
  side: string | null;
  ok: number;
  code: string | null;
  reason: string | null;
  lot: number | null;
  spread: number | null;
}

export interface EventRow {
  id: number;
  time: string;
  kind: string;
  message: string;
}

export class Journal {
  readonly db: Database.Database;

  constructor(
    path: string,
    readonly mode: Mode,
    private readonly dayOf: (d: Date) => string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }

  private migrate() {
    const version = this.db.pragma('user_version', { simple: true }) as number;
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.transaction(() => {
        this.db.exec(MIGRATIONS[v]!);
        this.db.pragma(`user_version = ${v + 1}`);
      })();
    }
  }

  close() {
    this.db.close();
  }

  // ── kill switch (persisted per mode so a restart stays stopped) ──
  getKill(): { reason: string; at: string } | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(`kill:${this.mode}`) as
      | { value: string }
      | undefined;
    return row ? JSON.parse(row.value) : null;
  }

  setKill(reason: string, at: Date) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(`kill:${this.mode}`, JSON.stringify({ reason, at: at.toISOString() }));
  }

  clearKill() {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(`kill:${this.mode}`);
  }

  // ── events ──
  event(time: Date, kind: string, message: string, data?: unknown) {
    this.db
      .prepare('INSERT INTO events (time, mode, kind, message, data) VALUES (?, ?, ?, ?, ?)')
      .run(time.toISOString(), this.mode, kind, message, data === undefined ? null : JSON.stringify(data));
  }

  recentEvents(limit = 50): EventRow[] {
    return this.db
      .prepare('SELECT id, time, kind, message FROM events WHERE mode = ? ORDER BY id DESC LIMIT ?')
      .all(this.mode, limit) as EventRow[];
  }

  // ── plans ──
  savePlan(date: string, loadedAt: Date, json: unknown, issues: unknown) {
    this.db
      .prepare(
        `INSERT INTO plans (date, loaded_at, json, issues) VALUES (?, ?, ?, ?)
         ON CONFLICT(date) DO UPDATE SET loaded_at = excluded.loaded_at, json = excluded.json, issues = excluded.issues`,
      )
      .run(date, loadedAt.toISOString(), JSON.stringify(json), JSON.stringify(issues));
  }

  // ── signals & gateway decisions ──
  signal(time: Date, planDate: string, zoneId: string, side: Side, trigger: string, sl: number, tp: number): number {
    const res = this.db
      .prepare(
        'INSERT INTO signals (time, mode, plan_date, zone_id, side, trigger, sl, tp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(time.toISOString(), this.mode, planDate, zoneId, side, trigger, sl, tp);
    return Number(res.lastInsertRowid);
  }

  decision(time: Date, signalId: number | null, zoneId: string | null, side: Side | null, d: Decision, equity: number) {
    this.db
      .prepare(
        `INSERT INTO risk_decisions (time, mode, signal_id, zone_id, side, ok, code, reason, lot, spread, risk_usd, equity)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        time.toISOString(),
        this.mode,
        signalId,
        zoneId,
        side,
        d.ok ? 1 : 0,
        d.ok ? null : d.code,
        d.ok ? null : d.reason,
        d.ok ? d.lot : null,
        d.spread,
        d.ok ? d.riskUsd : null,
        equity,
      );
  }

  recentDecisions(limit = 50): DecisionRow[] {
    return this.db
      .prepare(
        `SELECT id, time, zone_id, side, ok, code, reason, lot, spread FROM risk_decisions
         WHERE mode = ? ORDER BY id DESC LIMIT ?`,
      )
      .all(this.mode, limit) as DecisionRow[];
  }

  rejectCounts(fromIso: string): { code: string; n: number }[] {
    return this.db
      .prepare(
        `SELECT code, COUNT(*) AS n FROM risk_decisions WHERE mode = ? AND ok = 0 AND time >= ?
         GROUP BY code ORDER BY n DESC`,
      )
      .all(this.mode, fromIso) as { code: string; n: number }[];
  }

  // ── trades ──
  openTrade(p: Position): number {
    const res = this.db
      .prepare(
        `INSERT INTO trades (mode, position_id, strategy, plan_date, zone_id, side, lot, open_time, open_day,
           open_price, sl, tp, spread_open, mae, mfe)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
      )
      .run(
        this.mode,
        p.id,
        p.strategy,
        p.planDate,
        p.zoneId,
        p.side,
        p.lot,
        p.openTime.toISOString(),
        this.dayOf(p.openTime),
        p.openPrice,
        p.sl,
        p.tp,
        p.spreadAtOpen,
      );
    return Number(res.lastInsertRowid);
  }

  closeTrade(t: ClosedTrade) {
    this.db
      .prepare(
        `UPDATE trades SET close_time = ?, close_day = ?, close_price = ?, exit_reason = ?, pnl = ?, r = ?, mae = ?, mfe = ?
         WHERE mode = ? AND position_id = ? AND close_time IS NULL`,
      )
      .run(
        t.closeTime.toISOString(),
        this.dayOf(t.closeTime),
        t.closePrice,
        t.reason,
        t.pnl,
        t.r,
        t.position.mae,
        t.position.mfe,
        this.mode,
        t.position.id,
      );
  }

  openTrades(): TradeRow[] {
    return this.db
      .prepare('SELECT * FROM trades WHERE mode = ? AND close_time IS NULL ORDER BY id')
      .all(this.mode) as TradeRow[];
  }

  closedTrades(fromIso?: string, toIso?: string): TradeRow[] {
    return this.db
      .prepare(
        `SELECT * FROM trades WHERE mode = ? AND close_time IS NOT NULL
         AND open_time >= ? AND open_time < ? ORDER BY open_time`,
      )
      .all(this.mode, fromIso ?? '0000', toIso ?? '9999') as TradeRow[];
  }

  realisedPnl(): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(pnl), 0) AS s FROM trades WHERE mode = ? AND close_time IS NOT NULL')
      .get(this.mode) as { s: number };
    return row.s;
  }

  dayStats(day: string): DayStats {
    const opened = this.db
      .prepare('SELECT COUNT(*) AS n FROM trades WHERE mode = ? AND open_day = ?')
      .get(this.mode, day) as { n: number };
    const lost = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(-pnl), 0) AS usd FROM trades
         WHERE mode = ? AND close_day = ? AND pnl < 0`,
      )
      .get(this.mode, day) as { n: number; usd: number };
    return { trades: opened.n, losses: lost.n, lossUsd: Math.round(lost.usd * 100) / 100 };
  }

  lastSlAt(): Date | null {
    const row = this.db
      .prepare(
        `SELECT close_time FROM trades WHERE mode = ? AND exit_reason = 'SL' ORDER BY close_time DESC LIMIT 1`,
      )
      .get(this.mode) as { close_time: string } | undefined;
    return row ? new Date(row.close_time) : null;
  }

  // ── spread samples (live feeds only) ──
  spreadSample(time: Date, spread: number) {
    this.db
      .prepare('INSERT INTO spreads (time, hour, spread) VALUES (?, ?, ?)')
      .run(time.toISOString(), time.getUTCHours(), spread);
  }

  /** 75th percentile spread for each UTC hour that has at least `minSamples` samples. */
  hourlySpreadP75(minSamples = 30): Map<number, number> {
    const rows = this.db.prepare('SELECT hour, spread FROM spreads ORDER BY hour, spread').all() as {
      hour: number;
      spread: number;
    }[];
    const byHour = new Map<number, number[]>();
    for (const r of rows) (byHour.get(r.hour) ?? byHour.set(r.hour, []).get(r.hour)!).push(r.spread);
    const out = new Map<number, number>();
    for (const [h, xs] of byHour) if (xs.length >= minSamples) out.set(h, xs[Math.floor(xs.length * 0.75)]!);
    return out;
  }
}
