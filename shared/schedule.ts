// How a contraception schedule maps to calendar days and reminder times.
// Shared by the app and the worker, so both always compute the same moments.
//
// Every method is a repeating cycle of `pillsPerPack` "wear" days followed by `breakDays` break days, anchored at
// `packStart`; what has to be done on which day depends on the method (see actionOn):
//   pill       a pill every wear day (the last `placebo` are placebo pills, still taken daily); 21+7, 24+4, 28+0, …
//   patch      a new patch every 7 days during the wear phase, removed at its end; 21+7 (or 42+7: 6 in a row)
//   ring       a ring inserted on day 1 and removed after the wear phase; 21+7 (or 21+0: straight to the next ring)
//   injection  one injection per cycle; 84+0 (12 weeks), 56+0 or 91+0
// A pill is tied to its calendar day like a real blister: it stays "missed" once its day passes. The other actions
// stay open until they're done (reminders continue), and a late or early cycle start moves the cycle (see movedTo).

export type Method = "pill" | "patch" | "ring" | "injection";
export const METHODS: Method[] = ["pill", "patch", "ring", "injection"];
export type Action = "pill" | "apply" | "change" | "remove" | "insert" | "inject";

export type Plan = {
  /** Missing = pill (schedules from before other methods). */
  method?: Method;
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
  /**
   * Scheduled day "YYYY-MM-DD" → when its action was done: "HH:MM" on that day ("" = time unknown), or
   * "YYYY-MM-DDTHH:MM" when it was done on another day (a late patch change).
   */
  takenDays: Record<string, string>;
};

export const methodOf = (p: { method?: Method }): Method => p.method ?? "pill";

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

export const anchors = (p: Plan) => [...(p.earlierPackStarts ?? []), p.packStart];

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

/** The action due on `day` by the schedule, or null. */
export function actionOn(p: Plan, day: string): Action | null {
  const { index, kind } = slot(p, day);
  switch (methodOf(p)) {
    case "pill": return kind === "break" ? null : "pill";
    case "patch":
      if (index === 0) return "apply";
      if (index < p.pillsPerPack) return index % 7 === 0 ? "change" : null;
      return index === p.pillsPerPack && p.breakDays > 0 ? "remove" : null;
    case "ring": return index === 0 ? "insert" : index === p.pillsPerPack && p.breakDays > 0 ? "remove" : null;
    case "injection": return index === 0 ? "inject" : null;
  }
}

/** Whether something is due on `day` (a pill day, a patch change, …). */
export const isPillDay = (p: Plan, day: string) => actionOn(p, day) !== null;

/** Actions that start a cycle: done on another day, they move the cycle there (patch/ring weekday, injection date). */
export const startsCycle = (a: Action | null) => a === "apply" || a === "insert" || a === "inject";
/** An action as the texts name it: removing a patch and removing a ring read differently. */
export type ActionKey = "pill" | "apply" | "change" | "removePatch" | "insert" | "removeRing" | "inject";
export const actionKey = (p: { method?: Method }, a: Action): ActionKey =>
  (a === "remove" ? (methodOf(p) === "patch" ? "removePatch" : "removeRing") : a);

/** How many days an undone action stays open (reminders continue); a pill only on its own day. */
export const CARRY_DAYS: Record<Method, number> = { pill: 0, patch: 6, ring: 6, injection: 28 };
/** Followers are told an action is late this many days after it was due (pills: `lateMinutes` on the day). */
export const LATE_DAYS: Record<Method, number> = { pill: 0, patch: 1, ring: 1, injection: 7 };

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

/** The injection: a heads-up this many days before it's due (time to book the appointment), at the reminder time. */
export const INJECTION_NOTICE_DAYS = 7;
const injectionNoticeOn = (p: Plan, day: string) =>
  methodOf(p) === "injection" && day >= p.trackingSince && actionOn(p, addDays(day, INJECTION_NOTICE_DAYS)) === "inject";

export type NoticeKind = "refill" | "appointment" | "injection";
/** Owner notices (refill, appointment, upcoming injection) due exactly at `at`. */
export function noticesAt(p: Plan, at: number): NoticeKind[] {
  const day = dayKey(at, p.tz);
  const injection = injectionNoticeOn(p, day) ? zonedTime(day, p.time, p.tz) : null;
  return ([["refill", refillTime(p)], ["appointment", appointmentTime(p)], ["injection", injection]] as const).filter(([, t]) => t === at).map(([k]) => k);
}
/** Next owner notice strictly after `after`, or null. */
export function nextNoticeAt(p: Plan, after: number) {
  const injection = methodOf(p) === "injection" ? nextMatching(p, after, (d) => (injectionNoticeOn(p, d) ? [zonedTime(d, p.time, p.tz)] : [])) : null;
  const future = [refillTime(p), appointmentTime(p), injection].filter((t): t is number => t !== null && t > after);
  return future.length ? Math.min(...future) : null;
}
/**
 * A cycle start done late on another day moves the cycle there (a new anchor after it): the scheduled day then
 * counts as done (late); returns the day it was done.
 */
export function movedTo(p: Plan, day: string): string | null {
  if (!startsCycle(actionOn(p, day))) return null;
  return anchors(p).find((a) => a > day && diffDays(day, a) <= CARRY_DAYS[methodOf(p)]) ?? null;
}

export const isTaken = (p: Plan, day: string) => day in p.takenDays || day < p.trackingSince || movedTo(p, day) !== null;

/** When the action of `day` was done: the day and "HH:MM" ("" = unknown), or null if it isn't recorded. */
export function doneAt(p: Plan, day: string): { day: string; time: string } | null {
  const moved = movedTo(p, day);
  if (moved) return { day: moved, time: p.takenDays[moved] ?? "" };
  const v = p.takenDays[day];
  if (v === undefined) return null;
  return v.length > 5 ? { day: v.slice(0, 10), time: v.slice(11) } : { day, time: v };
}

/** The action recorded as done on `day` (by its actual day): its scheduled day and time, or null. */
export function doneOn(p: Plan, day: string): { scheduled: string; time: string } | null {
  const own = p.takenDays[day];
  if (own !== undefined && own.length <= 5) return { scheduled: day, time: own };
  const late = Object.entries(p.takenDays).find(([, v]) => v.startsWith(`${day}T`));
  return late ? { scheduled: late[0], time: late[1].slice(11) } : null;
}

/**
 * The plan with the action of `scheduled` recorded as done on `done.day` at `done.time` ("" = unknown), or undone
 * (null). For patch, ring and injection (pills record "HH:MM" on their own day):
 * - done on its day: "HH:MM"; a late mid-cycle patch change: "YYYY-MM-DDTHH:MM" (the change weekday stays);
 * - a cycle start (first patch, new ring, injection) done on another day moves the cycle there: a new anchor with
 *   the record on it (familienplanung.de: start and change weekday move; the next injection counts from the last).
 */
export function withAction(p: Plan, scheduled: string, done: { day: string; time: string } | null): Plan {
  const takenDays = { ...p.takenDays };
  const all = anchors(p);
  const moved = movedTo(p, scheduled);
  if (moved) delete takenDays[moved];
  delete takenDays[scheduled];
  if (done === null) {
    if (!moved) return { ...p, takenDays };
    const rest = all.filter((a) => a !== moved);
    return { ...p, takenDays, packStart: rest[rest.length - 1], earlierPackStarts: rest.slice(0, -1) };
  }
  if (startsCycle(actionOn(p, scheduled)) && done.day !== scheduled) {
    takenDays[done.day] = done.time;
    return { ...p, takenDays, packStart: done.day, earlierPackStarts: all.filter((a) => a < done.day && a !== moved) };
  }
  takenDays[scheduled] = done.day === scheduled ? done.time : `${done.day}T${done.time}`;
  return { ...p, takenDays };
}

/** The scheduled day of the action still open on `day` (due that day, or carried over and not done yet), or null. */
export type DayState = "done" | "late" | "missed" | "open" | "future";
/** State of the action scheduled on `day` as of `today`: done (on the day), late (on a later day), missed, open or future. */
export function actionState(p: Plan, day: string, today: string): DayState {
  const done = doneAt(p, day);
  if (done || isTaken(p, day)) return done && done.day !== day ? "late" : "done";
  if (day > today) return "future";
  return openActionDay(p, today) === day ? "open" : "missed";
}
export function openActionDay(p: Plan, day: string): string | null {
  for (let back = 0; back <= CARRY_DAYS[methodOf(p)]; back++) {
    const d = addDays(day, -back);
    if (actionOn(p, d)) return isTaken(p, d) ? null : d; // the latest scheduled action decides
  }
  return null;
}

/** The next scheduled action on or after `day` (within two cycles), or null. */
export function nextAction(p: Plan, day: string): { day: string; action: Action } | null {
  for (let i = 0; i <= 2 * cycleLength(p); i++) {
    const d = addDays(day, i);
    const action = actionOn(p, d);
    if (action && !isTaken(p, d)) return { day: d, action };
  }
  return null;
}

// ---------- Late actions (rules from familienplanung.de, see README) ----------

export type LateRule =
  | "patch-change-under-48h" | "patch-change-over-48h" | "patch-start-late" | "patch-remove-late"
  | "ring-insert-late" | "ring-remove-late" | "ring-over-4-weeks"
  | "injection-due" | "injection-over-14-weeks";

/** How late the open action of `day` is at `now`, and which rule applies; null when it isn't late (or not open). */
export function lateness(p: Plan, day: string, now: number): { hours: number; rule: LateRule } | null {
  const action = actionOn(p, day);
  if (!action || action === "pill" || isTaken(p, day)) return null;
  const hours = (now - zonedTime(day, p.time, p.tz)) / 3_600_000;
  if (hours <= 0) return null;
  switch (action) {
    case "change": return { hours, rule: hours < 48 ? "patch-change-under-48h" : "patch-change-over-48h" };
    case "apply": return hours > 24 ? { hours, rule: "patch-start-late" } : null;
    case "remove":
      if (methodOf(p) === "patch") return hours > 24 ? { hours, rule: "patch-remove-late" } : null;
      return hours > 24 * 7 ? { hours, rule: "ring-over-4-weeks" } : hours > 24 ? { hours, rule: "ring-remove-late" } : null;
    case "insert": return hours > 3 ? { hours, rule: "ring-insert-late" } : null;
    case "inject": {
      // The 3-month injection (12 or 13 weeks): after 14 weeks since the last one protection isn't certain.
      // Other intervals (8 weeks) have no limit from the source: just "due".
      const weeksSinceLast = (cycleLength(p) + hours / 24) / 7;
      return { hours, rule: cycleLength(p) >= 84 && weeksSinceLast > 14 ? "injection-over-14-weeks" : "injection-due" };
    }
  }
}

/** First day whose pill can still be corrected: the start of the pack in which tracking began. */
export const firstEditableDay = (p: Plan) => slot(p, p.trackingSince).packStart;

/**
 * The setup said the pills of that first pack before the setup day were taken (the blister shows them popped,
 * without marks). To correct one of them they become explicit marks (time unknown) and tracking starts at the
 * pack start. Every day keeps its state; idempotent.
 */
export function trackFromPackStart(p: Plan): Plan {
  const from = firstEditableDay(p);
  if (from >= p.trackingSince) return p;
  const takenDays = { ...p.takenDays };
  for (let d = from; d < p.trackingSince; d = addDays(d, 1)) if (isPillDay(p, d) && !(d in takenDays)) takenDays[d] = "";
  return { ...p, takenDays, trackingSince: from };
}

// ---------- Notification moments ----------

/** Owner reminder instants on `day`: the reminder and its repeats (same local day only); none if nothing is open. */
export function reminderTimes(p: Plan, day: string): number[] {
  if (!openActionDay(p, day)) return [];
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

/**
 * Instant on `day` at which followers are told something is still not done, or null: for a pill `lateMinutes`
 * after the reminder time; for the other methods at the reminder time LATE_DAYS after the action was due.
 */
export function lateTime(p: Plan, day: string): number | null {
  if (p.lateMinutes <= 0) return null;
  const method = methodOf(p);
  if (method === "pill") return isPillDay(p, day) && !isTaken(p, day) ? zonedTime(day, p.time, p.tz) + p.lateMinutes * 60_000 : null;
  const open = openActionDay(p, day);
  return open && diffDays(open, day) === LATE_DAYS[method] ? zonedTime(day, p.time, p.tz) : null;
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

/**
 * Pills taken in a row (pill), or patch / ring / injection actions done on their scheduled day in a row, counting back
 * from today. Today counts once it's done; while it's still open it doesn't break the streak. Starts at the setup.
 */
export function streak(p: Plan, today: string): number {
  const pill = methodOf(p) === "pill";
  let n = 0;
  for (let i = 0, day = today; i < 800 && day >= p.trackingSince; i++, day = addDays(day, -1)) {
    if (!actionOn(p, day)) continue;
    const done = pill ? day in p.takenDays : doneAt(p, day)?.day === day;
    if (done) n++;
    else if (day !== today) break;
  }
  return n;
}
