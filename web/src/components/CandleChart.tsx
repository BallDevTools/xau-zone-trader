import { CandlestickSeries, createChart, LineStyle } from 'lightweight-charts';
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { CandleDTO } from '../api';
import type { PlanDTO } from '../../../src/dashboard/types';

const UP = '#3fcf8e';
const DOWN = '#ff6b7a';

/** M15 candles with every plan zone drawn as price lines (edges, entry, SL, TP). */
export function CandleChart({ candles, plan }: { candles: CandleDTO[]; plan: PlanDTO | null }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: '#94a0b4', fontFamily: 'IBM Plex Mono, monospace' },
      grid: { vertLines: { color: '#1a212b' }, horzLines: { color: '#1a212b' } },
      rightPriceScale: { borderColor: '#232b37' },
      timeScale: { borderColor: '#232b37', timeVisible: true },
      crosshair: { mode: 0 },
    });
    series.current = c.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN,
    });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    series.current?.setData(candles.map((k) => ({ ...k, time: k.time as UTCTimestamp })));
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    const s = series.current;
    if (!s || !plan) return;
    const lines = plan.zones.flatMap((z) => {
      const color = !z.ok ? '#6b7689' : z.side === 'BUY' ? UP : DOWN;
      const common = { lineWidth: 1 as const, axisLabelVisible: false };
      return [
        s.createPriceLine({ ...common, price: z.high, color, lineStyle: LineStyle.Solid, title: `${z.id} ${z.side}` }),
        s.createPriceLine({ ...common, price: z.low, color, lineStyle: LineStyle.Solid, title: '' }),
        ...(z.ok
          ? [
              s.createPriceLine({ ...common, price: z.sl, color: DOWN, lineStyle: LineStyle.Dotted, title: `SL ${z.id}` }),
              s.createPriceLine({ ...common, price: z.tp[0]!, color: UP, lineStyle: LineStyle.Dotted, title: `TP ${z.id}` }),
            ]
          : []),
      ];
    });
    const em = [plan.refSpot + plan.expectedMove, plan.refSpot - plan.expectedMove].map((p) =>
      s.createPriceLine({ price: p, color: '#8dbdff', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: 'EM' }),
    );
    return () => [...lines, ...em].forEach((l) => s.removePriceLine(l));
  }, [plan]);

  return <div ref={host} className="h-[520px] w-full" role="img" aria-label="กราฟแท่งเทียน M15 พร้อมโซนของแผน" />;
}
