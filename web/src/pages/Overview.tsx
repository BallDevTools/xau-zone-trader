import { hhmm, pct, signed, usd } from '../api';
import type { StateDTO } from '../api';
import type { ZoneDTO } from '../../../src/dashboard/types';
import { EquityCurve } from '../components/EquityCurve';
import { Empty, Kpi, Meter, Panel, Pill, Stat, sideTone, toneText } from '../ui';
import type { Tone } from '../ui';

const EVENT_TH: Record<string, string> = {
  plan_loaded: 'แผน',
  plan_missing: 'ไม่มีแผน',
  plan_invalid: 'แผนผิด',
  kill: 'KILL',
  unkill: 'ปลด kill',
  order_error: 'ส่งไม่ได้',
};

export function zoneStatus(z: ZoneDTO): { text: string; tone: Tone } {
  switch (z.status) {
    case 'armed':
      return { text: 'รอราคา', tone: 'ink' };
    case 'broken':
      return { text: 'Break แล้ว รอ retest', tone: 'info' };
    case 'used':
      return { text: 'เข้าแล้ว', tone: 'gold' };
    case 'invalid':
      return { text: 'หมดอายุ', tone: 'mute' };
    default:
      return { text: `ข้าม: ${z.issues[0] ?? 'แผนไม่ผ่าน'}`, tone: 'mute' };
  }
}

export function Overview({ s }: { s: StateDTO }) {
  const st = s.stats;
  const acc = s.account;
  const L = s.limits;
  const be = 1 / (1 + (st.avgWinR || 1.5)); // break-even WR for the realised payoff

  const log = [
    ...s.decisions.map((d) => ({
      id: `d${d.id}`,
      time: d.time,
      kind: d.ok ? 'ผ่าน' : 'ปฏิเสธ',
      tone: (d.ok ? 'up' : 'down') as Tone,
      msg: d.ok ? `${d.side} ${d.lot} · ${d.zone_id} · spread ${d.spread}` : `${d.zone_id ?? ''} ${d.side ?? ''} · ${d.reason}`,
    })),
    ...s.events.map((e) => ({ id: `e${e.id}`, time: e.time, kind: EVENT_TH[e.kind] ?? e.kind, tone: (e.kind === 'kill' ? 'down' : 'info') as Tone, msg: e.message })),
  ]
    .sort((a, b) => b.time.localeCompare(a.time))
    .slice(0, 8);

  return (
    <>
      <section aria-label="ตัวชี้วัดหลัก" className="grid grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-3">
        <Kpi
          label={s.mode === 'live' ? 'Equity' : `Equity (${s.mode})`}
          value={usd(acc?.equity)}
          sub={acc ? `เริ่ม ${usd(acc.startBalance)} · ไม่รวม credit` : undefined}
        />
        <Kpi label="วันนี้" value={signed(s.today.r, 2, 'R')} sub={`${s.today.trades} เทรด · ${usd(s.today.pnlUsd)}`} tone={s.today.r > 0 ? 'up' : s.today.r < 0 ? 'down' : 'ink'} />
        <Kpi label="Win rate" value={st.setups ? pct(st.winRate) : '—'} sub={`${st.wins}W · ${st.losses}L · BE ${pct(be, 0)}`} />
        <Kpi label="Expectancy" value={st.setups ? signed(st.expectancyR, 2, 'R') : '—'} sub="ต่อ setup หลังหัก spread" tone="gold" />
        <Kpi label="Profit factor" value={st.profitFactor?.toFixed(2) ?? '—'} sub={st.setups ? `avg ${signed(st.avgWinR, 2, 'R')} / ${signed(st.avgLossR, 2, 'R')}` : 'ยังไม่มีเทรด'} />
      </section>

      <div className="flex flex-wrap items-start gap-5">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-5">
          <Panel title="ผลสะสม (R)" right={<span className="text-xs text-mute">{st.setups} setup · หัก spread จริงแล้ว</span>}>
            {st.setups ? (
              <>
                <EquityCurve curve={st.curve} />
                <div className="mt-2 flex flex-wrap gap-6 text-[13px] text-mute">
                  <span>รวม <span className={`num ${toneText[st.totalR >= 0 ? 'up' : 'down']}`}>{signed(st.totalR, 2, 'R')}</span></span>
                  <span>Max DD <span className="num text-down">−{st.maxDrawdownR.toFixed(2)}R</span></span>
                  <span>P&amp;L <span className="num text-ink">{usd(st.pnlUsd)}</span></span>
                </div>
              </>
            ) : (
              <Empty>ยังไม่มีเทรดที่ปิดแล้ว</Empty>
            )}
          </Panel>

          <Panel title="โซนวันนี้" right={<a href="#/plan" className="text-[13px] text-gold hover:text-gold2">ดูแผนเต็ม →</a>}>
            {s.plan ? (
              <>
                <div className="mb-3 flex flex-wrap gap-2.5 text-[13px]">
                  <span className="rounded-md bg-panel2 px-2.5 py-1">Bias <b className="uppercase text-gold">{s.plan.bias}</b></span>
                  <span className="rounded-md bg-panel2 px-2.5 py-1">Expected move <b className="num">±{s.plan.expectedMove}</b></span>
                  <span className="rounded-md bg-panel2 px-2.5 py-1">Basis <b className="num">{signed(s.plan.basis, 1)}</b></span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left text-xs text-mute">
                        {['โซน', 'ฝั่ง', 'ช่วงราคา', 'SL', 'Trigger'].map((h) => (
                          <th key={h} className="px-1.5 py-2 font-medium">{h}</th>
                        ))}
                        <th className="px-1.5 py-2 text-right font-medium">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.plan.zones.map((z) => {
                        const st2 = zoneStatus(z);
                        return (
                          <tr key={z.id} className="border-t border-line2">
                            <td className="num px-1.5 py-2.5 font-semibold">{z.id}</td>
                            <td className={`px-1.5 py-2.5 font-semibold ${toneText[sideTone(z.side)]}`}>{z.side}</td>
                            <td className="num px-1.5 py-2.5">{z.low} – {z.high}</td>
                            <td className="num px-1.5 py-2.5 text-mute">{z.slDistance} pts</td>
                            <td className="px-1.5 py-2.5 capitalize text-mute">{z.trigger}</td>
                            <td className="px-1.5 py-2.5 text-right"><Pill tone={st2.tone}>{st2.text}</Pill></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <Empty>ยังไม่มีแผนของวันนี้ — สร้างด้วย <code className="num">/plan</code> ใน Claude Code แล้วระบบจะโหลดเองเมื่อแท่ง M15 ถัดไปปิด</Empty>
            )}
          </Panel>

          {s.positions.length > 0 && (
            <Panel title="ออเดอร์ที่เปิดอยู่">
              {s.positions.map((p) => (
                <div key={p.id} className="flex flex-wrap justify-between gap-3 border-t border-line2 py-2 text-sm first:border-0">
                  <span><b className={toneText[sideTone(p.side)]}>{p.side}</b> <span className="num">{p.lot}</span> · {p.zoneId}</span>
                  <span className="num text-mute">@ {p.openPrice} · SL {p.sl} · TP {p.tp}</span>
                  <span className={`num font-semibold ${toneText[p.pnl >= 0 ? 'up' : 'down']}`}>{usd(p.pnl)}</span>
                </div>
              ))}
            </Panel>
          )}
        </div>

        <div className="flex min-w-0 flex-[1_1_320px] flex-col gap-5">
          <Panel title="Risk Gateway" right={s.cooldownLeftMin ? <Pill tone="gold">Cooldown {s.cooldownLeftMin} นาที</Pill> : <Pill tone="up">พร้อม</Pill>}>
            <div className="flex flex-col gap-4">
              <Meter label="ขาดทุนวันนี้" value={`${usd(s.today.lossUsd)} / $${L.dailyLossUsd}`} ratio={s.today.lossUsd / L.dailyLossUsd} tone={s.today.lossUsd / L.dailyLossUsd > 0.75 ? 'down' : 'gold'} />
              <Meter label="แพ้วันนี้" value={`${s.today.losses} / ${L.dailyMaxLosses}`} ratio={s.today.losses / L.dailyMaxLosses} />
              <Meter label="เทรดวันนี้" value={`${s.today.trades} / ${L.maxTradesPerDay}`} ratio={s.today.trades / L.maxTradesPerDay} tone="info" />
              <Meter
                label="Spread ตอนนี้"
                value={`${s.quote?.spread.toFixed(2) ?? '—'} / ${L.maxSpreadPts.toFixed(2)}`}
                ratio={(s.quote?.spread ?? 0) / L.maxSpreadPts}
                tone={(s.quote?.spread ?? 0) > L.maxSpreadPts ? 'down' : 'up'}
              />
              <div className="grid grid-cols-2 gap-2.5 text-[13px]">
                <Stat label="Lot">{L.fixedLot.toFixed(2)} ล็อต</Stat>
                <Stat label="SL สูงสุด">{L.maxSlPts.toFixed(1)} pts</Stat>
                <Stat label="Equity floor">{usd(L.equityFloorUsd)}</Stat>
                <Stat label="Position เปิด">{s.positions.length} / {L.maxOpenPositions}</Stat>
              </div>
              {!s.news.available ? (
                <div className="rounded-lg border border-down/50 bg-down/10 p-3 text-[13px]">
                  <b className="text-down">ปฏิทินข่าวใช้ไม่ได้</b>
                  <div className="text-mute">ระบบงดเปิดออเดอร์จนกว่าจะโหลดได้ (fail-closed)</div>
                </div>
              ) : (
                s.news.next[0] && (
                  <div className="rounded-lg border border-[#3a3220] bg-gold/5 p-3 text-[13px]">
                    <div className="font-medium">{s.news.next[0].title}</div>
                    <div className="text-mute">ห้ามเปิดออเดอร์ {hhmm(s.news.next[0].start)}–{hhmm(s.news.next[0].end)}</div>
                  </div>
                )
              )}
            </div>
          </Panel>

          <Panel title="เงื่อนไข Go-live" right={<span className="num text-[13px] text-mute">{s.gates.items.filter((g) => g.pass).length} / {s.gates.items.length}</span>}>
            <div className="flex flex-col gap-3.5">
              {s.gates.items.map((g) => (
                <div key={g.label} className="flex items-start gap-3">
                  <div className={`flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full text-xs font-bold ${g.pass ? 'bg-up/15 text-up' : 'bg-gold/15 text-gold'}`} aria-label={g.pass ? 'ผ่าน' : 'ยังไม่ผ่าน'}>
                    {g.pass ? '✓' : '·'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span>{g.label}</span>
                      <span className={`num ${g.pass ? 'text-up' : 'text-gold'}`}>{g.value}</span>
                    </div>
                    <div className="text-xs text-mute">{g.rule}</div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="บันทึก Gateway">
            {log.length ? (
              log.map((l) => (
                <div key={l.id} className="flex gap-3 border-t border-line2 py-2 text-[13px] first:border-0">
                  <span className="num w-10 flex-none text-mute">{hhmm(l.time)}</span>
                  <span className={`w-16 flex-none font-semibold ${toneText[l.tone]}`}>{l.kind}</span>
                  <span className="min-w-0 text-ink2">{l.msg}</span>
                </div>
              ))
            ) : (
              <Empty>ยังไม่มีเหตุการณ์</Empty>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
