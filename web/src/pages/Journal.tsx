import { useEffect, useMemo, useState } from 'react';
import { ddmm, getJson, hhmm, holdTime, pct, price, signed } from '../api';
import type { JournalDTO } from '../api';
import type { Stats, TradeRow } from '../../../src/dashboard/types';
import { Empty, Label, Panel, Pill, rTone, sideTone, toneText } from '../ui';

type Range = 'today' | 'week' | 'month' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: 'วันนี้' },
  { id: 'week', label: '7 วัน' },
  { id: 'month', label: '30 วัน' },
  { id: 'all', label: 'ทั้งหมด' },
];
const REJECT_TH: Record<string, string> = {
  SPREAD: 'Spread เกิน',
  SL_TOO_WIDE: 'SL กว้างเกิน',
  COOLDOWN: 'Cooldown หลัง SL',
  NEWS_BLACKOUT: 'ช่วงข่าว',
  NEWS_UNAVAILABLE: 'ปฏิทินข่าวใช้ไม่ได้',
  DAILY_LOSSES: 'แพ้ครบวันนี้',
  DAILY_TRADES: 'เทรดครบวันนี้',
  DAILY_LOSS_USD: 'ชนลิมิตขาดทุนวัน',
  MAX_POSITIONS: 'มี position อยู่แล้ว',
  RR: 'R:R ต่ำ',
  WEEKEND: 'ใกล้ปิดตลาดสุดสัปดาห์',
  KILL: 'Kill switch',
};

/** Ranges are relative to the server clock, so replays of old data filter correctly. */
function fromIso(r: Range, now: string): string | undefined {
  if (r === 'all') return undefined;
  const d = new Date(now);
  if (r === 'today') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
  return new Date(d.getTime() - (r === 'week' ? 7 : 30) * 86_400_000).toISOString();
}

function toCsv(rows: TradeRow[]) {
  const cols: (keyof TradeRow)[] = ['id', 'open_time', 'close_time', 'zone_id', 'side', 'strategy', 'lot', 'open_price', 'sl', 'tp', 'close_price', 'exit_reason', 'spread_open', 'mae', 'mfe', 'pnl', 'r'];
  return [cols.join(','), ...rows.map((r) => cols.map((c) => r[c] ?? '').join(','))].join('\n');
}

export function Journal({ mode, now }: { mode: string; now: string }) {
  const [range, setRange] = useState<Range>('week');
  const [trigger, setTrigger] = useState('');
  const [data, setData] = useState<JournalDTO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    const from = fromIso(range, now);
    if (from) qs.set('from', from);
    if (trigger) qs.set('trigger', trigger);
    const load = () =>
      getJson<JournalDTO>(`/api/journal?${qs}`)
        .then((d) => {
          setData(d);
          setError(null);
        })
        .catch((e: Error) => setError(e.message));
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [range, trigger, now.slice(0, 10)]);

  const csvHref = useMemo(() => (data ? URL.createObjectURL(new Blob([toCsv(data.trades)], { type: 'text/csv' })) : undefined), [data]);
  useEffect(() => () => { if (csvHref) URL.revokeObjectURL(csvHref); }, [csvHref]);

  const s = data?.stats;
  const rejectTotal = data?.rejects.reduce((a, r) => a + r.n, 0) ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div role="group" aria-label="ช่วงเวลา" className="flex rounded-[10px] border border-line bg-panel p-[3px]">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              aria-pressed={range === r.id}
              onClick={() => setRange(r.id)}
              className={`min-h-[38px] cursor-pointer rounded-[7px] border-0 px-3.5 text-[13px] ${range === r.id ? 'bg-line text-ink' : 'bg-transparent text-mute hover:text-ink'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] text-mute">
          Trigger
          <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="min-h-10 rounded-lg border border-line bg-panel px-2.5 text-[13px] text-ink">
            <option value="">ทั้งหมด</option>
            <option value="reject">Reject</option>
            <option value="break">Break</option>
          </select>
        </label>
        <span className="text-xs text-mute">โหมด {mode}</span>
        {csvHref && (
          <a href={csvHref} download={`journal-${mode}-${range}.csv`} className="ml-auto flex min-h-11 items-center rounded-lg border border-line bg-panel px-4 text-sm text-ink no-underline hover:bg-panel2">
            ส่งออก CSV
          </a>
        )}
      </div>

      {error && <div role="alert" className="text-sm text-down">{error}</div>}

      <section aria-label="สรุป" className="grid grid-cols-[repeat(auto-fit,minmax(min(150px,100%),1fr))] gap-3">
        {[
          ['Setup', s ? String(s.setups) : '—', 'ink'],
          ['Win rate', s?.setups ? pct(s.winRate) : '—', 'ink'],
          ['ผลรวม', s?.setups ? signed(s.totalR, 2, 'R') : '—', s && s.totalR < 0 ? 'down' : 'up'],
          ['Expectancy', s?.setups ? signed(s.expectancyR, 2, 'R') : '—', 'gold'],
          ['Spread เฉลี่ยตอนเข้า', data?.avgSpread?.toFixed(2) ?? '—', 'ink'],
          ['Gateway ปฏิเสธ', String(rejectTotal), 'ink'],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-line bg-panel px-4 py-3.5">
            <Label>{label}</Label>
            <div className={`num mt-1 text-xl font-semibold ${toneText[tone as keyof typeof toneText]}`}>{value}</div>
          </div>
        ))}
      </section>

      <Panel>
        {data?.trades.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-xs text-mute">
                  {['#', 'เวลา', 'โซน', 'ฝั่ง', 'Trigger'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2.5 font-medium">{h}</th>)}
                  {['Entry', 'SL', 'Exit', 'Spread', 'MAE / MFE'].map((h) => <th key={h} className="whitespace-nowrap px-2 py-2.5 text-right font-medium">{h}</th>)}
                  <th className="px-2 py-2.5 font-medium">ถือ</th>
                  <th className="px-2 py-2.5 font-medium">ออกด้วย</th>
                  <th className="px-2 py-2.5 text-right font-medium">R</th>
                </tr>
              </thead>
              <tbody>
                {data.trades.map((t) => (
                  <tr key={t.id} className="border-t border-line2">
                    <td className="num whitespace-nowrap px-2 py-2.5 text-mute">{t.id}</td>
                    <td className="num whitespace-nowrap px-2 py-2.5">{ddmm(t.open_time)} {hhmm(t.open_time)}</td>
                    <td className="num px-2 py-2.5 font-semibold">{t.zone_id}</td>
                    <td className={`px-2 py-2.5 font-semibold ${toneText[sideTone(t.side)]}`}>{t.side}</td>
                    <td className="px-2 py-2.5 capitalize text-ink2">{t.strategy.replace('zone-', '')}</td>
                    <td className="num px-2 py-2.5 text-right">{price(t.open_price)}</td>
                    <td className="num px-2 py-2.5 text-right text-mute">{price(t.sl)}</td>
                    <td className="num px-2 py-2.5 text-right">{price(t.close_price)}</td>
                    <td className="num px-2 py-2.5 text-right text-mute">{t.spread_open.toFixed(2)}</td>
                    <td className="num whitespace-nowrap px-2 py-2.5 text-right text-mute">{signed(t.mae ?? 0, 1)} / {signed(t.mfe ?? 0, 1)}</td>
                    <td className="num px-2 py-2.5 text-mute">{holdTime(t.open_time, t.close_time)}</td>
                    <td className="px-2 py-2.5"><Pill tone={rTone(t.r)}>{t.exit_reason}</Pill></td>
                    <td className={`num px-2 py-2.5 text-right font-semibold ${toneText[rTone(t.r)]}`}>{signed(t.r ?? 0, 2, 'R')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>ยังไม่มีเทรดในช่วงนี้</Empty>
        )}
      </Panel>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-5">
        <Breakdown title="ตาม Trigger" groups={data?.byTrigger} note="ถ้า trigger ใดยังติดลบหลังครบ 20 setup ให้ปิด trigger นั้น" />
        <Breakdown title="ตามเซสชัน" groups={data?.bySession} names={{ asia: 'เอเชีย', london: 'ลอนดอน', newyork: 'นิวยอร์ก' }} note="กลุ่มที่ n < 20 ยังสรุปไม่ได้" />
        <Panel title="Gateway ปฏิเสธ">
          {data?.rejects.length ? (
            data.rejects.map((r) => (
              <div key={r.code} className="flex justify-between border-t border-line2 py-2 text-[13px] first:border-0">
                <span className="text-ink2">{REJECT_TH[r.code] ?? r.code}</span>
                <span className="num font-semibold">{r.n}</span>
              </div>
            ))
          ) : (
            <Empty>ยังไม่มีการปฏิเสธ</Empty>
          )}
        </Panel>
      </div>
    </>
  );
}

function Breakdown({ title, groups, names = {}, note }: { title: string; groups?: Record<string, Stats>; names?: Record<string, string>; note: string }) {
  const rows = Object.entries(groups ?? {});
  return (
    <Panel title={title}>
      {rows.length ? (
        rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2.5 border-t border-line2 py-2 text-[13px] first:border-0">
            <span className="capitalize text-ink2">{names[k] ?? k}</span>
            <span className="flex gap-3.5">
              <span className={`num ${v.setups < 20 ? 'text-gold' : 'text-mute'}`}>n={v.setups}</span>
              <span className="num text-mute">{pct(v.winRate, 0)}</span>
              <span className={`num min-w-16 text-right font-semibold ${toneText[rTone(v.expectancyR)]}`}>{signed(v.expectancyR, 2, 'R')}</span>
            </span>
          </div>
        ))
      ) : (
        <Empty>ยังไม่มีข้อมูล</Empty>
      )}
      <div className="mt-2 text-xs text-mute">{note}</div>
    </Panel>
  );
}
