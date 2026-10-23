import { useEffect, useState } from 'react';
import { getJson, signed } from '../api';
import type { CandleDTO, StateDTO } from '../api';
import { CandleChart } from '../components/CandleChart';
import { Empty, Label, Panel, Pill, Stat, sideTone, toneText } from '../ui';
import { zoneStatus } from './Overview';

export function PlanPage({ s }: { s: StateDTO }) {
  const [candles, setCandles] = useState<CandleDTO[]>([]);
  useEffect(() => {
    const load = () => getJson<CandleDTO[]>('/api/candles').then(setCandles).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  const p = s.plan;
  if (!p)
    return (
      <Empty>
        ยังไม่มีแผนของวันนี้ ({s.today.date}) — เปิด Claude Code ในโฟลเดอร์โปรเจคแล้วพิมพ์ <code className="num">/plan</code> พร้อมแนบข้อมูล CME
        <br />
        ระบบจะโหลด <code className="num">config/plans/{s.today.date}.json</code> เองเมื่อแท่ง M15 ถัดไปปิด
      </Empty>
    );

  const usable = p.zones.filter((z) => z.ok).length;
  const skipped = p.zones.length - usable;
  const checks = [
    { label: 'Schema ถูกต้อง', ok: true, detail: `${p.zones.length} โซน` },
    { label: 'แผนใช้ได้', ok: p.planIssues.length === 0, detail: p.planIssues.join('; ') || 'basis ตรง · ราคายังอยู่ในกรอบ' },
    ...p.zones.map((z) => ({ label: `${z.id} ${z.side}`, ok: z.ok, detail: z.ok ? `SL ${z.slDistance} pts · R:R ${z.rr}` : z.issues.join('; ') })),
  ];

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Pill tone={usable ? 'up' : 'down'}>{usable ? `ผ่าน Validator${skipped ? ` · ข้าม ${skipped} โซน` : ''}` : 'ไม่มีโซนที่ใช้ได้'}</Pill>
        <Label>
          config/plans/{p.date}.json · สร้างโดย {p.createdBy}
          {p.createdAt ? ` ${new Date(p.createdAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </Label>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <Panel title={`กราฟ M15 · ${s.symbol}`} className="min-w-0 flex-[2_1_560px]" right={<span className="text-xs text-mute">เส้นประฟ้า = expected move · จุดแดง/เขียว = SL/TP</span>}>
          {candles.length ? <CandleChart candles={candles} plan={p} /> : <Empty>กำลังโหลดกราฟ…</Empty>}
        </Panel>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <Panel title="บริบทจาก CME">
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Bias"><span className="font-sans font-semibold uppercase text-gold">{p.bias}</span></Stat>
              <Stat label="Basis (GC − spot)">{signed(p.basis, 1)}</Stat>
              <Stat label="Expected move">±{p.expectedMove}</Stat>
              <Stat label="IV">{p.iv ? `${p.iv}%` : '—'}</Stat>
              <Stat label="Ref spot">{p.refSpot}</Stat>
              <Stat label="GC ref">{p.gcRef ?? '—'}</Stat>
            </div>
            {p.notes && <p className="mb-0 mt-3 text-[13px] text-ink2">{p.notes}</p>}
          </Panel>

          <Panel title="Validator">
            <div className="flex flex-col gap-2.5">
              {checks.map((c) => (
                <div key={c.label} className="flex items-start gap-2.5 text-[13px]">
                  <span className={`flex h-5 w-5 flex-none items-center justify-center rounded-full text-[11px] font-bold ${c.ok ? 'bg-up/15 text-up' : 'bg-down/15 text-down'}`} aria-label={c.ok ? 'ผ่าน' : 'ไม่ผ่าน'}>
                    {c.ok ? '✓' : '×'}
                  </span>
                  <div className="min-w-0">
                    <div>{c.label}</div>
                    <div className="text-xs text-mute">{c.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      <section aria-label="รายละเอียดโซน" className="grid grid-cols-[repeat(auto-fit,minmax(min(260px,100%),1fr))] gap-3">
        {p.zones.map((z) => {
          const st = zoneStatus(z);
          return (
            <article key={z.id} className={`flex flex-col gap-3 rounded-xl border border-line bg-panel px-[18px] py-4 ${z.ok ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="num text-lg font-semibold">{z.id}</span>
                  <span className={`text-xs font-semibold ${toneText[sideTone(z.side)]}`}>{z.side}</span>
                  <span className="text-xs capitalize text-mute">{z.trigger}</span>
                </div>
                <Pill tone={st.tone}>{st.text}</Pill>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[13px]">
                <div><Label>Entry</Label><div className="num">{z.entry}</div></div>
                <div><Label>SL</Label><div className="num text-down">{z.sl}</div></div>
                <div><Label>TP</Label><div className="num text-up">{z.tp.join(' / ')}</div></div>
              </div>
              <div className="flex justify-between gap-2 border-t border-line2 pt-2.5 text-xs text-mute">
                <span>{z.source}</span>
                <span className="num">{z.rr}R</span>
              </div>
              {z.note && z.status !== 'disabled' && <div className="text-xs text-ink2">{z.note}</div>}
            </article>
          );
        })}
      </section>
    </>
  );
}
