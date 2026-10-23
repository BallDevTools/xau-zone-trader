import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { postKill, price, useLiveState } from './api';
import type { StateDTO } from './api';
import { Journal } from './pages/Journal';
import { Overview } from './pages/Overview';
import { PlanPage } from './pages/Plan';
import { Label } from './ui';

type Route = 'overview' | 'plan' | 'journal';
const ROUTES: { id: Route; label: string; icon: ReactNode }[] = [
  { id: 'overview', label: 'ภาพรวม', icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z" /> },
  { id: 'plan', label: 'แผนวันนี้', icon: <path d="M4 7h16M4 12h16M4 17h10" /> },
  { id: 'journal', label: 'Journal', icon: <path d="M6 3h11a2 2 0 0 1 2 2v16l-4-2-4 2-4-2-3 2V5a2 2 0 0 1 2-2z" /> },
];
const fromHash = (): Route => (location.hash.replace('#/', '') as Route) || 'overview';

const MODE_TONE: Record<string, string> = {
  live: 'bg-down/15 text-down',
  shadow: 'bg-info/15 text-info',
  replay: 'bg-gold/15 text-gold2',
  backtest: 'bg-mute/10 text-mute',
};

export function App() {
  const [route, setRoute] = useState<Route>(fromHash());
  const { state, online } = useLiveState();
  useEffect(() => {
    const on = () => setRoute(fromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  return (
    <div className="flex min-h-screen flex-wrap">
      <Sidebar route={route} state={state} online={online} />
      <main className="flex min-w-0 flex-[999_1_560px] flex-col gap-5 px-4 pb-10 pt-5 sm:px-7">
        <Header route={route} state={state} />
        {state?.killed && (
          <div role="alert" className="rounded-xl border border-down/60 bg-down/10 px-4 py-3 text-sm">
            <b className="text-down">Kill switch ทำงานอยู่</b> — {state.killed.reason} · ตั้งแต่ {new Date(state.killed.at).toLocaleString('th-TH')}
            <div className="text-mute">ปลดได้จากเครื่องเท่านั้น: <code className="num">npm run unkill -- --mode={state.mode}</code></div>
          </div>
        )}
        {!state ? (
          <div className="py-20 text-center text-mute">กำลังเชื่อมต่อ…</div>
        ) : route === 'overview' ? (
          <Overview s={state} />
        ) : route === 'plan' ? (
          <PlanPage s={state} />
        ) : (
          <Journal mode={state.mode} now={state.serverTime} />
        )}
      </main>
    </div>
  );
}

function Sidebar({ route, state, online }: { route: Route; state: StateDTO | null; online: boolean }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <nav aria-label="เมนูหลัก" className="box-border flex max-w-full flex-[1_1_220px] flex-col gap-6 border-line px-3.5 py-5 sm:border-r">
      <div className="flex items-center gap-2.5 px-2">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-gold">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0b0e13" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 17l6-6 4 4 8-8" />
            <path d="M14 7h7v7" />
          </svg>
        </div>
        <div>
          <div className="text-[15px] font-semibold">XAU Zone Trader</div>
          <Label>{state?.broker ?? '—'}</Label>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        {ROUTES.map((r) => (
          <a
            key={r.id}
            href={`#/${r.id}`}
            aria-current={route === r.id ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm no-underline ${route === r.id ? 'bg-panel2 text-ink' : 'text-mute hover:bg-panel2 hover:text-ink'}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              {r.icon}
            </svg>
            {r.label}
          </a>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-2.5 rounded-xl border border-line bg-panel p-3.5">
        <div className="flex items-center justify-between">
          <Label>{state?.feed === 'replay' ? 'Replay feed' : 'MetaAPI'}</Label>
          <span className={`flex items-center gap-1.5 text-xs ${online && state?.quote ? 'text-up' : 'text-down'}`}>
            <span className={`h-[7px] w-[7px] rounded-full ${online && state?.quote ? 'bg-up' : 'bg-down'}`} />
            {online && state?.quote ? 'เชื่อมต่อ' : 'ขาดการเชื่อมต่อ'}
          </span>
        </div>
        {confirming ? (
          <div className="flex flex-col gap-2">
            <div className="text-xs text-ink2">ปิดทุกออเดอร์และหยุดระบบ?</div>
            <div className="flex gap-2">
              <button
                type="button"
                className="min-h-11 flex-1 cursor-pointer rounded-lg border-0 bg-down font-semibold text-bg"
                onClick={() => {
                  void postKill('manual from dashboard');
                  setConfirming(false);
                }}
              >
                ยืนยัน
              </button>
              <button type="button" className="min-h-11 flex-1 cursor-pointer rounded-lg border border-line bg-transparent text-ink" onClick={() => setConfirming(false)}>
                ยกเลิก
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!!state?.killed}
            onClick={() => setConfirming(true)}
            className="min-h-11 cursor-pointer rounded-lg border border-down bg-transparent text-sm font-semibold text-down disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state?.killed ? 'หยุดอยู่' : 'Kill switch'}
          </button>
        )}
      </div>
    </nav>
  );
}

function Header({ route, state }: { route: Route; state: StateDTO | null }) {
  const title = ROUTES.find((r) => r.id === route)!.label;
  const q = state?.quote;
  const sessionTh = { asia: 'เอเชีย', london: 'ลอนดอน', newyork: 'นิวยอร์ก' } as const;
  const spreadOk = q && state && q.spread <= state.limits.maxSpreadPts;
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-[22px] font-semibold">{title}</h1>
        {state && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${MODE_TONE[state.mode]}`}>{state.mode}</span>}
        {state && <Label>{new Date(state.serverTime).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })}</Label>}
      </div>
      <div className="flex flex-wrap items-center gap-5 rounded-xl border border-line bg-panel px-4 py-2.5">
        <div>
          <Label>{state?.symbol ?? 'XAUUSDm'} · Bid</Label>
          <div className="num text-lg font-semibold">{price(q?.bid)}</div>
        </div>
        <div>
          <Label>Ask</Label>
          <div className="num text-lg font-semibold">{price(q?.ask)}</div>
        </div>
        <div>
          <Label>Spread</Label>
          <div className={`num text-lg font-semibold ${spreadOk ? 'text-up' : 'text-down'}`}>{q ? q.spread.toFixed(2) : '—'}</div>
        </div>
        <div>
          <Label>เซสชัน</Label>
          <div className="mt-0.5 text-sm font-medium">{state ? sessionTh[state.session] : '—'}</div>
        </div>
      </div>
    </header>
  );
}
