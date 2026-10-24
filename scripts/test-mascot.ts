// Unit tests for src/mascot/brain.ts. Usage: node scripts/test-mascot.ts
import {
  forDay, freshMemory, idleAction, NAP_AFTER, nextMessage, pickFact, pickMilestone, pickMyth, rememberAnswer, rememberFact, rememberMilestone, SNOOZE,
  streakToCelebrate, type Situation,
} from "../src/mascot/brain.ts";
import { nyxiAge, specialDay } from "../src/mascot/calendar.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}

const NOW = Date.UTC(2026, 9, 23, 18, 0);
const base: Situation = { now: NOW, hour: 20, openedFor: 30_000, pill: null, hasNoteToday: null, factsEnabled: false };
const settled = { ...freshMemory("2026-10-23"), greeted: true };
const kind = (s: Partial<Situation>, m = settled) => nextMessage({ ...base, ...s }, m)?.kind ?? null;

// Pill reminder
eq("reminder when overdue", nextMessage({ ...base, pill: { number: 12, state: "overdue", minutesLate: 5 } }, settled), { kind: "reminder", number: 12, late: false });
eq("reminder says 'late' after an hour", nextMessage({ ...base, pill: { number: 3, state: "overdue", minutesLate: 75 } }, settled), { kind: "reminder", number: 3, late: true });
eq("no reminder before the reminder time", kind({ pill: { number: 12, state: "due", minutesLate: 0 } }), null);
eq("no reminder once taken", kind({ pill: { number: 12, state: "taken", minutesLate: 0 } }), null);
eq("no reminder on break days", kind({ pill: { number: 2, state: "break", minutesLate: 0 } }), null);
eq("snooze hides the reminder", kind({ pill: { number: 12, state: "overdue", minutesLate: 5 } }, { ...settled, snoozeUntil: NOW + SNOOZE }), null);
eq("reminder returns after the snooze", kind({ now: NOW + SNOOZE, pill: { number: 12, state: "overdue", minutesLate: 35 } }, { ...settled, snoozeUntil: NOW + SNOOZE }), "reminder");
eq("reminder beats the greeting", kind({ openedFor: 1000, pill: { number: 12, state: "overdue", minutesLate: 5 } }, freshMemory("2026-10-23")), "reminder");
eq("a patch reminder names the action", nextMessage({ ...base, pill: { number: 0, state: "overdue", minutesLate: 30, action: "change" } }, settled), { kind: "reminder", number: 0, late: false, action: "change" });
eq("injection due in 5 days: a heads-up", nextMessage({ ...base, pill: { number: 0, state: "break", minutesLate: 0, soonDays: 5 } }, settled), { kind: "soon", days: 5 });
eq("…once a day", kind({ pill: { number: 0, state: "break", minutesLate: 0, soonDays: 5 } }, { ...settled, soonSaid: true }), null);
eq("…not two weeks ahead", kind({ pill: { number: 0, state: "break", minutesLate: 0, soonDays: 12 } }), null);
eq("hidden for today: silent", kind({ pill: { number: 12, state: "overdue", minutesLate: 5 } }, { ...settled, hidden: true }), null);

// Greeting
eq("introduces herself on the first greeting", nextMessage({ ...base, hour: 8, openedFor: 1000 }, freshMemory("2026-10-23")), { kind: "greet", part: "morning", intro: true });
eq("later greetings without introduction", nextMessage({ ...base, hour: 8, openedFor: 1000 }, { ...freshMemory("2026-10-23"), introduced: true }), { kind: "greet", part: "morning", intro: false });
eq("greeting by time of day", (nextMessage({ ...base, hour: 14, openedFor: 1000 }, freshMemory("2026-10-23")) as { part: string }).part, "day");
eq("no greeting later in the session", kind({ openedFor: 90_000 }, freshMemory("2026-10-23")), null);
eq("greets once a day", kind({ openedFor: 1000, hour: 15 }), null);
eq("first open late at night: the greeting is a good night", (nextMessage({ ...base, hour: 22, openedFor: 1000 }, freshMemory("2026-10-23")) as { part: string }).part, "night");

// Good night
eq("says good night in the evening", kind({ hour: 21 }), "goodnight");
eq("not before 21:00", kind({ hour: 20 }), null);
eq("good night once per evening", kind({ hour: 22 }, { ...settled, saidGoodnight: true }), null);
eq("the mood question comes before good night", kind({ hour: 22, hasNoteToday: false }), "mood");
eq("good night waits until the mood question had its turn", kind({ hour: 22, openedFor: 7_000, hasNoteToday: false, pill: { number: 1, state: "taken", minutesLate: 0 } }), "mood");
eq("no good night in the first seconds", kind({ hour: 22, openedFor: 8_000 }), null);
eq("good night comes before a fact", kind({ hour: 22, factsEnabled: true }), "goodnight");

// Mood question
eq("asks how you feel after the pill", kind({ hour: 10, hasNoteToday: false, pill: { number: 12, state: "taken", minutesLate: 0 } }), "mood");
eq("asks in the evening", kind({ hour: 19, hasNoteToday: false, pill: { number: 12, state: "due", minutesLate: 0 } }), "mood");
eq("not before the pill during the day", kind({ hour: 10, hasNoteToday: false, pill: { number: 12, state: "due", minutesLate: 0 } }), null);
eq("not when today has a note", kind({ hasNoteToday: true, pill: { number: 12, state: "taken", minutesLate: 0 } }), null);
eq("not without an own schedule", kind({ hasNoteToday: null }), null);
eq("once a day", kind({ hasNoteToday: false, pill: { number: 12, state: "taken", minutesLate: 0 } }, { ...settled, moodAsked: true }), null);
eq("not in the first seconds", kind({ openedFor: 2000, hasNoteToday: false, pill: { number: 12, state: "taken", minutesLate: 0 } }), null);

// Facts
eq("a fact after a while", kind({ factsEnabled: true }), "fact");
eq("no fact when turned off", kind({ factsEnabled: false }), null);
eq("no fact in the first seconds", kind({ factsEnabled: true, openedFor: 10_000 }), null);
eq("one automatic fact a day", kind({ factsEnabled: true }, { ...settled, autoFact: true }), null);
eq("mood question beats the fact", kind({ factsEnabled: true, hasNoteToday: false, pill: { number: 1, state: "taken", minutesLate: 0 } }), "mood");

const topics = ["a", "a", "b", "c"];
eq("picks an unseen fact", pickFact(topics, { ...settled, seen: [0, 1, 2] }, () => 0), 3);
eq("prefers another topic", pickFact(topics, { ...settled, lastTopic: "a" }, () => 0), 2);
eq("same topic if nothing else is left", pickFact(topics, { ...settled, seen: [2, 3], lastTopic: "a" }, () => 0.99), 1);
let m = settled;
m = rememberFact(m, 2, "b", topics.length);
eq("remembers the fact", [m.seen, m.autoFact, m.lastTopic], [[2], true, "b"]);
eq("a fact asked for replaces the automatic one (no extra fact after “Thanks”)", kind({ factsEnabled: true }, m), null);
m = rememberFact(rememberFact(rememberFact(m, 0, "a", topics.length), 1, "a", topics.length), 3, "c", topics.length);
eq("starts over once all were shown", m.seen, []);

// Offering facts on a tap

// Day change
const next = forDay({ ...m, moodAsked: true, hidden: true, snoozeUntil: 5 }, "2026-10-24");
eq("new day resets the daily fields", [next.autoFact, next.moodAsked, next.hidden, next.greeted, next.snoozeUntil, !!next.saidGoodnight], [false, false, false, false, 0, false]);
eq("new day keeps the introduction", forDay({ ...settled, introduced: true }, "2026-10-24").introduced, true);
eq("new day keeps the shown facts", forDay({ ...settled, seen: [4, 7], lastTopic: "x" }, "2026-10-24").seen, [4, 7]);
eq("same day: unchanged", forDay(m, m.day) === m, true);

// Idle
eq("naps after a while", idleAction(NAP_AFTER), "nap");
eq("strolls sometimes", idleAction(1000, () => 0.1), "stroll");
eq("wanders sometimes", idleAction(1000, () => 0.9), "wander");

// Special days (outfits + a message once a year)
const sd = (d: string) => specialDay(d)?.id ?? null;
eq("special days through the year", ["2027-01-01", "2027-02-11", "2027-02-14", "2027-03-08", "2027-03-09", "2027-03-31", "2027-04-01", "2027-05-28", "2027-09-26", "2027-12-24", "2027-12-26", "2027-12-27", "2027-12-31"].map(sd),
  ["newYear", "science", "valentine", "womensDay", "endometriosis", "endometriosis", null, "menstruation", "contraception", "christmas", "christmas", null, "newYear"]);
eq("October: pink month, with menopause day, birthday and Halloween on top", ["2027-10-01", "2027-10-17", "2027-10-18", "2027-10-23", "2027-10-30", "2027-10-31", "2027-11-01"].map(sd),
  ["breastCancer", "breastCancer", "menopause", "birthday", "breastCancer", "halloween", null]);
eq("an ordinary day has no special", sd("2027-06-15"), null);
eq("awareness days link their source", ["2027-02-11", "2027-03-08", "2027-05-28", "2027-09-26", "2027-10-05", "2027-10-18"].every((d) => specialDay(d)?.source?.url.startsWith("https://")), true);
eq("Nyxi's age on its birthday", [nyxiAge("2026-10-23"), nyxiAge("2027-10-23"), nyxiAge("2030-10-23")], [0, 1, 4]);

const intro = freshMemory("2027-03-08");
const known = { ...freshMemory("2027-03-08"), introduced: true };
eq("special day: the introduction still comes first on a new device", kind({ openedFor: 2000, special: "womensDay", year: 2027 }, intro), "greet");
eq("special day instead of the greeting", nextMessage({ ...base, openedFor: 2000, special: "womensDay", year: 2027 }, known), { kind: "special", id: "womensDay" });
eq("…once a year", kind({ openedFor: 2000, special: "womensDay", year: 2027 }, { ...known, greeted: true, special: { womensDay: 2027 } }), null);
eq("…again next year", kind({ openedFor: 2000, special: "womensDay", year: 2028 }, { ...known, greeted: true, special: { womensDay: 2027 } }), "special");
eq("a reminder beats the special day", kind({ openedFor: 2000, special: "womensDay", year: 2027, pill: { number: 4, state: "overdue", minutesLate: 5 } }, known), "reminder");

// Streaks
eq("no celebration below the first milestone", streakToCelebrate(6, "pill"), null);
eq("7 pills in a row", streakToCelebrate(7, "pill"), 7);
eq("…celebrated once", streakToCelebrate(9, "pill", 7), null);
eq("next milestone 14", streakToCelebrate(14, "pill", 7), 14);
eq("after a gap the streak starts over", streakToCelebrate(7, "pill", 30), 7);
eq("patch/ring/injection count actions", [streakToCelebrate(3, "action"), streakToCelebrate(12, "action", 6)], [3, 12]);
eq("streak celebration comes after a special day", kind({ openedFor: 2000, special: "womensDay", year: 2027, streak: { count: 7, unit: "pill" } }, known), "special");
eq("streak celebration before the greeting", nextMessage({ ...base, openedFor: 2000, streak: { count: 30, unit: "pill" } }, { ...known, streakSeen: 14 }), { kind: "streak", days: 30 });

// Myth or fact? / herstory picks
const tags = ["a", "b", "c"];
eq("quiz: an unasked statement", pickMyth(tags, { ...settled, myths: ["a", "b"] }, () => 0), "c");
const answered = rememberAnswer(rememberAnswer({ ...settled }, "a", true, 3), "b", true, 3);
eq("quiz streak counts right answers", [answered.quizStreak, answered.quizBest, answered.myths], [2, 2, ["a", "b"]]);
const wrong = rememberAnswer(answered, "c", false, 3);
eq("a wrong answer ends the streak, the best stays, all asked starts over", [wrong.quizStreak, wrong.quizBest, wrong.myths, wrong.mythsFound], [0, 2, [], ["a", "b", "c"]]);
const items = [{ tag: "x", date: "03-19" }, { tag: "y" }, { tag: "z", date: "06-01" }];
eq("herstory: a milestone from this date first", pickMilestone(items, "06-01", settled, () => 0), "z");
eq("herstory: otherwise one not told yet", pickMilestone(items, "01-01", { ...settled, milestones: ["x"] }, () => 0), "y");
eq("herstory: told on this date already → another", pickMilestone(items, "06-01", { ...settled, milestones: ["z"] }, () => 0), "x");
eq("herstory: found list for the fact book", rememberMilestone(settled, "y", 3).milestonesFound, ["y"]);
eq("facts are collected for the fact book", rememberFact(rememberFact(settled, 4, "pill", 10), 2, "cycle", 10).found, [4, 2]);

// Kept across days
const collected = { ...settled, tapped: true, found: [1], myths: ["a"], quizBest: 3, special: { womensDay: 2027 }, outfits: ["everyday"], streakSeen: 7, crownDay: "2026-10-23", autoFact: true };
const nextDay = forDay(collected, "2026-10-24");
eq("a new day keeps what was collected", [nextDay.tapped, nextDay.found, nextDay.myths, nextDay.quizBest, nextDay.special, nextDay.outfits, nextDay.streakSeen], [true, [1], ["a"], 3, { womensDay: 2027 }, ["everyday"], 7]);
eq("…and resets the daily fields", [nextDay.autoFact, nextDay.greeted], [false, false]);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exitCode = failures ? 1 : 0;
