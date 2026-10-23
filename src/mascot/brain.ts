// What the kitten says and does next. Pure logic without React, so it can be unit-tested (scripts/test-mascot.ts).

/** After a declined fact, every this many taps Nyxi offers one again. */
export const OFFER_EVERY = 3;
const GREET_WINDOW = 60_000; // greet only right after opening
const MOOD_DELAY = 6_000;
const FACT_DELAY = 20_000;
export const NAP_AFTER = 120_000;
export const SNOOZE = 30 * 60_000;

/** Today's pill of the own schedule. `minutesLate` counts from the reminder time. */
export type PillState = { number: number; state: "due" | "overdue" | "taken" | "break"; minutesLate: number } | null;

/** Remembered per device (AsyncStorage). The daily fields reset when the day changes. */
export type Memory = {
  day: string;
  /** A fact was shown today (asked for or not), so no automatic one. */
  autoFact: boolean;
  moodAsked: boolean;
  greeted: boolean;
  hidden: boolean;
  snoozeUntil: number;
  /** Facts already shown; cleared once all were shown. */
  seen: number[];
  lastTopic?: string;
  /** Nyxi has introduced itself (once per device). */
  introduced?: boolean;
};

export const freshMemory = (day: string): Memory =>
  ({ day, autoFact: false, moodAsked: false, greeted: false, hidden: false, snoozeUntil: 0, seen: [] });

/** The memory for `day`: daily fields start over on a new day; shown facts and the introduction are kept. */
export const forDay = (m: Memory, day: string): Memory =>
  m.day === day ? m : { ...freshMemory(day), seen: m.seen, lastTopic: m.lastTopic, introduced: m.introduced };

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
};

export type Say =
  | { kind: "reminder"; number: number; late: boolean }
  | { kind: "greet"; part: "morning" | "day" | "evening"; intro: boolean }
  | { kind: "mood" }
  | { kind: "fact" };

/** The message that is due now, by priority: reminder, greeting, mood question, fact. */
export function nextMessage(s: Situation, m: Memory): Say | null {
  if (m.hidden) return null;
  if (s.pill?.state === "overdue" && s.now >= m.snoozeUntil) return { kind: "reminder", number: s.pill.number, late: s.pill.minutesLate >= 60 };
  if (!m.greeted && s.openedFor < GREET_WINDOW) return { kind: "greet", part: s.hour < 11 ? "morning" : s.hour < 18 ? "day" : "evening", intro: !m.introduced };
  const settled = s.pill?.state === "taken" || s.pill?.state === "break" || s.hour >= 18;
  if (s.hasNoteToday === false && !m.moodAsked && settled && s.openedFor >= MOOD_DELAY) return { kind: "mood" };
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
  return { ...m, seen, lastTopic: topic, autoFact: true };
}

/**
 * Whether a tap should offer a fact. `tapsSinceDecline`: null until a fact was declined this session, then the taps
 * counted since (including this one); Nyxi asks again on every OFFER_EVERY-th tap.
 */
export const offersFact = (tapsSinceDecline: number | null) => tapsSinceDecline === null || tapsSinceDecline >= OFFER_EVERY;

export type Idle = "stroll" | "peek" | "groom" | "wander" | "nap";

/** Something to do while nothing is being said; naps after a while without interaction. */
export function idleAction(idleMs: number, random = Math.random): Idle {
  if (idleMs >= NAP_AFTER) return "nap";
  const r = random();
  return r < 0.35 ? "stroll" : r < 0.55 ? "peek" : r < 0.75 ? "groom" : "wander";
}
