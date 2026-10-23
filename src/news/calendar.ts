import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BlackoutWindow, NewsStatus } from '../types';
import { addMinutes } from '../util/time';
import { log } from '../util/log';

export interface NewsProvider {
  status(now: Date): NewsStatus;
}

export interface NewsEvent {
  time: string;
  title: string;
}

interface Cache {
  fetchedAt: string;
  events: NewsEvent[];
}

/** Unofficial ForexFactory weekly feed (USD, high impact). */
export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
/** Older than this and the calendar counts as unavailable → the gateway blocks entries. */
const MAX_AGE_H = 26;

export function toWindows(events: NewsEvent[], beforeMin: number, afterMin: number): BlackoutWindow[] {
  return events.map((e) => {
    const t = new Date(e.time);
    return { start: addMinutes(t, -beforeMin), end: addMinutes(t, afterMin), title: e.title };
  });
}

export class ForexFactoryNews implements NewsProvider {
  private cache: Cache | null = null;

  constructor(
    private readonly cachePath: string,
    private readonly beforeMin: number,
    private readonly afterMin: number,
    private readonly url = FF_URL,
  ) {
    if (existsSync(cachePath)) {
      try {
        this.cache = JSON.parse(readFileSync(cachePath, 'utf8'));
      } catch {
        this.cache = null;
      }
    }
  }

  /** Refresh from the feed. Failures keep the old cache; staleness is handled by status(). */
  async refresh(): Promise<void> {
    try {
      const res = await fetch(this.url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as Array<{ title: string; country: string; date: string; impact: string }>;
      const events = rows
        .filter((r) => r.country === 'USD' && r.impact === 'High')
        .map((r) => ({ time: new Date(r.date).toISOString(), title: r.title }));
      this.cache = { fetchedAt: new Date().toISOString(), events };
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
      log.info({ events: events.length }, 'news calendar refreshed');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'news calendar refresh failed');
    }
  }

  status(now: Date): NewsStatus {
    if (!this.cache) return { available: false, windows: [] };
    const ageH = (now.getTime() - new Date(this.cache.fetchedAt).getTime()) / 3_600_000;
    if (ageH > MAX_AGE_H || ageH < -1) return { available: false, windows: [] };
    return { available: true, windows: toWindows(this.cache.events, this.beforeMin, this.afterMin) };
  }

  upcoming(now: Date, limit = 3): NewsEvent[] {
    return (this.cache?.events ?? []).filter((e) => new Date(e.time) >= addMinutes(now, -this.afterMin)).slice(0, limit);
  }
}

/** Backtests: historical calendars are not available, only the plan's own blackout windows apply. */
export class NoNews implements NewsProvider {
  status(): NewsStatus {
    return { available: true, windows: [] };
  }
}
