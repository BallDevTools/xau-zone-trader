/** Cumulative R as a simple SVG line; 0R baseline dashed. */
export function EquityCurve({ curve }: { curve: number[] }) {
  const pts = [0, ...curve];
  const W = 360;
  const H = 120;
  const lo = Math.min(0, ...pts);
  const hi = Math.max(0, ...pts);
  const span = hi - lo || 1;
  const x = (i: number) => (pts.length > 1 ? (i / (pts.length - 1)) * W : 0);
  const y = (v: number) => 8 + ((hi - v) / span) * (H - 16);
  const line = pts.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = pts.at(-1) ?? 0;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[180px] w-full"
      role="img"
      aria-label={`ผลสะสม ${pts.length - 1} เทรด ปัจจุบัน ${last.toFixed(2)}R`}
    >
      <line x1="0" x2={W} y1={y(0)} y2={y(0)} stroke="#2a3340" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
      {pts.length > 1 && (
        <polyline points={line} fill="none" stroke="#e8b45a" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
