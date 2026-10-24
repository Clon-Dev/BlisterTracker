// Unit tests for src/export.ts (rows, CSV, PDF table). Usage: npx tsx scripts/test-export.ts
import { buildRows, landscape, toCsv, toHtml, type ColumnKey } from "../src/export.ts";
import type { Plan } from "../shared/schedule.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

// Just the texts the export uses, in English.
const t = {
  weekdays: ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"],
  moodNames: ["very good", "good", "okay", "not great", "bad"],
  appointmentSheetTitle: "Doctor’s appointment",
  legendBreak: "Pill-free", legendMissed: "Missed",
  legendWearing: { pill: "Pill", patch: "Patch on", ring: "Ring in", injection: "Protected" },
  legendFree: { patch: "Patch-free", ring: "Ring-free" },
  actionName: { pill: "Pill", apply: "New patch", change: "Patch change", removePatch: "Patch removal", insert: "New ring", removeRing: "Ring removal", inject: "Injection" },
  daysLate: (v: { n: number }) => (v.n === 1 ? "1 day late" : `${v.n} days late`),
  patchWearing: (v: { n: number; d: number }) => `Patch ${v.n} · day ${v.d} of 7`,
  patchFree: (v: { d: number }) => `Patch-free week · day ${v.d} of 7`,
  ringIn: (v: { d: number; total: number }) => `Ring in · day ${v.d} of ${v.total}`,
  ringFree: (v: { d: number }) => `Ring-free week · day ${v.d} of 7`,
  injectionWeek: (v: { w: number; total: number }) => `Protected · week ${v.w} of ${v.total}`,
  exportPill: (v: { n: number }) => `Pill ${v.n}`,
  exportPlacebo: (v: { n: number }) => `Placebo pill ${v.n}`,
  exportPackDay: (v: { d: number; total: number }) => `Pack day ${v.d} of ${v.total}`,
  exportNewPack: "New pack", exportBeforeSetup: "Before tracking", exportOpen: "Still open",
  exportMoved: (v: { day: string }) => `Done late on ${v.day}`,
  exportColumns: { date: "Date", mood: "Mood", note: "Note", contraception: "Contraception", taken: "Taken / done", time: "Time", remark: "Remark", cycle: "Cycle", appointment: "Appointment" },
  exportPdfTitle: (v: { from: string; to: string }) => `Blister Buddy Summary – ${v.from} – ${v.to}`,
  exportNothing: "No entries in this period.",
  exportLegend: "[x] taken / done · [ ] not taken",
  exportCreated: (v: { date: string }) => `Created on ${v.date}`,
} as never;

const pill: Plan = {
  pillsPerPack: 21, placebo: 0, breakDays: 7, packStart: "2026-10-01", trackingSince: "2026-10-03", time: "20:00", tz: "Europe/Berlin",
  repeatMinutes: 0, lateMinutes: 0, takenDays: { "2026-10-03": "20:05", "2026-10-05": "21:10" },
};
const base = { t, lang: "en" as const, notes: {}, today: "2026-10-06" };

// No plan: only days with a note.
const notesOnly = buildRows({ ...base, from: "2026-10-01", to: "2026-10-06", plan: null, notes: { "2026-10-02": { text: "Headache, slept badly", mood: "😕" }, "2026-10-04": { text: "", mood: null } } });
eq("no plan: one row per day with a note (empty notes skipped)", notesOnly.map((r) => [r.date, r.mood, r.note]), [["Fr 02.10.2026", "😕 not great", "Headache, slept badly"]]);

// Pill: before tracking (in the first pack), taken, missed, open today.
const rows = buildRows({ ...base, from: "2026-10-01", to: "2026-10-10", plan: pill });
eq("pill: one row per day up to today", rows.length, 6);
eq("pill: first day of the pack before tracking counts as taken, marks the new pack", [rows[0].contraception, rows[0].taken, rows[0].remark], ["Pill 1", "[x]", "New pack · Before tracking"]);
eq("pill: taken with the time", [rows[2].contraception, rows[2].taken, rows[2].time, rows[2].cycle], ["Pill 3", "[x]", "20:05", "Pack day 3 of 28"]);
eq("pill: missed", [rows[3].taken, rows[3].remark], ["[ ]", "Missed"]);
eq("pill: today not yet taken is still open", [rows[5].taken, rows[5].remark], ["[ ]", "Still open"]);
const brk = buildRows({ ...base, today: "2026-10-23", from: "2026-10-22", to: "2026-10-22", plan: pill });
eq("pill: break day has no checkbox", [brk[0].contraception, brk[0].taken], ["Pill-free", ""]);

// Patch: a change done a day late; a day between changes; appointment with its note.
const patch: Plan = { ...pill, method: "patch", trackingSince: "2026-10-01", takenDays: { "2026-10-01": "09:00", "2026-10-08": "2026-10-09T08:30" } };
const p = buildRows({ ...base, today: "2026-10-10", from: "2026-10-08", to: "2026-10-09", plan: { ...patch, appointmentDay: "2026-10-09" }, appointmentNote: "Dr. Weber 9:30" });
eq("patch: late change shows the day and time it was done", [p[0].contraception, p[0].taken, p[0].time, p[0].remark], ["Patch change", "[x]", "09.10. 08:30", "1 day late"]);
eq("patch: a wear day without an action", [p[1].contraception, p[1].taken, p[1].cycle], ["Patch on", "", "Patch 2 · day 2 of 7"]);
eq("appointment with its note", p[1].appointment, "Doctor’s appointment: Dr. Weber 9:30");

// Injection: only the injection days (and notes), not 12 weeks of "protected".
const shot: Plan = { ...pill, method: "injection", pillsPerPack: 84, breakDays: 0, packStart: "2026-07-01", trackingSince: "2026-07-01", takenDays: { "2026-07-01": "10:00" } };
const inj = buildRows({ ...base, today: "2026-10-10", from: "2026-07-01", to: "2026-10-10", plan: shot });
eq("injection: the injection days only", inj.map((r) => [r.date.slice(3), r.contraception, r.taken, r.remark]), [["01.07.2026", "Injection", "[x]", ""], ["23.09.2026", "Injection", "[ ]", "Still open · 17 days late"]]);

// CSV: quoting, separator per language, BOM.
const cols: ColumnKey[] = ["date", "note", "taken"];
const csv = toCsv([{ ...rows[2], note: 'Felt "fine", a bit tired;\nslept late' }], cols, t, "de");
eq("CSV: BOM, header, ';' for German, quotes doubled, multi-line note quoted", csv,
  '﻿Date;Note;Taken / done\r\nSa 03.10.2026;"Felt ""fine"", a bit tired;\nslept late";[x]\r\n');
eq("CSV: ',' for English", toCsv([], ["date", "time"], t, "en").split("\r\n")[0], "﻿Date,Time");

// PDF: title with the period, escaped notes, a wide note column, orientation.
const html = toHtml([{ ...rows[2], note: "<b>pain</b> & cramps" }], ["date", "note", "taken"], { from: "2026-10-01", to: "2026-10-10", today: "2026-10-06", subtitle: "Svea" }, t, "en");
eq("PDF title with the period (end capped at today)", /<h1>Blister Buddy Summary – 01\.10\.2026 – 06\.10\.2026<\/h1>/.test(html), true);
eq("PDF escapes notes", html.includes("&lt;b&gt;pain&lt;/b&gt; &amp; cramps") && !html.includes("<b>pain"), true);
const widths = [...html.matchAll(/<col style="width:([\d.]+)%">/g)].map((m) => +m[1]);
eq("PDF: the note column is the widest, the checkbox the narrowest", [widths.indexOf(Math.max(...widths)), widths.indexOf(Math.min(...widths))], [1, 2]);
eq("PDF: readable font sizes (10.5pt body, 16pt title)", html.includes("font-size: 10.5pt") && html.includes("font-size: 16pt"), true);
eq("PDF: header row repeats on every page", html.includes("thead { display: table-header-group; }"), true);
eq("orientation: few columns portrait, many landscape", [landscape(["date", "mood", "note"]), landscape(["date", "mood", "note", "contraception", "taken", "time"])], [false, true]);
eq("PDF without rows says so", toHtml([], cols, { from: "2026-10-01", to: "2026-10-02", today: "2026-10-06", subtitle: "" }, t, "en").includes("No entries in this period."), true);

console.log(failures ? `\n${failures} FAILED` : "\nAll export tests passed.");
process.exit(failures ? 1 : 0);
