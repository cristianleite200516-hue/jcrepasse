import { useState } from "react";

export interface BarChartDatum {
  label: string;
  value: number;
}

interface BarChartProps {
  data: BarChartDatum[];
  color: string;
  formatValue?: (v: number) => string;
  orientation?: "vertical" | "horizontal";
  height?: number;
}

const INK_SECONDARY = "#52514e";
const INK_MUTED = "#898781";
const GRIDLINE = "#e1e0d9";
const BASELINE = "#c3c2b7";

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function defaultFormat(v: number) {
  return v.toLocaleString("pt-BR");
}

export function BarChart({ data, color, formatValue = defaultFormat, orientation = "vertical", height = 180 }: BarChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const max = niceMax(Math.max(...data.map((d) => d.value), 1));
  const ticks = [0, max * 0.25, max * 0.5, max * 0.75, max];

  if (data.length === 0) {
    return <div className="text-xs text-slate-500">Sem dados</div>;
  }

  if (orientation === "horizontal") {
    const barThickness = 20;
    const gap = 10;
    const chartHeight = data.length * (barThickness + gap);
    const labelWidth = 96;
    const plotWidth = 400;
    const width = labelWidth + plotWidth + 48;

    return (
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${chartHeight + 10}`} className="w-full" style={{ height: chartHeight + 10 }}>
          {ticks.map((t, i) => {
            const x = labelWidth + (t / max) * plotWidth;
            return (
              <line key={i} x1={x} y1={0} x2={x} y2={chartHeight} stroke={GRIDLINE} strokeWidth={1} />
            );
          })}
          <line x1={labelWidth} y1={0} x2={labelWidth} y2={chartHeight} stroke={BASELINE} strokeWidth={1} />
          {data.map((d, i) => {
            const y = i * (barThickness + gap);
            const barW = Math.max((d.value / max) * plotWidth, d.value > 0 ? 3 : 0);
            const isHover = hoverIdx === i;
            return (
              <g key={d.label}>
                <text x={labelWidth - 8} y={y + barThickness / 2 + 4} textAnchor="end" fontSize="11" fill={INK_SECONDARY}>
                  {d.label}
                </text>
                <rect
                  x={labelWidth}
                  y={y}
                  width={Math.max(barW, 1)}
                  height={barThickness}
                  rx={4}
                  fill={color}
                  opacity={isHover ? 0.8 : 1}
                  onPointerMove={() => setHoverIdx(i)}
                  onPointerLeave={() => setHoverIdx(null)}
                  style={{ cursor: "pointer" }}
                />
                <text
                  x={labelWidth + barW + 6}
                  y={y + barThickness / 2 + 4}
                  fontSize="11"
                  fill={INK_MUTED}
                >
                  {formatValue(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
        {hoverIdx !== null && (
          <div className="pointer-events-none absolute left-2 top-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md">
            <div className="font-semibold text-slate-900">{formatValue(data[hoverIdx].value)}</div>
            <div className="text-slate-500">{data[hoverIdx].label}</div>
          </div>
        )}
      </div>
    );
  }

  // vertical (column) chart
  const plotHeight = height - 24;
  const barWidth = Math.min(24, 360 / data.length - 8);
  const step = 360 / data.length;

  return (
    <div className="relative">
      <svg viewBox={`0 0 360 ${height}`} className="w-full" style={{ height }}>
        {ticks.map((t, i) => {
          const y = plotHeight - (t / max) * plotHeight;
          return <line key={i} x1={0} y1={y} x2={360} y2={y} stroke={GRIDLINE} strokeWidth={1} />;
        })}
        <line x1={0} y1={plotHeight} x2={360} y2={plotHeight} stroke={BASELINE} strokeWidth={1} />
        {data.map((d, i) => {
          const barH = (d.value / max) * plotHeight;
          const x = i * step + (step - barWidth) / 2;
          const y = plotHeight - barH;
          const isHover = hoverIdx === i;
          return (
            <g key={d.label}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barH, d.value > 0 ? 2 : 0)}
                rx={4}
                fill={color}
                opacity={isHover ? 0.8 : 1}
                onPointerMove={() => setHoverIdx(i)}
                onPointerLeave={() => setHoverIdx(null)}
                style={{ cursor: "pointer" }}
              />
              <rect
                x={x - 2}
                y={0}
                width={barWidth + 4}
                height={plotHeight}
                fill="transparent"
                onPointerMove={() => setHoverIdx(i)}
                onPointerLeave={() => setHoverIdx(null)}
              />
              <text x={x + barWidth / 2} y={height - 6} textAnchor="middle" fontSize="10" fill={INK_MUTED}>
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {hoverIdx !== null && (
        <div
          className="pointer-events-none absolute rounded-md border border-slate-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: `${(hoverIdx / data.length) * 100}%`, top: 0 }}
        >
          <div className="font-semibold text-slate-900">{formatValue(data[hoverIdx].value)}</div>
          <div className="text-slate-500">{data[hoverIdx].label}</div>
        </div>
      )}
    </div>
  );
}
