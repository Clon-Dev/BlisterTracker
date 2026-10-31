// Unit tests for src/mascot/brain.ts. Usage: node scripts/test-mascot.ts
import {
  forDay, freshMemory, idleAction, NAP_AFTER, nextMessage, pickFact, pickMilestone, pickMyth, rememberAnswer, rememberFact, rememberMilestone, SNOOZE,
  streakToCelebrate, type Situation,
} from "../src/mascot/brain.ts";
import { easterSunday, layersOn, lookOn, nyxiAge, specialsOn } from "../src/mascot/calendar.ts";
import { ACCESSORIES, EVERYDAY, PRINTS, PYJAMAS } from "../src/mascot/looks.ts";

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
const ids = (d: string) => specialsOn(d).map((x) => x.id);
const layers = (d: string) => { const l = layersOn(d); return [l.awareness, l.fun, l.accessories]; };
const look = (d: string, hour = 12, crown = false) => lookOn(d, hour, crown).outfit;
eq("special days through the year", ["2027-01-01", "2027-02-11", "2027-02-14", "2027-03-08", "2027-03-09", "2027-04-01", "2027-05-28", "2027-09-26", "2027-12-24", "2027-12-27", "2027-12-31"].map((d) => ids(d)[0] ?? null),
  ["newYear", "science", "valentine", "womensDay", "endometriosis", null, "menstruation", "contraception", "christmas", null, "newYear"]);
eq("new health days", ["2027-02-04", "2027-03-04", "2027-04-07", "2027-09-04", "2027-10-10", "2027-12-01"].map((d) => ids(d)[0]),
  ["worldCancer", "hpvDay", "worldHealth", "sexualHealth", "mentalHealth", "worldAids"]);
eq("new seasonal days", ["2027-03-20", "2027-07-15", "2027-08-08", "2027-09-22", "2027-12-10", "2027-12-06"].map((d) => layersOn(d).accessories),
  ["spring", "summer", "catDay", "autumn", "advent", "nikolaus"]);
eq("an ordinary day has no special and the everyday look", [ids("2027-06-15"), look("2027-06-15")], [[], EVERYDAY]);
eq("health days link their source", ["2027-02-04", "2027-02-11", "2027-03-04", "2027-03-08", "2027-04-07", "2027-05-28", "2027-09-04", "2027-09-26", "2027-10-05", "2027-10-10", "2027-10-18", "2027-12-01"]
  .every((d) => specialsOn(d)[0]?.source?.url.startsWith("https://")), true);
eq("Easter Sunday (known dates)", [2024, 2025, 2026, 2027, 2028, 2038, 2049].map(easterSunday), ["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16", "2038-04-25", "2049-04-18"]);
eq("Easter: Sunday and Monday only", ["2026-04-04", "2026-04-05", "2026-04-06", "2026-04-07"].map((d) => ids(d).includes("easter")), [false, true, true, false]);
eq("carnival: Weiberfastnacht to Rosenmontag (2026: 12–16 Feb)", ["2026-02-10", "2026-02-12", "2026-02-16", "2026-02-17"].map((d) => layersOn(d).accessories), [null, "carnival", "carnival", null]);
eq("a day's print and accessories combine (Easter: egg + bunny ears)", look("2026-04-05"), { ...PRINTS.easter, ...ACCESSORIES.easter });

// The approved collisions
eq("C1: Mental Health Day's green ribbon replaces Pink October's (the bow stays)", look("2027-10-10"), { ...PRINTS.mentalHealth, ...ACCESSORIES.breastCancer });
eq("C2: World Menopause Day's orange ribbon replaces Pink October's, no scarf", [look("2027-10-18").motifColor, look("2027-10-18").scarf], [PRINTS.menopause.motifColor, undefined]);
eq("C3: Easter in March: the endometriosis ribbon instead of the egg, bunny ears stay", look("2027-03-28"), { ...PRINTS.endometriosis, ...ACCESSORIES.easter });
eq("C4: Easter on World Health Day (2042): stethoscope, bunny ears stay", look("2042-04-07"), { ...PRINTS.worldHealth, ...ACCESSORIES.easter });
eq("C5: Halloween in Pink October: orange sweater, pink ribbon, witch hat, wings, fangs",
  look("2027-10-31"), { ...PRINTS.breastCancer, sweater: PRINTS.halloween.sweater, seam: PRINTS.halloween.seam, ...ACCESSORIES.halloween });
eq("C6: carnival with World Cancer Day (2027), HPV Day (2030), Women's Day (2038), Valentine's (2037): print + mask",
  [look("2027-02-04"), look("2030-03-04"), look("2038-03-08"), look("2037-02-14")],
  [{ ...PRINTS.worldCancer, ...ACCESSORIES.carnival }, { ...PRINTS.hpvDay, ...ACCESSORIES.carnival }, { ...PRINTS.womensDay, ...ACCESSORIES.carnival }, { ...PRINTS.valentine, ...ACCESSORIES.carnival }]);
eq("C7: birthday in Pink October: pink ribbon + party hat, no bow", look("2027-10-23"), { ...PRINTS.breastCancer, ...ACCESSORIES.birthday });
eq("C8: World AIDS Day in Advent: red ribbon + earmuffs and scarf", look("2027-12-01"), { ...PRINTS.worldAids, ...ACCESSORIES.advent });
eq("C9: start of spring in endometriosis month: ribbon + flower crown", look("2027-03-20"), { ...PRINTS.endometriosis, ...ACCESSORIES.spring });
eq("C10: carnival on Women in Science day (2029): the mask wins, the atom print stays", look("2029-02-11"), { ...PRINTS.science, ...ACCESSORIES.carnival });
eq("C11: no Pink October bow on the birthday or Halloween", [look("2027-10-23").bow, look("2027-10-31").bow, look("2027-10-05").bow], [undefined, undefined, ACCESSORIES.breastCancer.bow]);
eq("C12: Cat Day crown instead of the summer sunglasses and hat", look("2027-08-08"), { ...EVERYDAY, ...ACCESSORIES.catDay });
eq("C13: the Nikolaus look instead of Advent's on 6 Dec", look("2027-12-06"), { ...EVERYDAY, ...ACCESSORIES.nikolaus });
eq("C14: the streak crown only on days without special accessories", [look("2027-06-15", 12, true).crown, look("2027-10-31", 12, true).crown, look("2027-10-31", 12, true).hat],
  [true, undefined, "witch"]);
eq("C15: pyjamas from 22:00 on a plain day", [look("2027-06-15", 21), look("2027-06-15", 22)], [EVERYDAY, { ...PYJAMAS, hat: "sleep" }]);
eq("C15: …on a print-only day, with the day's print on the pyjamas (Pink October: the cap replaces the bow)", look("2027-10-05", 23),
  { ...PYJAMAS, motif: "ribbon", motifColor: PRINTS.breastCancer.motifColor, hat: "sleep" });
eq("C15: …not on days with special accessories, nor with the streak crown", [look("2027-12-24", 23).hat, look("2027-10-31", 23).hat, look("2027-06-15", 23, true).crown], ["santa", "witch", true]);
eq("no accessory set mixes with another", ["2027-02-04", "2029-02-11", "2027-08-08", "2027-10-23", "2027-10-31", "2027-12-01", "2027-12-06"]
  .every((d) => { const o = look(d); return [o.hat, o.mask, o.crown, o.bunnyEars, o.earmuffs, o.flowerCrown, o.bow].filter(Boolean).length <= 1 || (o.hat === "santa" && o.boot) || (o.mask && o.confetti); }), true);
eq("several specials on a day: health days are mentioned first", [ids("2027-10-10"), ids("2027-10-31"), ids("2027-12-01")],
  [["mentalHealth", "breastCancer"], ["breastCancer", "halloween"], ["worldAids", "advent"]]);
eq("layers on Halloween", layers("2027-10-31"), ["breastCancer", "halloween", "halloween"]);
eq("Nyxi's age on its birthday", [nyxiAge("2026-10-23"), nyxiAge("2027-10-23"), nyxiAge("2030-10-23")], [0, 1, 4]);

const intro = freshMemory("2027-03-08");
const known = { ...freshMemory("2027-03-08"), introduced: true };
eq("special day: the introduction still comes first on a new device", kind({ openedFor: 2000, specials: ["womensDay"], year: 2027 }, intro), "greet");
eq("special day instead of the greeting", nextMessage({ ...base, openedFor: 2000, specials: ["womensDay"], year: 2027 }, known), { kind: "special", id: "womensDay" });
eq("…once a year", kind({ openedFor: 2000, specials: ["womensDay"], year: 2027 }, { ...known, greeted: true, special: { womensDay: 2027 } }), null);
eq("two specials on one day: the second follows once the first was said", nextMessage({ ...base, openedFor: 2000, specials: ["mentalHealth", "breastCancer"], year: 2027 }, { ...known, greeted: true, special: { mentalHealth: 2027 } }), { kind: "special", id: "breastCancer" });
eq("…again next year", kind({ openedFor: 2000, specials: ["womensDay"], year: 2028 }, { ...known, greeted: true, special: { womensDay: 2027 } }), "special");
eq("a reminder beats the special day", kind({ openedFor: 2000, specials: ["womensDay"], year: 2027, pill: { number: 4, state: "overdue", minutesLate: 5 } }, known), "reminder");

// Streaks
eq("no celebration below the first milestone", streakToCelebrate(6, "pill"), null);
eq("7 pills in a row", streakToCelebrate(7, "pill"), 7);
eq("…celebrated once", streakToCelebrate(9, "pill", 7), null);
eq("next milestone 14", streakToCelebrate(14, "pill", 7), 14);
eq("after a gap the streak starts over", streakToCelebrate(7, "pill", 30), 7);
eq("patch/ring/injection count actions", [streakToCelebrate(3, "action"), streakToCelebrate(12, "action", 6)], [3, 12]);
eq("streak celebration comes after a special day", kind({ openedFor: 2000, specials: ["womensDay"], year: 2027, streak: { count: 7, unit: "pill" } }, known), "special");
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
