/**
 * Trusted print template for every report style. Content is paginated
 * explicitly into fixed-size pages (repeated table headers, identity band,
 * page numbers), so the on-screen preview shows exactly what Chromium prints.
 * All values are rendered as React text (escaped); no user content is
 * injected as HTML and the template loads no external resources.
 */

import { addDays, diffDays, formatDate, formatDayMonth, isoWeekday, monthShort, type ISODate } from "@/domain/dates";
import { DETAIL_LEVELS, PRESENTATIONS, type ReportDataset } from "@/domain/report";
import { ManpowerChart, MEASURE_LABELS, type ChartMeasure } from "./manpower-chart";

export type Orientation = "portrait" | "landscape";

export function resolveOrientation(ds: ReportDataset): Orientation {
  const s = ds.settings;
  if (s.orientation === "PORTRAIT") return "portrait";
  if (s.orientation === "LANDSCAPE") return "landscape";
  return s.presentation === "TIMELINE" || s.presentation === "COMBINED" || s.detail === "ACTIVITY_DETAIL" ? "landscape" : "portrait";
}

const PAGE = { portrait: { w: 8.5, h: 11 }, landscape: { w: 11, h: 8.5 } };
const ROW_PX = 17;
/** Conservative rendered row height used for pagination (text line + padding + border). */
const ROW_ESTIMATE_PX = 21;
const DPI = 96;

export const REPORT_CSS = `
@page { size: letter; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #e9e9e6; }
body { font-family: "Helvetica Neue", Arial, "Liberation Sans", sans-serif; color: #1c1e21; font-size: 9.5pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; font-variant-numeric: tabular-nums; }
.page { background: #fff; margin: 12px auto; padding: 0.45in 0.5in 0.4in; position: relative; overflow: hidden; break-after: page; page-break-after: always; display: flex; flex-direction: column; }
.page:last-child { break-after: auto; page-break-after: auto; }
@media print { html, body { background: #fff; } .page { margin: 0; box-shadow: none; } }
@media screen { .page { box-shadow: 0 1px 3px rgba(0,0,0,.18); } }
.band { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #24272b; padding-bottom: 5px; margin-bottom: 8px; }
.band .co { font-size: 8pt; color: #5f646b; text-transform: uppercase; letter-spacing: .04em; }
.band .ti { font-size: 13pt; font-weight: 700; }
.band .meta { text-align: right; font-size: 7.5pt; color: #4b5057; line-height: 1.35; }
.content { flex: 1; min-height: 0; }
.foot { display: flex; justify-content: space-between; border-top: 1px solid #dcdcd8; padding-top: 4px; margin-top: 6px; font-size: 7pt; color: #5f646b; }
h2 { font-size: 10.5pt; margin: 10px 0 4px; }
h2:first-child { margin-top: 0; }
p { margin: 2px 0 6px; line-height: 1.35; }
.muted { color: #5f646b; }
.warn { color: #8a4f00; }
.badge { display: inline-block; border: 1px solid #9ea3aa; border-radius: 3px; padding: 0 4px; font-size: 7pt; color: #4b5057; }
.flag { display: inline-block; border: 1px solid #b8862b; background: #fff4dc; color: #6b4200; border-radius: 3px; padding: 1px 6px; font-size: 8pt; font-weight: 600; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border-bottom: 1px solid #e3e3df; padding: 2px 4px; height: ${ROW_PX}px; vertical-align: top; text-align: left; overflow: hidden; }
td.n { white-space: nowrap; }
th { background: #f1f1ef; font-size: 7.5pt; font-weight: 600; color: #3c4046; border-bottom: 1px solid #b9bcc1; }
td.n, th.n { text-align: right; }
td.wrap { white-space: normal; }
td.clip { white-space: nowrap; text-overflow: ellipsis; }
tr.sub td { color: #5f646b; }
.kpis { display: flex; gap: 8px; margin: 4px 0 8px; }
.kpi { border: 1px solid #dcdcd8; border-radius: 4px; padding: 4px 8px; flex: 1; }
.kpi .l { font-size: 7pt; color: #5f646b; }
.kpi .v { font-size: 13pt; font-weight: 700; }
.basis dt { font-weight: 600; margin-top: 4px; }
.basis dd { margin: 0 0 2px 0; color: #3c4046; }
.tl-label { font-size: 7.5pt; }
`;

interface PageContent {
  key: string;
  body: React.ReactNode;
}

function Band({ ds }: { ds: ReportDataset }) {
  const id = ds.identity;
  return (
    <div className="band">
      <div>
        <div className="co">{id.company}</div>
        <div className="ti">
          {id.title}
          {id.exploratory ? <span className="flag" style={{ marginLeft: 8 }}>EXPLORATORY SCENARIO — NOT A SUBMISSION</span> : null}
        </div>
        <div style={{ fontSize: "9pt" }}>
          {id.projectCode} · {id.projectName}
          {id.customer ? ` · for ${id.customer}` : ""}
        </div>
      </div>
      <div className="meta">
        <div>
          Period {formatDate(id.period.from)} – {formatDate(id.period.to)}
        </div>
        <div>
          {id.planLabel}
          {id.snapshotName ? ` · ${id.snapshotName}` : ""}
        </div>
        <div>
          Prepared by {id.preparedBy} · generated {formatDate(id.generatedAt.slice(0, 10))}
        </div>
      </div>
    </div>
  );
}

function Foot({ ds, n, total }: { ds: ReportDataset; n: number; total: number }) {
  return (
    <div className="foot">
      <span>
        {ds.identity.projectCode} · {ds.identity.title} · {DETAIL_LEVELS[ds.settings.detail]} · {PRESENTATIONS[ds.settings.presentation]}
        {ds.identity.snapshotId ? ` · snapshot ${ds.identity.snapshotId.slice(0, 8)}` : " · preview (not frozen)"}
      </span>
      <span>
        Page {n} of {total}
      </span>
    </div>
  );
}

function fmt(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined) return "—";
  return Number.isInteger(n) ? String(n) : n.toFixed(digits);
}

function labor(l: { peak: number; hours: number } | null, hours: boolean) {
  if (!l) return "Not allocated";
  return hours ? `${l.peak} peak · ${fmt(l.hours)} h` : `${l.peak} peak`;
}

/** Printable content width of a page in CSS pixels. */
const contentWidthPx = (o: Orientation) => (PAGE[o].w - 1.0) * DPI;

/** Estimated height of wrapped text cells, in pagination rows (9.5pt text, ~6.2px per character). */
function wrapRows(texts: (string | null | undefined)[], widthPx: number): number {
  const charsPerLine = Math.max(8, Math.floor((widthPx - 8) / 6.2));
  const lines = texts.reduce((n, t) => n + (t ? Math.ceil(t.length / charsPerLine) : 0), 0);
  return Math.max(1, (lines * 15 + 6) / ROW_ESTIMATE_PX);
}

/** Split rows into page-sized chunks by estimated row weight. */
function chunk<T>(rows: T[], capacity: number, weight: (r: T) => number = () => 1): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let used = 0;
  for (const r of rows) {
    const w = weight(r);
    if (cur.length && used + w > capacity) {
      out.push(cur);
      cur = [];
      used = 0;
    }
    cur.push(r);
    used += w;
  }
  if (cur.length || !out.length) out.push(cur);
  return out;
}

function chartWeeks(ds: ReportDataset) {
  return ds.weeks.map((w) => ({ week: w.week, installerPeak: w.installerPeak, installersAtPeak: w.installersAtPeak, leadershipAtPeak: w.leadershipAtPeak, totalPeak: w.totalPeak, installerHours: w.installerHours, leadershipHours: w.leadershipHours, calendarHours: w.calendarHours, averageEquivalent: w.averageEquivalent }));
}

function Kpis({ ds }: { ds: ReportDataset }) {
  const t = ds.totals;
  if (ds.allocationEmpty) {
    return (
      <p className="warn">
        <strong>Not allocated:</strong> no installer labor is allocated to {ds.filterDescription}. This is not a statement of zero demand.
        {ds.unallocatedToSystem ? ` Project labor not allocated to any system: ${ds.unallocatedToSystem.peak} peak, ${fmt(ds.unallocatedToSystem.hours)} h (not included here).` : ""}
      </p>
    );
  }
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="l">Peak concurrent onsite</div>
        <div className="v">{t.peakTotal}</div>
      </div>
      <div className="kpi">
        <div className="l">Peak installers</div>
        <div className="v">{t.peakInstallers}</div>
      </div>
      <div className="kpi">
        <div className="l">Peak leadership</div>
        <div className="v">{t.peakLeadership}</div>
      </div>
      {ds.settings.contents.hours ? (
        <>
          <div className="kpi">
            <div className="l">Installer hours</div>
            <div className="v">{fmt(t.installerHours, 0)}</div>
          </div>
          <div className="kpi">
            <div className="l">Leadership hours</div>
            <div className="v">{fmt(t.leadershipHours, 0)}</div>
          </div>
          <div className="kpi">
            <div className="l">Total onsite hours</div>
            <div className="v">{fmt(t.totalHours, 0)}</div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const chartWeeksPerPage = (o: Orientation) => (o === "landscape" ? 52 : 30);
const wantsChart = (ds: ReportDataset) => ds.settings.presentation === "CHART" || ds.settings.presentation === "COMBINED";

function summaryPage(ds: ReportDataset, o: Orientation): PageContent {
  const id = ds.identity;
  return {
    key: "summary",
    body: (
      <>
        <h2>Summary</h2>
        <p>
          {[id.customer && `Customer: ${id.customer}`, id.generalContractor && `General contractor: ${id.generalContractor}`, id.owner && `Owner: ${id.owner}`].filter(Boolean).join(" · ")}
        </p>
        <p className="muted">
          Detail: {DETAIL_LEVELS[ds.settings.detail]} · Presentation: {PRESENTATIONS[ds.settings.presentation]} · Scope: {ds.filterDescription}
        </p>
        {ds.allocationNote ? <p className="warn">{ds.allocationNote}</p> : null}
        <Kpis ds={ds} />
        {wantsChart(ds) && !ds.allocationEmpty && ds.weeks.length <= chartWeeksPerPage(o) ? (
          <>
            <h2>{MEASURE_LABELS[ds.settings.measure as ChartMeasure]}</h2>
            <ManpowerChart weeks={chartWeeks(ds)} measure={ds.settings.measure as ChartMeasure} width={o === "landscape" ? 960 : 700} height={o === "landscape" ? 250 : 260} includeLeadership={!ds.settings.filters.roles.length || ds.settings.filters.roles.includes("leadership")} texture />
          </>
        ) : null}
        <h2>Sources and basis</h2>
        <table className="kv">
          <tbody>
            {id.sources.map((s) => (
              <tr key={s.label}>
                <td style={{ width: "28%" }}>{s.label}</td>
                <td className="wrap">{s.detail}</td>
              </tr>
            ))}
            <tr>
              <td>Calendar</td>
              <td className="wrap">{id.calendarBasis}</td>
            </tr>
          </tbody>
        </table>
      </>
    ),
  };
}

function chartPages(ds: ReportDataset, o: Orientation): PageContent[] {
  // A chart that fits is already on the summary page.
  if (ds.allocationEmpty || ds.weeks.length <= chartWeeksPerPage(o)) return [];
  const per = chartWeeksPerPage(o);
  const weeks = chartWeeks(ds);
  const out: PageContent[] = [];
  for (let i = 0; i < weeks.length; i += per) {
    const slice = weeks.slice(i, i + per);
    out.push({
      key: `chart-${i}`,
      body: (
        <>
          <h2>
            {MEASURE_LABELS[ds.settings.measure as ChartMeasure]} · {formatDate(slice[0].week)} – {formatDate(addDays(slice[slice.length - 1].week, 6))}
          </h2>
          {ds.allocationNote ? <p className="warn">{ds.allocationNote}</p> : null}
          <ManpowerChart weeks={slice} measure={ds.settings.measure as ChartMeasure} width={o === "landscape" ? 960 : 700} height={o === "landscape" ? 420 : 520} includeLeadership={!ds.settings.filters.roles.length || ds.settings.filters.roles.includes("leadership")} texture />
        </>
      ),
    });
  }
  return out;
}

function staffingTablePages(ds: ReportDataset, rowsPerPage: number): PageContent[] {
  const avg = ds.settings.contents.averageEquivalent;
  const hours = ds.settings.contents.hours;
  return chunk(ds.weeks, rowsPerPage).map((rows, i) => ({
    key: `staff-${i}`,
    body: (
      <>
        <h2>Weekly staffing{i ? " (continued)" : ""}</h2>
        {ds.allocationNote && i === 0 ? <p className="warn">{ds.allocationNote}</p> : null}
        <table>
          <thead>
            <tr>
              <th style={{ width: "13%" }}>Week of (Mon)</th>
              <th className="n">Open days</th>
              <th className="n">Calendar h</th>
              <th className="n">Installers (peak)</th>
              <th className="n">Leadership (peak)</th>
              <th className="n">Total onsite (peak)</th>
              {hours ? (
                <>
                  <th className="n">Installer h</th>
                  <th className="n">Leadership h</th>
                  <th className="n">Total h</th>
                </>
              ) : null}
              {avg ? <th className="n">Avg equiv. staff</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.week}>
                <td>{formatDate(w.week)}</td>
                <td className="n">{w.openDays}</td>
                <td className="n">{fmt(w.calendarHours)}</td>
                <td className="n">{ds.allocationEmpty ? "n/a" : w.installerPeak}</td>
                <td className="n">{w.leadershipPeak}</td>
                <td className="n">{ds.allocationEmpty ? "n/a" : w.totalPeak}</td>
                {hours ? (
                  <>
                    <td className="n">{ds.allocationEmpty ? "n/a" : fmt(w.installerHours)}</td>
                    <td className="n">{fmt(w.leadershipHours)}</td>
                    <td className="n">{ds.allocationEmpty ? "n/a" : fmt(w.totalHours)}</td>
                  </>
                ) : null}
                {avg ? <td className="n">{w.averageEquivalent === null ? "n/a" : fmt(w.averageEquivalent)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 4 }}>
          Peak columns are the most people onsite at one instant; they are not added across weeks. Total onsite peak can be below installers + leadership peaks when those peaks occur at different times.
        </p>
      </>
    ),
  }));
}

function detailPages(ds: ReportDataset, o: Orientation, rowsPerPage: number): PageContent[] {
  const hours = ds.settings.contents.hours;
  const d = ds.settings.detail;
  if (d === "PROJECT_SUMMARY") {
    if (!ds.settings.contents.allocationDetail || !ds.systems.length) return [];
    return [
      {
        key: "systems",
        body: (
          <>
            <h2>Allocation by system</h2>
            <p className="muted">Shared-systems labor is not copied into each system. Figures subdivide the project total.</p>
            <table>
              <thead>
                <tr>
                  <th>System</th>
                  <th>Allocated labor</th>
                </tr>
              </thead>
              <tbody>
                {ds.systems.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{labor(s.labor, hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ),
      },
    ];
  }
  if (d === "PHASE_OVERVIEW") {
    const codes = [...new Set(ds.phases.flatMap((p) => p.milestones.map((m) => m.code)))];
    return chunk(ds.phases, Math.max(6, rowsPerPage - 4), () => 1.5).map((rows, i) => ({
      key: `phases-${i}`,
      body: (
        <>
          <h2>Phase overview{i ? " (continued)" : ""}</h2>
          {i === 0 ? <p className="muted">Phase manpower appears only where labor has been allocated to the phase. Unallocated project labor remains in the overall project total and chart; it is not spread across phases.</p> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: "9%" }}>Phase</th>
                <th style={{ width: "13%" }}>Areas</th>
                <th style={{ width: "15%" }}>Phase window</th>
                {codes.map((c) => (
                  <th key={c} className="n" style={{ width: `${Math.floor(48 / Math.max(1, codes.length))}%` }}>
                    {c}
                  </th>
                ))}
                <th>Allocated labor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="wrap">{p.areas.join(", ") || "—"}</td>
                  <td className="wrap">
                    {p.window.start || p.window.finish ? `${formatDate(p.window.start)} – ${formatDate(p.window.finish)}` : p.scheduled.start ? `Scheduled ${formatDate(p.scheduled.start)} – ${formatDate(p.scheduled.finish)}` : "Not set"}
                  </td>
                  {codes.map((c) => {
                    const m = p.milestones.find((x) => x.code === c);
                    return (
                      <td key={c} className="n">
                        {m?.date ? formatDate(m.date) : "—"}
                        {m && !m.confirmed && m.date ? "*" : ""}
                      </td>
                    );
                  })}
                  <td>{labor(p.labor, hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {codes.length ? <p className="muted">* Candidate date from source correspondence, pending confirmation. — = not specified by the source.</p> : null}
        </>
      ),
    }));
  }
  if (d === "AREA_BREAKDOWN") {
    return chunk(ds.areas, rowsPerPage).map((rows, i) => ({
      key: `areas-${i}`,
      body: (
        <>
          <h2>ROMP / area breakdown{i ? " (continued)" : ""}</h2>
          {i === 0 ? <p className="muted">Area figures include nested areas once (child areas are part of their parent). Unallocated labor is shown as not allocated.</p> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: "34%" }}>Area</th>
                <th style={{ width: "14%" }}>Type</th>
                <th>Phases</th>
                <th style={{ width: "22%" }}>Allocated labor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="clip" style={{ paddingLeft: 4 + a.depth * 12 }}>
                    {a.name}
                  </td>
                  <td>{a.kind.replace("_", " ").toLowerCase()}</td>
                  <td className="clip">{a.phases.join(", ") || "Outside every phase"}</td>
                  <td>{labor(a.labor, hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ),
    }));
  }
  const withNotes = ds.settings.contents.notes;
  const nameWidth = contentWidthPx(o) * 0.25;
  return chunk(ds.activities, rowsPerPage - 2, (a) => wrapRows([`${a.name}${a.source ? ` · src ${a.source}` : ""}`, withNotes ? a.notes : null], nameWidth)).map((rows, i) => ({
    key: `acts-${i}`,
    body: (
      <>
        <h2>Detailed activities{i ? " (continued)" : ""}</h2>
        <table>
          <thead>
            <tr>
              <th style={{ width: "7%" }}>ID</th>
              <th style={{ width: "25%" }}>Activity</th>
              <th style={{ width: "8%" }}>Phase</th>
              <th style={{ width: "9%" }}>Area</th>
              <th style={{ width: "10%" }}>System</th>
              <th style={{ width: "8.5%" }}>Start</th>
              <th style={{ width: "8.5%" }}>Finish</th>
              <th className="n" style={{ width: "5%" }}>
                Days
              </th>
              <th style={{ width: "8%" }}>Status</th>
              <th>Allocated labor</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.key}>
                <td>{a.code}</td>
                <td className="wrap">
                  {a.name}
                  {a.source ? <span className="muted"> · src {a.source}</span> : null}
                  {withNotes && a.notes ? <div className="muted">{a.notes}</div> : null}
                </td>
                <td className="clip">{a.phase ?? "—"}</td>
                <td className="clip">{a.area ?? "—"}</td>
                <td className="clip">{a.system}</td>
                <td>{formatDate(a.start)}</td>
                <td>{formatDate(a.finish)}</td>
                <td className="n">{a.workingDays}</td>
                <td className="clip">
                  {a.status}
                  {a.percent !== null && a.status !== "Complete" ? ` ${a.percent}%` : ""}
                </td>
                <td>{labor(a.labor, hours)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={10} className="muted">
                  No activities in this period and scope.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </>
    ),
  }));
}

/** Multi-page timeline: up to 26 weeks per page horizontally, fixed rows per page vertically. */
function timelinePages(ds: ReportDataset, o: Orientation, rowsPerPage: number): PageContent[] {
  type Row = { label: string; sub: string; start: ISODate | null; finish: ISODate | null; kind: "bar" | "group" | "window"; status?: string };
  const rows: Row[] = [];
  if (ds.settings.detail === "PROJECT_SUMMARY" || ds.settings.detail === "PHASE_OVERVIEW") {
    for (const p of ds.phases) {
      rows.push({ label: p.name, sub: p.areas.join(", "), start: p.window.start ?? p.scheduled.start, finish: p.window.finish ?? p.scheduled.finish, kind: p.window.start ? "window" : "bar" });
    }
  } else {
    const groupOf = (a: ReportDataset["activities"][number]) => (ds.settings.detail === "AREA_BREAKDOWN" ? (a.area ?? "No area") : (a.phase ?? "No phase"));
    const groups = new Map<string, ReportDataset["activities"]>();
    for (const a of ds.activities) groups.set(groupOf(a), [...(groups.get(groupOf(a)) ?? []), a]);
    for (const [g, acts] of groups) {
      rows.push({ label: g, sub: "", start: null, finish: null, kind: "group" });
      for (const a of acts) rows.push({ label: `${a.code} ${a.name}`, sub: a.system, start: a.start, finish: a.finish, kind: "bar", status: a.status });
    }
  }
  const milestones = ds.settings.contents.milestones ? ds.milestones.filter((m) => m.date) : [];
  const from = ds.identity.period.from;
  const to = ds.identity.period.to;
  const weeksPerPage = o === "landscape" ? 26 : 16;
  const windows: { s: ISODate; e: ISODate }[] = [];
  for (let s = from; s <= to; s = addDays(s, weeksPerPage * 7)) windows.push({ s, e: (addDays(s, weeksPerPage * 7 - 1) < to ? addDays(s, weeksPerPage * 7 - 1) : to) as ISODate });
  const pageW = (PAGE[o].w - 1) * DPI;
  const labelW = o === "landscape" ? 250 : 190;
  const plotW = pageW - labelW;
  const rowH = 16;
  const out: PageContent[] = [];
  const rowChunks = chunk(rows, rowsPerPage - 3);
  for (const win of windows) {
    const days = diffDays(win.s, win.e) + 1;
    const dx = plotW / days;
    const x = (d: ISODate) => labelW + diffDays(win.s, d) * dx;
    rowChunks.forEach((rc, ri) => {
      const h = 40 + rc.length * rowH + 6;
      out.push({
        key: `tl-${win.s}-${ri}`,
        body: (
          <>
            <h2>
              Schedule timeline · {formatDate(win.s)} – {formatDate(win.e)}
              {rowChunks.length > 1 ? ` · rows ${ri + 1}/${rowChunks.length}` : ""}
            </h2>
            <svg width={pageW} height={h} viewBox={`0 0 ${pageW} ${h}`} role="img" aria-label="Schedule timeline">
              {Array.from({ length: days }, (_, i) => addDays(win.s, i))
                .filter((d) => d.slice(8) === "01" || d === win.s)
                .map((d) => (
                  <g key={d}>
                    <line x1={x(d)} x2={x(d)} y1={0} y2={h} stroke="#c9cbce" strokeWidth="1" />
                    <text x={x(d) + 2} y={10} fontSize="8" fill="#3c4046">
                      {monthShort(d)} {d.slice(0, 4)}
                    </text>
                  </g>
                ))}
              {Array.from({ length: days }, (_, i) => addDays(win.s, i))
                .filter((d) => isoWeekday(d) === 1)
                .map((d) => (
                  <g key={`w${d}`}>
                    <line x1={x(d)} x2={x(d)} y1={14} y2={h} stroke="#ececea" strokeWidth="1" />
                    {dx * 7 > 26 ? (
                      <text x={x(d) + 1} y={22} fontSize="6.5" fill="#6b7076">
                        {formatDayMonth(d)}
                      </text>
                    ) : null}
                  </g>
                ))}
              {milestones
                .filter((m) => m.date! >= win.s && m.date! <= win.e)
                .map((m, i) => (
                  <g key={`${m.phase}${m.code}${i}`}>
                    <line x1={x(m.date!) + dx / 2} x2={x(m.date!) + dx / 2} y1={26} y2={h} stroke="#1c1e21" strokeOpacity="0.25" strokeWidth="1" />
                    <path d={`M${x(m.date!) + dx / 2} 26 l4 4 l-4 4 l-4 -4 z`} fill={m.status === "Confirmed" ? "#1c1e21" : "#ffffff"} stroke="#1c1e21" strokeWidth="1" />
                    <text x={x(m.date!) + dx / 2 + 5} y={33} fontSize="6" fill="#1c1e21">
                      {m.phase.replace("Phase ", "P")} {m.code}
                    </text>
                  </g>
                ))}
              {rc.map((r, i) => {
                const y = 40 + i * rowH;
                const visible = r.start && r.finish && r.finish >= win.s && r.start <= win.e;
                const s = visible ? (r.start! < win.s ? win.s : r.start!) : null;
                const f = visible ? (r.finish! > win.e ? win.e : r.finish!) : null;
                return (
                  <g key={i}>
                    <line x1={0} x2={pageW} y1={y + rowH} y2={y + rowH} stroke="#efefed" />
                    <text x={2} y={y + 11} fontSize="7.5" fontWeight={r.kind === "group" ? 700 : 400} fill="#1c1e21">
                      {r.label.length > (o === "landscape" ? 52 : 38) ? `${r.label.slice(0, o === "landscape" ? 50 : 36)}…` : r.label}
                    </text>
                    {s && f ? (
                      <rect x={x(s)} y={y + 4} width={Math.max(2, (diffDays(s, f) + 1) * dx)} height={rowH - 8} rx={2} fill={r.kind === "window" ? "#ffffff" : r.status === "Complete" ? "#4b5057" : "#2a78d6"} stroke={r.kind === "window" ? "#2a78d6" : "none"} strokeWidth={r.kind === "window" ? 1.5 : 0} />
                    ) : null}
                    {s && f && r.status === "Complete" ? (
                      <text x={x(s) + 2} y={y + 11} fontSize="6.5" fill="#ffffff">
                        ✓
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </svg>
            <p className="muted">Solid bars: planned activity dates. Outlined bars: phase windows. Filled diamonds: confirmed milestones; hollow diamonds: candidates pending confirmation. ✓ = complete.</p>
          </>
        ),
      });
    });
  }
  return out;
}

function rosterPages(ds: ReportDataset, rowsPerPage: number): PageContent[] {
  const out: PageContent[] = [];
  const s = ds.settings;
  if (ds.leadership.length) {
    chunk(ds.leadership, rowsPerPage - 4, (l) => (l.responsibility.length > 40 || l.onsite.length > 40 || l.offsite !== "—" ? 3 : 1)).forEach((rows, i) =>
      out.push({
        key: `roster-${i}`,
        body: (
          <>
            <h2>Onsite leadership{i ? " (continued)" : ""}</h2>
            {i === 0 ? <p className="muted">Each person counts once onsite regardless of the number of responsibilities. Offsite management hours are excluded from onsite totals.</p> : null}
            <table>
              <thead>
                <tr>
                  <th style={{ width: "15%" }}>Name</th>
                  <th style={{ width: "13%" }}>Role</th>
                  <th style={{ width: "24%" }}>Responsibility</th>
                  <th style={{ width: "18%" }}>Assignment dates</th>
                  <th>Onsite schedule</th>
                  <th className="n" style={{ width: "9%" }}>
                    Onsite h
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l, j) => (
                  <tr key={j}>
                    <td>{l.name}</td>
                    <td>{l.role}</td>
                    <td className="wrap">{l.responsibility}</td>
                    <td className="wrap">{l.dates}</td>
                    <td className="wrap">
                      {l.onsite}
                      {l.offsite !== "—" ? <div className="muted">{l.offsite}</div> : null}
                    </td>
                    <td className="n">{fmt(l.onsiteHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ),
      }),
    );
  }
  if (ds.milestones.length) {
    chunk(ds.milestones, rowsPerPage - 3, (m) => (m.sources.length > 70 ? 2 : 1)).forEach((rows, i) =>
      out.push({
        key: `ms-${i}`,
        body: (
          <>
            <h2>Milestones{i ? " (continued)" : ""}</h2>
            {i === 0 ? <p className="muted">Candidate dates come from source correspondence and are pending confirmation. A milestone constrains installation work only where it is linked to an activity.</p> : null}
            <table>
              <thead>
                <tr>
                  <th style={{ width: "10%" }}>Phase</th>
                  <th style={{ width: "8%" }}>Code</th>
                  <th style={{ width: "16%" }}>Name</th>
                  <th style={{ width: "12%" }}>Date</th>
                  <th style={{ width: "11%" }}>Status</th>
                  <th>Source candidates</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m, j) => (
                  <tr key={j}>
                    <td className="clip">{m.phase}</td>
                    <td>{m.code}</td>
                    <td className="clip">{m.name}</td>
                    <td className="clip">{formatDate(m.date)}</td>
                    <td className="clip">{m.status.startsWith("Candidate") ? "Candidate" : m.status}</td>
                    <td className="wrap">{m.sources}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ),
      }),
    );
  }
  if (s.contents.assumptions) {
    // Routine candidate-milestone reviews collapse to one line (the milestone table lists them);
    // source disagreements stay individually visible.
    const all = ds.issues.filter((i) => i.severity !== "info" || i.category === "milestone-unconfirmed");
    const routine = all.filter((i) => i.category === "milestone-unconfirmed" && !i.message.includes("sources disagree"));
    const open = [
      ...all.filter((i) => !routine.includes(i)),
      ...(routine.length ? [{ id: "routine-milestones", severity: "info" as const, category: "milestone-unconfirmed" as const, message: `${routine.length} milestone candidate date(s) are pending operator confirmation; see the Milestones table.`, refs: [] }] : []),
    ];
    const textLines = [s.assumptions, s.exclusions, s.datesToConfirm].reduce((n, t) => n + (t ? Math.ceil(t.length / 120) + t.split("\n").length : 0), 0);
    const items = chunk(open, Math.max(4, rowsPerPage - 6 - textLines), (i) => (i.message.length > 150 ? 2 : 1));
    items.forEach((rows, i) =>
      out.push({
        key: `assume-${i}`,
        body: (
          <>
            <h2>Assumptions, exclusions, and dates needing confirmation{i ? " (continued)" : ""}</h2>
            {i === 0 ? (
              <>
                {s.assumptions ? <p style={{ whiteSpace: "pre-wrap" }}>{s.assumptions}</p> : <p className="muted">No planning assumptions entered.</p>}
                {s.exclusions ? <p style={{ whiteSpace: "pre-wrap" }}>Exclusions: {s.exclusions}</p> : null}
                {s.datesToConfirm ? <p style={{ whiteSpace: "pre-wrap" }}>Dates to confirm: {s.datesToConfirm}</p> : null}
              </>
            ) : null}
            {open.length ? (
              <>
                <p>
                  <strong>Open planning items at generation ({open.length}){i ? ", continued" : ""}:</strong>
                </p>
                <ul style={{ margin: "0 0 0 14px", padding: 0 }}>
                  {rows.map((it) => (
                    <li key={it.id} style={{ marginBottom: 2 }}>
                      {it.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">No open planning items.</p>
            )}
          </>
        ),
      }),
    );
  }
  return out;
}

function basisPage(ds: ReportDataset): PageContent {
  return {
    key: "basis",
    body: (
      <>
        <h2>Report basis and measure definitions</h2>
        <dl className="basis">
          {ds.basis.map((b) => (
            <div key={b.label}>
              <dt>{b.label}</dt>
              <dd>{b.value}</dd>
            </div>
          ))}
          <div>
            <dt>Plan and snapshot</dt>
            <dd>
              {ds.identity.planLabel}
              {ds.identity.snapshotId ? ` · frozen snapshot ${ds.identity.snapshotId}` : " · live preview, not frozen"} · generated {ds.identity.generatedAt} · prepared by {ds.identity.preparedBy}
            </dd>
          </div>
          <div>
            <dt>Scope</dt>
            <dd>{ds.filterDescription}</dd>
          </div>
        </dl>
      </>
    ),
  };
}

export function buildPages(ds: ReportDataset): { orientation: Orientation; pages: PageContent[] } {
  const o = resolveOrientation(ds);
  const usable = (PAGE[o].h - 0.85) * DPI - 90;
  const rowsPerPage = Math.max(10, Math.floor((usable - 60) / ROW_ESTIMATE_PX));
  const p = ds.settings.presentation;
  const pages: PageContent[] = [summaryPage(ds, o)];
  if (p === "CHART" || p === "COMBINED") pages.push(...chartPages(ds, o));
  if (p === "TABLE" || p === "COMBINED") pages.push(...staffingTablePages(ds, rowsPerPage));
  pages.push(...detailPages(ds, o, rowsPerPage));
  if (p === "TIMELINE" || p === "COMBINED") pages.push(...timelinePages(ds, o, Math.floor((usable - 70) / 16)));
  pages.push(...rosterPages(ds, rowsPerPage));
  pages.push(basisPage(ds));
  return { orientation: o, pages };
}

/** The complete paginated report document (all pages). */
export function ReportDocument({ ds }: { ds: ReportDataset }) {
  const { orientation, pages } = buildPages(ds);
  const size = PAGE[orientation];
  return (
    <>
      <style>{`${REPORT_CSS}\n@page { size: letter ${orientation}; margin: 0; }\n.page { width: ${size.w}in; height: ${size.h}in; }`}</style>
      {pages.map((pg, i) => (
        <section key={pg.key} className="page" aria-label={`Page ${i + 1}`}>
          <Band ds={ds} />
          <div className="content">{pg.body}</div>
          <Foot ds={ds} n={i + 1} total={pages.length} />
        </section>
      ))}
    </>
  );
}
