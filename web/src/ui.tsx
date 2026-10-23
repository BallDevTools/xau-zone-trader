import type { ReactNode } from 'react';

export function Panel({ title, right, children, className = '' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-panel px-5 py-4 ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          {title && <h2 className="m-0 text-base font-semibold">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export const Label = ({ children }: { children: ReactNode }) => (
  <div className="text-xs tracking-wide text-mute">{children}</div>
);

export function Kpi({ label, value, sub, tone = 'ink' }: { label: string; value: string; sub?: string; tone?: Tone }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel px-[18px] py-4">
      <Label>{label}</Label>
      <div className={`num text-[26px] font-semibold ${toneText[tone]}`}>{value}</div>
      {sub && <div className="text-xs text-mute">{sub}</div>}
    </div>
  );
}

export type Tone = 'ink' | 'up' | 'down' | 'gold' | 'info' | 'mute';
export const toneText: Record<Tone, string> = {
  ink: 'text-ink',
  up: 'text-up',
  down: 'text-down',
  gold: 'text-gold',
  info: 'text-info',
  mute: 'text-mute',
};
const toneBg: Record<Tone, string> = {
  ink: 'bg-line2 text-ink2',
  up: 'bg-up/15 text-up',
  down: 'bg-down/15 text-down',
  gold: 'bg-gold/15 text-gold2',
  info: 'bg-info/15 text-info',
  mute: 'bg-mute/10 text-mute',
};

export const Pill = ({ tone = 'ink', children }: { tone?: Tone; children: ReactNode }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${toneBg[tone]}`}>{children}</span>
);

export function Meter({ label, value, ratio, tone = 'gold' }: { label: string; value: string; ratio: number; tone?: Tone }) {
  const bar: Record<Tone, string> = { ink: 'bg-ink', up: 'bg-up', down: 'bg-down', gold: 'bg-gold', info: 'bg-info', mute: 'bg-mute' };
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-[13px]">
        <span className="text-mute">{label}</span>
        <span className="num">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded bg-line2">
        <div className={`h-1.5 rounded ${bar[tone]}`} style={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }} />
      </div>
    </div>
  );
}

export const Stat = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="rounded-lg bg-panel2 px-3 py-2.5">
    <Label>{label}</Label>
    <div className="num mt-0.5">{children}</div>
  </div>
);

export const sideTone = (side: string): Tone => (side === 'BUY' ? 'up' : 'down');
export const rTone = (r: number | null | undefined): Tone => (r === null || r === undefined ? 'mute' : r > 0 ? 'up' : r < 0 ? 'down' : 'ink');

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-mute">{children}</div>;
}
