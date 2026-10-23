import { useEffect, useState } from 'react';
import type { CandleDTO, JournalDTO, StateDTO } from '../../src/dashboard/types';

export type { CandleDTO, JournalDTO, StateDTO };

/**
 * Live state over SSE; reconnects automatically (EventSource retries on its own).
 * `?poll` in the URL switches to 2 s polling for networks/proxies that block SSE.
 */
export function useLiveState(): { state: StateDTO | null; online: boolean } {
  const [state, setState] = useState<StateDTO | null>(null);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const load = () =>
      getJson<StateDTO>('/api/state')
        .then((s) => {
          setState(s);
          setOnline(true);
        })
        .catch(() => setOnline(false));
    if (new URLSearchParams(location.search).has('poll')) {
      void load();
      const t = setInterval(load, 2000);
      return () => clearInterval(t);
    }
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      setState(JSON.parse(e.data) as StateDTO);
      setOnline(true);
    };
    es.onerror = () => setOnline(false);
    return () => es.close();
  }, []);
  return { state, online };
}

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

export async function postKill(reason: string) {
  await fetch('/api/kill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
}

// ── formatting ──
const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const price = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? '—' : nf(d).format(n));
export const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${n < 0 ? '−' : ''}$${nf(2).format(Math.abs(n))}`;
export const signed = (n: number, d = 2, unit = '') => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(d).format(Math.abs(n))}${unit}`;
export const pct = (n: number, d = 1) => `${nf(d).format(n * 100)}%`;
export const hhmm = (iso: string) =>
  new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false });
export const ddmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const holdTime = (a: string, b: string | null) => {
  if (!b) return '—';
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};
