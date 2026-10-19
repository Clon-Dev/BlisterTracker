// Unit tests for shared/schedule.ts. Usage: node scripts/test-schedule.ts
import {
  addDays, appointmentTime, diffDays, isTaken, lateTime, nextLateAt, nextNoticeAt, nextPackStart, nextReminderAt, noticesAt,
  packsLeft, refillTime, reminderTimes, slot, weekday, zonedTime, type Plan,
} from "../shared/schedule.ts";

let failures = 0;
function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
}
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const at = (s: string) => Date.parse(s);

const base: Plan = {
  pillsPerPack: 21, placebo: 0, breakDays: 7, packStart: "2026-10-01", trackingSince: "2026-10-01",
  time: "20:00", tz: "Europe/Berlin", repeatMinutes: 0, lateMinutes: 0, takenDays: {},
};

// Calendar helpers
eq("addDays across month", addDays("2026-10-30", 3), "2026-11-02");
eq("diffDays across year", diffDays("2026-12-30", "2027-01-02"), 3);
eq("weekday of 2026-10-19 is Monday", weekday("2026-10-19"), 0);

// Pack position (21 + 7)
eq("day 1 is pill 0", slot(base, "2026-10-01"), { index: 0, kind: "active", packStart: "2026-10-01" });
eq("day 22 is break", slot(base, "2026-10-22").kind, "break");
eq("day 29 starts next pack", slot(base, "2026-10-29"), { index: 0, kind: "active", packStart: "2026-10-29" });
eq("day before packStart wraps into break", slot(base, "2026-09-30").kind, "break");
eq("24+4 placebo: index 24 is placebo", slot({ ...base, pillsPerPack: 28, placebo: 4, breakDays: 0 }, "2026-10-25").kind, "placebo");
eq("28 continuous never breaks", slot({ ...base, pillsPerPack: 28, breakDays: 0 }, "2026-10-29").kind, "active");

// Taken
eq("before trackingSince counts as taken", isTaken(base, "2026-09-25"), true);
eq("marked day is taken", isTaken({ ...base, takenDays: { "2026-10-05": "20:03" } }, "2026-10-05"), true);

// Reminder times (DST: Europe/Berlin switches on 2026-10-25)
eq("20:00 CEST", iso(zonedTime("2026-10-19", "20:00", "Europe/Berlin")), "2026-10-19T18:00:00.000Z");
eq("20:00 CET after DST end", iso(zonedTime("2026-10-26", "20:00", "Europe/Berlin")), "2026-10-26T19:00:00.000Z");
eq("no reminder on a break day", reminderTimes(base, "2026-10-23"), []);
eq("no reminder when taken", reminderTimes({ ...base, takenDays: { "2026-10-19": "19:00" } }, "2026-10-19"), []);
eq("repeats every 30 min until midnight (max 8)",
  reminderTimes({ ...base, time: "22:00", repeatMinutes: 30 }, "2026-10-19").map(iso),
  ["2026-10-19T20:00:00.000Z", "2026-10-19T20:30:00.000Z", "2026-10-19T21:00:00.000Z", "2026-10-19T21:30:00.000Z"]);

// Next reminder
eq("next reminder later today", iso(nextReminderAt(base, at("2026-10-19T10:00:00Z"))), "2026-10-19T18:00:00.000Z");
eq("taken today → tomorrow", iso(nextReminderAt({ ...base, takenDays: { "2026-10-19": "08:00" } }, at("2026-10-19T10:00:00Z"))), "2026-10-20T18:00:00.000Z");
eq("last pill day → skips the break to the next pack",
  iso(nextReminderAt({ ...base, takenDays: { "2026-10-21": "20:00" } }, at("2026-10-21T19:00:00Z"))), "2026-10-29T19:00:00.000Z");
eq("repeat is next after the first reminder", iso(nextReminderAt({ ...base, repeatMinutes: 15 }, at("2026-10-19T18:00:00Z"))), "2026-10-19T18:15:00.000Z");

// Late alert for followers
eq("late alert off", lateTime(base, "2026-10-19"), null);
eq("late alert 1 h after", iso(lateTime({ ...base, lateMinutes: 60 }, "2026-10-19")), "2026-10-19T19:00:00.000Z");
eq("late alert past midnight is found from the next day",
  iso(nextLateAt({ ...base, time: "23:30", lateMinutes: 120 }, at("2026-10-19T22:00:00Z"))), "2026-10-19T23:30:00.000Z");
eq("no late alert when taken", iso(nextLateAt({ ...base, lateMinutes: 60, takenDays: { "2026-10-19": "20:00" } }, at("2026-10-19T18:30:00Z"))), "2026-10-20T19:00:00.000Z");

// Early pack start (delay a period): pill 15 day → new pack starts 2026-10-16 instead of 2026-10-29.
const early: Plan = { ...base, packStart: "2026-10-16", earlierPackStarts: ["2026-10-01"] };
eq("early start: day before keeps old position", slot(early, "2026-10-15").index, 14);
eq("early start: new pack from the new anchor", slot(early, "2026-10-16"), { index: 0, kind: "active", packStart: "2026-10-16" });
eq("early start: old pack before the first anchor unaffected", slot(early, "2026-09-30").kind, "break");
eq("nextPackStart regular", nextPackStart(base, "2026-10-05"), "2026-10-29");
eq("nextPackStart cut short by early start", nextPackStart(early, "2026-10-05"), "2026-10-16");

// Supply: 3 packs counted when the 2026-10-01 pack started.
const supply: Plan = { ...base, supplyPacks: 3, supplyFrom: "2026-10-01" };
eq("supply: current pack is 3 of 3 left", packsLeft(supply, "2026-10-10"), 3);
eq("supply: next pack → 2 left", packsLeft(supply, "2026-10-29"), 2);
eq("supply: third pack → last (1)", packsLeft(supply, "2026-11-26"), 1);
eq("supply untracked", packsLeft(base, "2026-10-10"), null);
eq("refill reminder when the last pack starts", iso(refillTime(supply)), "2026-11-26T19:00:00.000Z");
eq("early start counts as a pack", packsLeft({ ...early, supplyPacks: 3, supplyFrom: "2026-10-01" }, "2026-10-16"), 2);

// Appointment: day before at the reminder time.
const appt: Plan = { ...supply, appointmentDay: "2026-11-03" };
eq("appointment reminder the day before", iso(appointmentTime(appt)), "2026-11-02T19:00:00.000Z");
eq("next notice is the earlier of both", iso(nextNoticeAt(appt, at("2026-10-19T10:00:00Z"))), "2026-11-02T19:00:00.000Z");
eq("after the appointment notice comes the refill", iso(nextNoticeAt(appt, at("2026-11-02T19:00:00Z"))), "2026-11-26T19:00:00.000Z");
eq("noticesAt identifies the kind", noticesAt(appt, at("2026-11-02T19:00:00Z")), ["appointment"]);
eq("no notices without supply/appointment", nextNoticeAt(base, at("2026-10-19T10:00:00Z")), null);

console.log(failures ? `\n${failures} FAILED` : "\nAll schedule tests passed.");
process.exit(failures ? 1 : 0);
