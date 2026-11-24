import { useRef, useState } from "react";

export interface Series<T> {
  key: keyof T & string;
  label: string;
  color: string;
  format?: (value: number) => string;
}

/** Lines over days, values shown on hover (or a tap on a phone). */
export function LineChart<T extends { day: string }>({ points, series, min, max, ticks, height = 120, label }: { points: T[]; series: Series<T>[]; min: number; max: number; ticks: number[]; height?: number; label: string }) {
  const W = 340;
  const H = height;
  const P = { l: 28, r: 8, t: 8, b: 18 };
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const x = (i: number) => P.l + (i * (W - P.l - P.r)) / Math.max(1, points.length - 1);
  const y = (v: number) => P.t + (1 - (v - min) / (max - min)) * (H - P.t - P.b);
  const value = (p: T, k: keyof T) => Number(p[k]);
  const pick = (clientX: number) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return;
    const at = ((clientX - box.left) / box.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((at - P.l) / (W - P.l - P.r)) * (points.length - 1)))));
  };
  const shown = hover === null ? undefined : points[hover];
  const last = points.at(-1);
  const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className="chart">
      <svg
        ref={svg}
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={label}
        onPointerMove={(e) => {
          pick(e.clientX);
        }}
        onPointerDown={(e) => {
          pick(e.clientX);
        }}
        onPointerLeave={() => {
          setHover(null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 4} y={y(t) + 3} fill="var(--faint)" fontSize="8" textAnchor="end">
              {t}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.key}>
            <polyline fill="none" stroke={s.color} strokeWidth="2" points={points.map((p, i) => `${String(x(i))},${String(y(value(p, s.key)))}`).join(" ")} />
            {last && <rect x={x(points.length - 1) - 3} y={y(value(last, s.key)) - 3} width="6" height="6" fill={s.color} />}
          </g>
        ))}
        {points[0] && (
          <>
            <text x={P.l} y={H - 4} fill="var(--faint)" fontSize="8">
              {day(points[0].day)}
            </text>
            <text x={W - P.r} y={H - 4} fill="var(--faint)" fontSize="8" textAnchor="end">
              aujourd'hui
            </text>
          </>
        )}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={P.t} y2={H - P.b} stroke="var(--text)" strokeDasharray="2 2" />}
      </svg>
      {shown && hover !== null && (
        <div className="tip" style={{ left: `clamp(0px, calc(${String((x(hover) / W) * 100)}% - 80px), calc(100% - 200px))` }}>
          <b>{day(shown.day)}</b>
          {series.map((s) => (
            <span key={s.key} style={{ color: s.color }}>
              {" · "}
              {s.label} {s.format ? s.format(value(shown, s.key)) : value(shown, s.key)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Stacked bars per day, one colour per part, the detail on hover. */
export function StackedBars({ days, parts, format, label }: { days: { day: string; values: number[] }[]; parts: { label: string; color: string }[]; format: (n: number) => string; label: string }) {
  const W = 720;
  const H = 200;
  const P = { l: 46, r: 8, t: 10, b: 22 };
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(0.01, ...days.map((d) => d.values.reduce((a, b) => a + b, 0)));
  const max = niceMax(top);
  const bw = (W - P.l - P.r) / Math.max(1, days.length);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const shown = hover === null ? undefined : days[hover];
  const day = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${String(W)} ${String(H)}`}
        role="img"
        aria-label={label}
        onPointerLeave={() => {
          setHover(null);
        }}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={P.l - 6} y={y(t) + 4} fill="var(--faint)" fontSize="10" textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          let acc = 0;
          return (
            <g key={d.day}>
              {d.values.map((v, k) => {
                if (v <= 0) return null;
                const rect = <rect key={k} x={P.l + i * bw + 2} y={y(acc + v)} width={Math.max(1, bw - 4)} height={y(acc) - y(acc + v)} fill={parts[k]?.color ?? "var(--text)"} opacity={hover === null || hover === i ? 1 : 0.55} />;
                acc += v;
                return rect;
              })}
              <rect
                x={P.l + i * bw}
                y={P.t}
                width={bw}
                height={H - P.t - P.b}
                fill="transparent"
                onPointerEnter={() => {
                  setHover(i);
                }}
                onPointerDown={() => {
                  setHover(i);
                }}
              />
            </g>
          );
        })}
        {days[0] && (
          <>
            <text x={P.l} y={H - 6} fill="var(--faint)" fontSize="10">
              {day(days[0].day)}
            </text>
            <text x={W - P.r} y={H - 6} fill="var(--faint)" fontSize="10" textAnchor="end">
              aujourd'hui
            </text>
          </>
        )}
      </svg>
      {shown && hover !== null && (
        <div className="tip" style={{ left: `clamp(0px, calc(${String(((P.l + hover * bw) / W) * 100)}% - 90px), calc(100% - 260px))` }}>
          <b>
            {day(shown.day)} · {format(shown.values.reduce((a, b) => a + b, 0))}
          </b>
          <br />
          {parts.map((p, k) => (
            <span key={p.label} style={{ color: p.color }}>
              {k > 0 ? " · " : ""}
              {p.label} {format(shown.values[k] ?? 0)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const exp = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}
