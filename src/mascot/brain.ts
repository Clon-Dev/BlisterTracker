// What the kitten says and does next. Pure logic without React, so it can be unit-tested (scripts/test-mascot.ts).
import type { SpecialId } from "./calendar";

const GREET_WINDOW = 60_000; // greet only right after opening
const MOOD_DELAY = 6_000;
const FACT_DELAY = 20_000;
/** From this hour Nyxi says good night (once per evening). */
export const NIGHT_HOUR = 21;
const NIGHT_DELAY = 10_000; // after the mood question's turn, so good night comes last
export const NAP_AFTER = 120_000;
export const SNOOZE = 30 * 60_000;

/**
 * Today's pill (or patch / ring / injection action) of the own schedule. `minutesLate` counts from the reminder time;
 * `action` names a non-pill action; `soonDays`: an injection due in that many days.
 */
export type PillState = {
  number: number; state: "due" | "overdue" | "taken" | "break"; minutesLate: number; action?: string; soonDays?: number;
} | null;

/** Remembered per device (AsyncStorage). The daily fields reset when the day changes. */
export type Memory = {
  day: string;
  /** A fact was shown today (asked for or not), so no automatic one. */
  autoFact: boolean;
  moodAsked: boolean;
  greeted: boolean;
  /** Said good night this evening. */
  saidGoodnight?: boolean;
  /** Mentioned today that the injection is due soon. */
  soonSaid?: boolean;
  hidden: boolean;
  snoozeUntil: number;
  /** Facts already shown; cleared once all were shown. */
  seen: number[];
  lastTopic?: string;
  /** Nyxi has introduced itself (once per device). */
  introduced?: boolean;
  // ----- kept across days -----
  /** Has been tapped at least once (the 💡 badge until then). */
  tapped?: boolean;
  /** Every fact (index) ever shown, for the fact book. */
  found?: number[];
  /** "Myth or fact?" statements (fact tags) asked; cleared once all were asked. */
  myths?: string[];
  /** Statements ever answered, for the fact book. */
  mythsFound?: string[];
  quizStreak?: number;
  quizBest?: number;
  /** Milestones (tags) told; cleared once all were told. */
  milestones?: string[];
  milestonesFound?: string[];
  /** Special days greeted: id → year. */
  special?: Partial<Record<SpecialId, number>>;
  /** Outfits worn (for the wardrobe). */
  outfits?: string[];
  /** Highest streak milestone celebrated in the current streak. */
  streakSeen?: number;
  /** Day the crown is worn (a streak milestone). */
  crownDay?: string;
};

export const freshMemory = (day: string): Memory =>
  ({ day, autoFact: false, moodAsked: false, greeted: false, hidden: false, snoozeUntil: 0, seen: [] });

const KEPT = ["seen", "lastTopic", "introduced", "tapped", "found", "myths", "mythsFound", "quizStreak", "quizBest", "milestones", "milestonesFound",
  "special", "outfits", "streakSeen", "crownDay"] as const;

/** The memory for `day`: daily fields start over on a new day; what's collected over time is kept. */
export const forDay = (m: Memory, day: string): Memory => {
  if (m.day === day) return m;
  const kept = Object.fromEntries(KEPT.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));
  return { ...freshMemory(day), ...kept };
};

/** Streak lengths Nyxi celebrates: pills in a row, or patch / ring / injection actions on time in a row. */
export const STREAK_MILESTONES = { pill: [7, 14, 30, 50, 100, 200, 365], action: [3, 6, 12, 26, 52] } as const;

/** The milestone to celebrate now, if any: the highest one reached and not celebrated in this streak. */
export function streakToCelebrate(streak: number, unit: keyof typeof STREAK_MILESTONES, seen = 0): number | null {
  const reached = [...STREAK_MILESTONES[unit]].filter((n) => streak >= n).pop();
  const celebrated = streak < seen ? 0 : seen; // a broken streak starts over
  return reached && reached > celebrated ? reached : null;
}

export type Situation = {
  now: number;
  /** Device-local hour (0–23). */
  hour: number;
  /** Time since the home screen opened. */
  openedFor: number;
  pill: PillState;
  /** Whether today has a note; null when there's no own schedule (nothing to ask about). */
  hasNoteToday: boolean | null;
  factsEnabled: boolean;
  /** Today's special day (with outfits on), and the year, for "once a year". */
  special?: SpecialId | null;
  year?: number;
  /** Current streak of the own schedule and its unit. */
  streak?: { count: number; unit: keyof typeof STREAK_MILESTONES };
};

export type Say =
  | { kind: "reminder"; number: number; late: boolean; action?: string }
  | { kind: "soon"; days: number }
  | { kind: "greet"; part: "morning" | "day" | "evening" | "night"; intro: boolean }
  | { kind: "goodnight" }
  | { kind: "mood" }
  | { kind: "special"; id: SpecialId }
  | { kind: "streak"; days: number }
  | { kind: "fact" };

/** The message that is due now, by priority: reminder, greeting, mood question, good night, fact. */
const partOfDay = (hour: number) => (hour < 11 ? "morning" : hour < 18 ? "day" : hour < NIGHT_HOUR ? "evening" : "night") as "morning" | "day" | "evening" | "night";

export function nextMessage(s: Situation, m: Memory): Say | null {
  if (m.hidden) return null;
  if (s.pill?.state === "overdue" && s.now >= m.snoozeUntil) {
    return { kind: "reminder", number: s.pill.number, late: s.pill.minutesLate >= 60, ...(s.pill.action ? { action: s.pill.action } : {}) };
  }
  // An injection due within a week: once a day, so there's time to book the appointment.
  if (s.pill?.soonDays !== undefined && s.pill.soonDays <= 7 && !m.soonSaid && s.openedFor >= 4_000) return { kind: "soon", days: s.pill.soonDays };
  // The very first time: the introduction (what Nyxi can do) comes before anything else.
  if (!m.introduced && !m.greeted && s.openedFor < GREET_WINDOW) return { kind: "greet", part: partOfDay(s.hour), intro: true };
  // A special day: once a year, instead of the usual greeting.
  if (s.special && s.year && m.special?.[s.special] !== s.year && s.openedFor >= 1_500) return { kind: "special", id: s.special };
  const milestone = s.streak ? streakToCelebrate(s.streak.count, s.streak.unit, m.streakSeen) : null;
  if (milestone) return { kind: "streak", days: milestone };
  if (!m.greeted && s.openedFor < GREET_WINDOW) {
    return { kind: "greet", part: partOfDay(s.hour), intro: false };
  }
  const settled = s.pill?.state === "taken" || s.pill?.state === "break" || s.hour >= 18;
  if (s.hasNoteToday === false && !m.moodAsked && settled && s.openedFor >= MOOD_DELAY) return { kind: "mood" };
  if (s.hour >= NIGHT_HOUR && !m.saidGoodnight && s.openedFor >= NIGHT_DELAY) return { kind: "goodnight" };
  if (s.factsEnabled && !m.autoFact && s.openedFor >= FACT_DELAY) return { kind: "fact" };
  return null;
}

/** A fact not shown yet, preferably from another topic than the last one. */
export function pickFact(topics: readonly string[], m: Memory, random = Math.random): number {
  const all = topics.map((_, i) => i);
  const unseen = all.filter((i) => !m.seen.includes(i));
  const pool = unseen.length ? unseen : all;
  const otherTopic = pool.filter((i) => topics[i] !== m.lastTopic);
  const from = otherTopic.length ? otherTopic : pool;
  return from[Math.floor(random() * from.length)];
}

/** Records a shown fact; any fact shown today replaces the automatic one. */
export function rememberFact(m: Memory, index: number, topic: string, total: number): Memory {
  const seen = m.seen.length + 1 >= total ? [] : [...m.seen, index];
  const found = m.found?.includes(index) ? m.found : [...(m.found ?? []), index];
  return { ...m, seen, found, lastTopic: topic, autoFact: true };
}

const pickFrom = <T,>(pool: T[], random: () => number) => pool[Math.floor(random() * pool.length)];

/** A "Myth or fact?" statement (fact tag) not asked yet. */
export function pickMyth(tags: readonly string[], m: Memory, random = Math.random): string {
  const unasked = tags.filter((tag) => !m.myths?.includes(tag));
  return pickFrom(unasked.length ? unasked : [...tags], random);
}

/** Records an answer: the quiz streak grows when right and starts over when wrong. */
export function rememberAnswer(m: Memory, tag: string, right: boolean, total: number): Memory {
  const asked = [...(m.myths ?? []), tag];
  const quizStreak = right ? (m.quizStreak ?? 0) + 1 : 0;
  return {
    ...m, myths: asked.length >= total ? [] : asked, quizStreak, quizBest: Math.max(m.quizBest ?? 0, quizStreak),
    mythsFound: m.mythsFound?.includes(tag) ? m.mythsFound : [...(m.mythsFound ?? []), tag],
  };
}

/** A milestone to tell: one that happened on this date ("MM-DD") first, otherwise one not told yet. */
export function pickMilestone(items: readonly { tag: string; date?: string }[], monthDay: string, m: Memory, random = Math.random): string {
  const untold = items.filter((x) => !m.milestones?.includes(x.tag));
  const pool = untold.length ? untold : [...items];
  const onThisDay = pool.filter((x) => x.date === monthDay);
  return pickFrom(onThisDay.length ? onThisDay : pool, random).tag;
}

export function rememberMilestone(m: Memory, tag: string, total: number): Memory {
  const told = [...(m.milestones ?? []), tag];
  return {
    ...m, milestones: told.length >= total ? [] : told,
    milestonesFound: m.milestonesFound?.includes(tag) ? m.milestonesFound : [...(m.milestonesFound ?? []), tag],
  };
}

export type Idle = "stroll" | "peek" | "groom" | "wander" | "nap";

/** Something to do while nothing is being said; naps after a while without interaction. */
export function idleAction(idleMs: number, random = Math.random): Idle {
  if (idleMs >= NAP_AFTER) return "nap";
  const r = random();
  return r < 0.35 ? "stroll" : r < 0.55 ? "peek" : r < 0.75 ? "groom" : "wander";
}
