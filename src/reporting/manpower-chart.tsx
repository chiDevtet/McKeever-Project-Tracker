/**
 * Weekly manpower chart as plain SVG, shared by the planning screen and the
 * print templates so both draw the same calculated series.
 *
 * Default measure: peak concurrent onsite headcount, stacked as installers
 * and leadership at the instant of the weekly total peak (so the column
 * height is the true combined peak, never the sum of separate peaks).
 */

import { formatDate, formatDayMonth, monthShort, type ISODate } from "@/domain/dates";

export const SERIES_COLORS = {
  installer: "#2a78d6",
  leadership: "#eb6834",
  grid: "#e6e6e3",
  axis: "#8a8f96",
  text: "#4b5057",
  ink: "#1c1e21",
  surface: "#ffffff",
  limit: "#24272b",
} as const;

export type ChartMeasure = "peak" | "hours" | "average";

export const MEASURE_LABELS: Record<ChartMeasure, string> = {
  peak: "Peak concurrent onsite headcount",
  hours: "Planned labor hours",
  average: "Average equivalent onsite staffing (onsite person-hours ÷ project calendar hours)",
};

export interface ChartWeek {
  week: ISODate;
  /** Installer-only weekly peak. */
  installerPeak: number;
  installersAtPeak: number;
  leadershipAtPeak: number;
  totalPeak: number;
  installerHours: number;
  leadershipHours: number;
  calendarHours: number;
  averageEquivalent: number | null;
  /** Optional entered availability limit for the week (division view). */
  limit?: number | null;
}

export interface ManpowerChartProps {
  weeks: ChartWeek[];
  measure?: ChartMeasure;
  width?: number;
  height?: number;
  /** Show leadership as a second series (false for installer-only filters). */
  includeLeadership?: boolean;
  /** Hatch the leadership series (grayscale print safety). */
  texture?: boolean;
  title?: string;
  activeWeek?: ISODate | null;
  onHoverWeek?: (week: ISODate | null) => void;
  onSelectWeek?: (week: ISODate) => void;
}

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= v) return m * pow;
  }
  return 10 * pow;
}

function ticksFor(max: number): number[] {
  const step = max / 4;
  return [0, 1, 2, 3, 4].map((i) => Math.round(i * step * 100) / 100);
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Top-rounded column path: 4px radius at the data end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  if (h <= 0) return "";
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ""}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ""}V${y + h}Z`;
}

export function chartValues(w: ChartWeek, measure: ChartMeasure, includeLeadership: boolean): { a: number; b: number; total: number | null } {
  if (measure === "hours") {
    const b = includeLeadership ? w.leadershipHours : 0;
    return { a: w.installerHours, b, total: w.installerHours + b };
  }
  if (measure === "average") return { a: w.averageEquivalent ?? 0, b: 0, total: w.averageEquivalent };
  if (!includeLeadership) return { a: w.installerPeak, b: 0, total: w.installerPeak };
  return { a: w.installersAtPeak, b: w.leadershipAtPeak, total: w.totalPeak };
}

export function ManpowerChart({ weeks, measure = "peak", width = 960, height = 260, includeLeadership = true, texture = false, title, activeWeek, onHoverWeek, onSelectWeek }: ManpowerChartProps) {
  const margin = { top: 34, right: 16, bottom: 40, left: 44 };
  const innerW = Math.max(10, width - margin.left - margin.right);
  const innerH = Math.max(10, height - margin.top - margin.bottom);
  const values = weeks.map((w) => chartValues(w, measure, includeLeadership));
  const rawMax = Math.max(0, ...values.map((v) => v.total ?? 0), ...weeks.map((w) => (measure === "peak" ? (w.limit ?? 0) : 0)));
  const yMax = niceMax(rawMax);
  const ticks = ticksFor(yMax);
  const slot = weeks.length ? innerW / weeks.length : innerW;
  const barW = Math.max(2, Math.min(24, slot * 0.62));
  const y = (v: number) => margin.top + innerH - (v / yMax) * innerH;
  const stacked = measure !== "average" && includeLeadership;
  const peakIdx = values.reduce((best, v, i) => ((v.total ?? -1) > (values[best]?.total ?? -1) ? i : best), 0);
  const labelEvery = Math.max(1, Math.ceil(weeks.length / Math.max(1, Math.floor(innerW / 54))));
  const titleText = title ?? MEASURE_LABELS[measure];
  const unit = measure === "hours" ? " h" : "";
  const seriesA = measure === "average" ? "Average equivalent staffing" : "Installers";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={`${titleText}, ${weeks.length} weeks`} className="manpower-chart" style={{ display: "block", fontFamily: "inherit" }}>
      <title>{titleText}</title>
      <desc>{`Weekly ${titleText.toLowerCase()} from ${formatDate(weeks[0]?.week)} to ${formatDate(weeks[weeks.length - 1]?.week)}. Values are listed in the accompanying table.`}</desc>
      <defs>
        <pattern id="hatch-leadership" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={SERIES_COLORS.leadership} />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#a8431a" strokeWidth="2" />
        </pattern>
      </defs>

      {/* Legend: always present for two series; swatch beside text-colored labels. */}
      <g transform={`translate(${margin.left}, 14)`} fontSize="11" fill={SERIES_COLORS.text}>
        <rect width="10" height="10" y="-8" rx="2" fill={SERIES_COLORS.installer} />
        <text x="14">{seriesA}</text>
        {stacked ? (
          <>
            <rect x="92" width="10" height="10" y="-8" rx="2" fill={texture ? "url(#hatch-leadership)" : SERIES_COLORS.leadership} />
            <text x="106">Onsite leadership</text>
          </>
        ) : null}
        {measure === "peak" && weeks.some((w) => w.limit != null) ? (
          <>
            <line x1="222" x2="240" y1="-3" y2="-3" stroke={SERIES_COLORS.limit} strokeWidth="2" />
            <text x="244">Availability limit</text>
          </>
        ) : null}
      </g>

      {/* Recessive hairline grid and y-axis ticks. */}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={margin.left} x2={margin.left + innerW} y1={y(t)} y2={y(t)} stroke={SERIES_COLORS.grid} strokeWidth="1" />
          <text x={margin.left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={SERIES_COLORS.axis} className="tabular">
            {fmt(t)}
          </text>
        </g>
      ))}
      <text x={12} y={margin.top + innerH / 2} fontSize="10" fill={SERIES_COLORS.axis} transform={`rotate(-90 12 ${margin.top + innerH / 2})`} textAnchor="middle">
        {measure === "peak" ? "People onsite" : measure === "hours" ? "Hours" : "Equivalent staff"}
      </text>

      {weeks.map((w, i) => {
        const v = values[i];
        const cx = margin.left + slot * i + slot / 2;
        const x = cx - barW / 2;
        const aTop = y(v.a);
        const aH = margin.top + innerH - aTop;
        const bTop = y(v.a + v.b);
        const bH = aTop - bTop - (v.b > 0 && v.a > 0 ? 2 : 0);
        const active = activeWeek === w.week;
        const tip =
          measure === "average"
            ? `Week of ${formatDate(w.week)}: ${w.averageEquivalent === null ? "not applicable (no open calendar hours)" : `${fmt(w.averageEquivalent)} equivalent staff`} · ${fmt(w.calendarHours)} calendar h`
            : measure === "hours"
              ? `Week of ${formatDate(w.week)}: installers ${fmt(w.installerHours)} h${includeLeadership ? `, leadership ${fmt(w.leadershipHours)} h, total ${fmt(w.installerHours + w.leadershipHours)} h` : ""}`
              : includeLeadership
                ? `Week of ${formatDate(w.week)}: peak onsite ${w.totalPeak} (${w.installersAtPeak} installers + ${w.leadershipAtPeak} leadership at that peak)`
                : `Week of ${formatDate(w.week)}: peak ${w.installerPeak} installers onsite`;
        return (
          <g
            key={w.week}
            onMouseEnter={onHoverWeek ? () => onHoverWeek(w.week) : undefined}
            onMouseLeave={onHoverWeek ? () => onHoverWeek(null) : undefined}
            onClick={onSelectWeek ? () => onSelectWeek(w.week) : undefined}
            style={onSelectWeek ? { cursor: "pointer" } : undefined}
          >
            <title>{tip}</title>
            {/* Hit target wider than the mark. */}
            <rect x={margin.left + slot * i} y={margin.top} width={slot} height={innerH} fill={active ? "#eef3fb" : "transparent"} />
            {aH > 0 ? <path d={columnPath(x, aTop, barW, aH, !(stacked && v.b > 0))} fill={SERIES_COLORS.installer} /> : null}
            {stacked && v.b > 0 && bH > 0 ? <path d={columnPath(x, bTop, barW, bH, true)} fill={texture ? "url(#hatch-leadership)" : SERIES_COLORS.leadership} /> : null}
            {measure === "average" && w.averageEquivalent === null ? (
              <text x={cx} y={margin.top + innerH - 4} textAnchor="middle" fontSize="8" fill={SERIES_COLORS.axis}>
                n/a
              </text>
            ) : null}
            {measure === "peak" && w.limit != null ? <line x1={cx - slot / 2} x2={cx + slot / 2} y1={y(w.limit)} y2={y(w.limit)} stroke={SERIES_COLORS.limit} strokeWidth="2" /> : null}
            {i === peakIdx && (v.total ?? 0) > 0 ? (
              <text x={cx} y={bTop - 5} textAnchor="middle" fontSize="10" fontWeight="600" fill={SERIES_COLORS.ink} className="tabular">
                {fmt(v.total ?? 0)}
                {unit}
              </text>
            ) : null}
            {i % labelEvery === 0 ? (
              <text x={cx} y={margin.top + innerH + 14} textAnchor="middle" fontSize="9.5" fill={SERIES_COLORS.text} className="tabular">
                {formatDayMonth(w.week)}
              </text>
            ) : null}
            {i === 0 || w.week.slice(5, 7) !== weeks[i - 1].week.slice(5, 7) ? (
              <text x={cx} y={margin.top + innerH + 27} textAnchor="middle" fontSize="9" fill={SERIES_COLORS.axis}>
                {i === 0 || w.week.slice(0, 4) !== weeks[i - 1].week.slice(0, 4) ? `${monthShort(w.week)} ${w.week.slice(0, 4)}` : monthShort(w.week)}
              </text>
            ) : null}
          </g>
        );
      })}
      <line x1={margin.left} x2={margin.left + innerW} y1={margin.top + innerH} y2={margin.top + innerH} stroke={SERIES_COLORS.axis} strokeWidth="1" />
      <text x={margin.left + innerW} y={height - 4} textAnchor="end" fontSize="9" fill={SERIES_COLORS.axis}>
        Weeks start Monday · week-of dates
      </text>
    </svg>
  );
}
