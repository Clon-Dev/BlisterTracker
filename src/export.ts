// Export of the own daily data (notes, and with a plan: what was due, done or missed) as CSV or a printable
// HTML table (PDF). Pure: builds rows and files from the schedule and the decrypted notes.
import {
  actionKey, actionOn, actionState, addDays, cycleLength, diffDays, doneAt, firstEditableDay, methodOf, movedTo, slot, weekday, type Plan,
} from "../shared/schedule";
import type { Note } from "./data";
import type { Lang, Strings } from "./i18n";

export type ColumnKey = "date" | "mood" | "note" | "contraception" | "taken" | "time" | "remark" | "cycle" | "appointment";
export const COLUMNS: ColumnKey[] = ["date", "mood", "note", "contraception", "taken", "time", "remark", "cycle", "appointment"];
/** Columns that only exist with an own contraception plan. */
export const PLAN_COLUMNS: ColumnKey[] = ["contraception", "taken", "time", "remark", "cycle", "appointment"];
/** Relative PDF column widths: free text gets the room, yes/no and times stay narrow. */
const WIDTH: Record<ColumnKey, number> = { date: 16, mood: 11, note: 40, contraception: 12, taken: 7, time: 9, remark: 15, cycle: 12, appointment: 16 };
/** Short values that must stay on one line (a date or time broken in two is hard to read). */
const NOWRAP: ColumnKey[] = ["date", "taken", "time"];

export type Row = Record<ColumnKey, string>;
/** The order of `MOODS` in data.ts (best to worst), for the mood names. */
const MOOD_ORDER = ["😄", "🙂", "😐", "😕", "😣"];
type Input = {
  from: string; to: string; today: string; t: Strings; lang: Lang;
  notes: Record<string, Note>;
  /** The own plan, if any (with its decrypted appointment note). */
  plan: (Plan & { appointmentDay?: string | null }) | null; appointmentNote?: string;
};

/** "05.10.2026" */
export const dmy = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

/**
 * One row per day from `from` to `to` (at most today). Without a plan only days with a note; with a plan also every
 * tracked day, so the table shows what was due, done and missed.
 */
export function buildRows({ from, to, today, t, notes, plan, appointmentNote }: Input): Row[] {
  const last = to < today ? to : today;
  const rows: Row[] = [];
  for (let day = from; day <= last; day = addDays(day, 1)) {
    const note = notes[day];
    const hasNote = !!note && !note.locked && (!!note.text.trim() || !!note.mood);
    const p = plan && planInfo(plan, day, today, t);
    const appointment = plan?.appointmentDay === day ? [t.appointmentSheetTitle, appointmentNote].filter(Boolean).join(": ") : "";
    if (!hasNote && !p && !appointment) continue;
    const mood = hasNote && note.mood ? `${note.mood} ${t.moodNames[MOOD_ORDER.indexOf(note.mood)] ?? ""}`.trim() : "";
    rows.push({
      date: `${t.weekdays[weekday(day)]} ${dmy(day)}`,
      mood, note: hasNote ? note.text.trim() : "",
      contraception: p?.what ?? "", taken: p?.taken ?? "", time: p?.time ?? "", remark: p?.remark ?? "", cycle: p?.cycle ?? "",
      appointment,
    });
  }
  return rows;
}

const YES = "[x]";
const NO = "[ ]";

/** What the plan says about `day`, or null before tracking (nothing known). */
function planInfo(p: Plan, day: string, today: string, t: Strings) {
  const method = methodOf(p);
  const { index, kind } = slot(p, day);
  const recorded = day in p.takenDays;
  const before = day < p.trackingSince;
  if (before && !recorded && day < firstEditableDay(p)) return null;
  const otherDay = (d: string) => `${dmy(d).slice(0, 6)} `; // "07.10. " before a time done on another day

  if (method === "pill") {
    const cycle = t.exportPackDay({ d: index + 1, total: cycleLength(p) });
    if (kind === "break" && !recorded) return { what: t.legendBreak, taken: "", time: "", remark: "", cycle };
    const n = index + 1;
    const what = kind === "placebo" ? t.exportPlacebo({ n }) : t.exportPill({ n });
    const newPack = index === 0 ? t.exportNewPack : "";
    if (recorded) return { what, taken: YES, time: p.takenDays[day], remark: newPack, cycle };
    if (before) return { what, taken: YES, time: "", remark: join(newPack, t.exportBeforeSetup), cycle };
    return { what, taken: NO, time: "", remark: join(newPack, day < today ? t.legendMissed : t.exportOpen), cycle };
  }

  const wear = p.pillsPerPack;
  const cycle = method === "patch"
    ? (index < wear ? t.patchWearing({ n: Math.floor(index / 7) + 1, d: (index % 7) + 1 }) : t.patchFree({ d: index - wear + 1 }))
    : method === "ring"
      ? (index < wear ? t.ringIn({ d: index + 1, total: wear }) : t.ringFree({ d: index - wear + 1 }))
      : t.injectionWeek({ w: Math.floor(index / 7) + 1, total: cycleLength(p) / 7 });
  const action = actionOn(p, day);
  if (!action) {
    if (method === "injection") return null; // 12 weeks of "protected" rows tell a doctor nothing; the injection days do
    const what = kind === "break" ? t.legendFree[method] : t.legendWearing[method];
    return { what, taken: "", time: "", remark: "", cycle };
  }
  const what = t.actionName[actionKey(p, action)];
  if (before && !recorded) return { what, taken: YES, time: "", remark: t.exportBeforeSetup, cycle };
  const moved = movedTo(p, day);
  const done = doneAt(p, day);
  if (moved) return { what, taken: YES, time: otherDay(moved) + (done?.time ?? ""), remark: t.exportMoved({ day: dmy(moved) }), cycle };
  const state = actionState(p, day, today);
  if (done) {
    const late = diffDays(day, done.day);
    return { what, taken: YES, time: (late ? otherDay(done.day) : "") + done.time, remark: late > 0 ? t.daysLate({ n: late }) : "", cycle };
  }
  const overdue = day < today ? t.daysLate({ n: diffDays(day, today) }) : "";
  return { what, taken: NO, time: "", remark: state === "missed" ? t.legendMissed : join(t.exportOpen, overdue), cycle };
}

const join = (...parts: string[]) => parts.filter(Boolean).join(" · ");

// ---------- CSV ----------

/** CSV with a BOM (Excel opens UTF-8 correctly); German Excel expects ";" as the separator. */
export function toCsv(rows: Row[], columns: ColumnKey[], t: Strings, lang: Lang) {
  const sep = lang === "de" ? ";" : ",";
  const cell = (v: string) => (/[";,\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [columns.map((c) => cell(t.exportColumns[c])).join(sep), ...rows.map((r) => columns.map((c) => cell(r[c])).join(sep))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------- PDF (printable HTML) ----------

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Many columns (or a note column next to plan columns) print in landscape. */
export const landscape = (columns: ColumnKey[]) => columns.length > 5 || (columns.includes("note") && columns.length > 4);

export function toHtml(rows: Row[], columns: ColumnKey[], meta: { from: string; to: string; today: string; subtitle: string }, t: Strings, lang: Lang) {
  const total = columns.reduce((n, c) => n + WIDTH[c], 0);
  const title = t.exportPdfTitle({ from: dmy(meta.from), to: dmy(meta.to < meta.today ? meta.to : meta.today) });
  const center: ColumnKey[] = ["taken", "time"];
  const cls = (c: ColumnKey) => {
    const names = [center.includes(c) && "c", NOWRAP.includes(c) && "nw"].filter(Boolean);
    return names.length ? ` class="${names.join(" ")}"` : "";
  };
  return `<!doctype html>
<html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4 ${landscape(columns) ? "landscape" : "portrait"}; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; color: #2b1d24; font-size: 10.5pt; line-height: 1.35; margin: 0; }
  h1 { font-size: 16pt; margin: 0 0 4pt; }
  .meta { color: #6b5a62; font-size: 9.5pt; margin: 0 0 10pt; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead { display: table-header-group; }
  th { background: #f6e3ea; text-align: left; font-size: 9.5pt; padding: 5pt 6pt; border-bottom: 1.5pt solid #c2577a; }
  td { padding: 4pt 6pt; border-bottom: 0.6pt solid #e7d6dd; vertical-align: top; overflow-wrap: break-word; white-space: pre-wrap; }
  .nw { white-space: nowrap; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  tbody tr:nth-child(even) td { background: #fcf7f9; }
  .c { text-align: center; }
  .empty { color: #6b5a62; font-style: italic; padding: 12pt 0; }
  .foot { color: #6b5a62; font-size: 8.5pt; margin-top: 10pt; }
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">${esc(meta.subtitle)}</p>
${rows.length === 0 ? `<p class="empty">${esc(t.exportNothing)}</p>` : `<table>
<colgroup>${columns.map((c) => `<col style="width:${((WIDTH[c] / total) * 100).toFixed(1)}%">`).join("")}</colgroup>
<thead><tr>${columns.map((c) => `<th${center.includes(c) ? ' class="c"' : ""}>${esc(t.exportColumns[c])}</th>`).join("")}</tr></thead>
<tbody>
${rows.map((r) => `<tr>${columns.map((c) => `<td${cls(c)}>${esc(r[c])}</td>`).join("")}</tr>`).join("\n")}
</tbody></table>`}
<p class="foot">${esc([columns.includes("taken") ? t.exportLegend : "", t.exportCreated({ date: dmy(meta.today) })].filter(Boolean).join(" · "))}</p>
</body></html>`;
}

export const exportFileName = (from: string, to: string, ext: "csv" | "pdf") => `blister-buddy_${from}_${to}.${ext}`;
