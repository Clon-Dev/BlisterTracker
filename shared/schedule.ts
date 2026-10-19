// How a pack schedule maps to calendar days and reminder times.
// Shared by the app and the worker, so both always compute the same moments.
//
// A pack is `pillsPerPack` pills (the last `placebo` of them are placebo pills, still taken daily),
// followed by `breakDays` pill-free days; then the next pack starts automatically.
// Pills are tied to calendar days like a real blister: the pill of a day stays "missed" if that day
// passes without being marked.

export type Plan = {
  pillsPerPack: number;
  placebo: number;
  breakDays: number;
  /** "YYYY-MM-DD" of pill 1 of the current pack chain; later packs follow every `pillsPerPack + breakDays` days. */
  packStart: string;
  /**
   * Earlier pack starts (ascending, all before `packStart`). Starting a pack early (to delay a period)
   * moves `packStart` and keeps the old one here, so past days keep their pack position.
   */
  earlierPackStarts?: string[];
  /** Packs at home including the one that started on `supplyFrom` (0/undefined = not tracked). */
  supplyPacks?: number;
  supplyFrom?: string;
  /** Next doctor's appointment ("YYYY-MM-DD"); a notice goes out the day before at `time`. */
  appointmentDay?: string | null;
  /** Days before this one are treated as taken (the app didn't track them). */
  trackingSince: string;
  /** Daily reminder time "HH:MM" in `tz`. */
  time: string;
  tz: string;
  /** Repeat the owner's reminder every N minutes until taken (0 = off). */
  repeatMinutes: number;
  /** Alert followers when the pill is still not taken N minutes after `time` (0 = off). */
  lateMinutes: number;
  /** Day "YYYY-MM-DD" → time "HH:MM" the pill was marked as taken. */
  takenDays: Record<string, string>;
};

export type DayKind = "active" | "placebo" | "break";

export const MAX_REPEATS = 8;
const DAY_MS = 86_400_000;

// ---------- Calendar days (plain "YYYY-MM-DD" strings, no time zone involved) ----------

const toUtc = (day: string) => Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => fromUtc(toUtc(day) + n * DAY_MS);
export const diffDays = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
/** 0 = Monday … 6 = Sunday. */
export const weekday = (day: string) => (new Date(toUtc(day)).getUTCDay() + 6) % 7;

// ---------- Time zones (Intl only, works in Hermes, browsers and Workers) ----------

function zonedParts(at: number, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** Calendar day of an instant in tz. */
export function dayKey(at: number, tz: string) {
  const p = zonedParts(at, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** "HH:MM" of an instant in tz. */
export function clock(at: number, tz: string) {
  const p = zonedParts(at, tz);
  return `${p.hour}:${p.minute}`;
}

/** UTC instant of wall-clock `time` on `day` in tz (DST-safe). */
export function zonedTime(day: string, time: string, tz: string) {
  const [h, m] = time.split(":").map(Number);
  const guess = toUtc(day) + (h * 60 + m) * 60_000;
  const offset = (at: number) => {
    const p = zonedParts(at, tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at / 1000) * 1000;
  };
  return guess - offset(guess - offset(guess)); // second pass settles DST boundaries
}

// ---------- Pack position ----------

export const cycleLength = (p: Plan) => p.pillsPerPack + p.breakDays;

const anchors = (p: Plan) => [...(p.earlierPackStarts ?? []), p.packStart];

/** Which pack a day belongs to and what kind of day it is (counted from the latest pack start on or before it). */
export function slot(p: Plan, day: string) {
  const cycle = cycleLength(p);
  const all = anchors(p);
  const anchor = all.filter((a) => a <= day).pop() ?? all[0];
  const offset = diffDays(anchor, day);
  const index = ((offset % cycle) + cycle) % cycle;
  const kind: DayKind = index >= p.pillsPerPack ? "break" : index >= p.pillsPerPack - p.placebo ? "placebo" : "active";
  return { index, kind, packStart: addDays(day, -index) };
}

export const isPillDay = (p: Plan, day: string) => slot(p, day).kind !== "break";

/** Start of the pack after the one containing `day` (an early start cuts the current pack short). */
export function nextPackStart(p: Plan, day: string) {
  const regular = addDays(slot(p, day).packStart, cycleLength(p));
  const early = anchors(p).find((a) => a > day && a < regular);
  return early ?? regular;
}

/** Packs left on `day`, counting the current one; null when the supply isn't tracked. 1 = last pack. */
export function packsLeft(p: Plan, day: string): number | null {
  if (!p.supplyPacks || !p.supplyFrom) return null;
  let start = slot(p, p.supplyFrom).packStart;
  const current = slot(p, day).packStart;
  let left = p.supplyPacks;
  while (start < current) { start = nextPackStart(p, start); left--; }
  return left;
}

/** Moment the last pack starts (refill reminder), at the reminder time; null if not tracked. */
export function refillTime(p: Plan): number | null {
  if (!p.supplyPacks || !p.supplyFrom) return null;
  let start = slot(p, p.supplyFrom).packStart;
  for (let left = p.supplyPacks; left > 1; left--) start = nextPackStart(p, start);
  return zonedTime(start, p.time, p.tz);
}

/** Moment of the appointment reminder: the day before, at the reminder time. */
export const appointmentTime = (p: Plan) => (p.appointmentDay ? zonedTime(addDays(p.appointmentDay, -1), p.time, p.tz) : null);

export type NoticeKind = "refill" | "appointment";
/** Owner notices (refill, appointment) due exactly at `at`. */
export const noticesAt = (p: Plan, at: number): NoticeKind[] =>
  ([["refill", refillTime(p)], ["appointment", appointmentTime(p)]] as const).filter(([, t]) => t === at).map(([k]) => k);
/** Next owner notice strictly after `after`, or null. */
export function nextNoticeAt(p: Plan, after: number) {
  const future = [refillTime(p), appointmentTime(p)].filter((t): t is number => t !== null && t > after);
  return future.length ? Math.min(...future) : null;
}
export const isTaken = (p: Plan, day: string) => day in p.takenDays || day < p.trackingSince;

// ---------- Notification moments ----------

/** Owner reminder instants on `day`: the reminder and its repeats (same local day only); none if not due. */
export function reminderTimes(p: Plan, day: string): number[] {
  if (!isPillDay(p, day) || isTaken(p, day)) return [];
  const first = zonedTime(day, p.time, p.tz);
  const times = [first];
  if (p.repeatMinutes > 0) {
    for (let k = 1; k <= MAX_REPEATS; k++) {
      const at = first + k * p.repeatMinutes * 60_000;
      if (dayKey(at, p.tz) !== day) break;
      times.push(at);
    }
  }
  return times;
}

/** Instant followers are told the pill of `day` is still not taken, or null. */
export function lateTime(p: Plan, day: string): number | null {
  if (p.lateMinutes <= 0 || !isPillDay(p, day) || isTaken(p, day)) return null;
  return zonedTime(day, p.time, p.tz) + p.lateMinutes * 60_000;
}

/** First instant strictly after `after` matching `times(day)`, scanning one full cycle ahead. */
function nextMatching(p: Plan, after: number, times: (day: string) => number[]): number | null {
  const start = addDays(dayKey(after, p.tz), -1); // a late alert can fall on the next calendar day
  for (let i = 0; i <= cycleLength(p) + 2; i++) {
    const hit = times(addDays(start, i)).find((t) => t > after);
    if (hit !== undefined) return hit;
  }
  return null;
}

export const nextReminderAt = (p: Plan, after: number) => nextMatching(p, after, (d) => reminderTimes(p, d));
export const nextLateAt = (p: Plan, after: number) => nextMatching(p, after, (d) => {
  const t = lateTime(p, d);
  return t === null ? [] : [t];
});
