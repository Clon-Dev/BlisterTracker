// Unit tests for shared/schedule.ts. Usage: node scripts/test-schedule.ts
import {
  actionKey, actionOn, addDays, appointmentTime, withAction, diffDays, doneAt, doneOn, firstEditableDay, isTaken, lateness, lateTime, movedTo, nextAction, nextLateAt,
  nextNoticeAt, nextPackStart, nextReminderAt, noticesAt, openActionDay, packsLeft, refillTime, reminderTimes, slot, streak, trackFromPackStart, weekday,
  zonedTime, type Plan,
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

// Editing the pills that were taken before the setup: tracking began mid-pack on 2026-10-05 (pill 5 of 21).
const mid: Plan = { ...base, trackingSince: "2026-10-05", takenDays: { "2026-10-05": "20:10" } };
eq("first editable day is the start of the tracking pack", firstEditableDay(mid), "2026-10-01");
const tracked = trackFromPackStart(mid);
eq("pre-setup pills become marks without a time", [1, 2, 3, 4].map((n) => tracked.takenDays[`2026-10-0${n}`]), ["", "", "", ""]);
eq("existing mark is kept", tracked.takenDays["2026-10-05"], "20:10");
eq("tracking now starts at the pack start", tracked.trackingSince, "2026-10-01");
eq("every day keeps its state", ["2026-09-30", "2026-10-02", "2026-10-04", "2026-10-05", "2026-10-06"].map((d) => isTaken(tracked, d) === isTaken(mid, d)), [true, true, true, true, true]);
eq("idempotent", JSON.stringify(trackFromPackStart(tracked)), JSON.stringify(tracked));
eq("nothing to materialize when tracking began on a pack start", trackFromPackStart(base) === base, true);
const unmarked: Plan = { ...tracked, takenDays: Object.fromEntries(Object.entries(tracked.takenDays).filter(([d]) => d !== "2026-10-03")) };
eq("an unmarked pre-setup pill now counts as missed", isTaken(unmarked, "2026-10-03"), false);
eq("break days before tracking stay unmarked", Object.keys(trackFromPackStart({ ...base, trackingSince: "2026-10-24", packStart: "2026-10-01" }).takenDays).includes("2026-10-22"), false);

// ---------- Other methods ----------
const days = (p: Plan, from: string, n: number) => Array.from({ length: n }, (_, i) => addDays(from, i)).map((d) => actionOn(p, d) && `${d}:${actionOn(p, d)}`).filter(Boolean);
const patch: Plan = { ...base, method: "patch", packStart: "2026-10-05", trackingSince: "2026-10-05", time: "09:00" };
eq("pill: a pill every wear day", actionOn(base, "2026-10-02"), "pill");
eq("patch 21+7: apply, change, change, remove, then apply again", days(patch, "2026-10-05", 29),
  ["2026-10-05:apply", "2026-10-12:change", "2026-10-19:change", "2026-10-26:remove", "2026-11-02:apply"]);
eq("patch 42+7: 6 patches in a row, then removed", days({ ...patch, pillsPerPack: 42 }, "2026-10-05", 43).length, 7);
eq("patch 42+7: removal after the 6th patch", actionOn({ ...patch, pillsPerPack: 42 }, "2026-11-16"), "remove");
const ring: Plan = { ...patch, method: "ring" };
eq("ring 21+7: insert, remove, insert", days(ring, "2026-10-05", 29), ["2026-10-05:insert", "2026-10-26:remove", "2026-11-02:insert"]);
eq("ring 21+0: straight to the next ring", days({ ...ring, breakDays: 0 }, "2026-10-05", 43), ["2026-10-05:insert", "2026-10-26:insert", "2026-11-16:insert"]);
const shot: Plan = { ...patch, method: "injection", pillsPerPack: 84, breakDays: 0 };
eq("injection: one every 12 weeks", days(shot, "2026-10-05", 90), ["2026-10-05:inject", "2026-12-28:inject"]);
eq("injection reminder across the DST change (09:00 CET)", iso(reminderTimes({ ...shot, takenDays: { "2026-10-05": "09:00" } }, "2026-12-28")[0]), "2026-12-28T08:00:00.000Z");

// Open (carried-over) actions
eq("no reminder on a plain wear day (changes done)", reminderTimes({ ...patch, takenDays: { "2026-10-05": "09:00", "2026-10-12": "09:05" } }, "2026-10-14"), []);
eq("an undone patch change stays open the next days", [openActionDay(patch, "2026-10-13"), openActionDay(patch, "2026-10-18")], ["2026-10-12", "2026-10-12"]);
eq("…and keeps reminding", iso(reminderTimes(patch, "2026-10-13")[0]), "2026-10-13T07:00:00.000Z");
eq("the next scheduled action takes over", openActionDay(patch, "2026-10-19"), "2026-10-19");
eq("a pill doesn't carry over", openActionDay({ ...base, trackingSince: "2026-10-01" }, "2026-10-03"), "2026-10-03");
const changedLate: Plan = { ...patch, takenDays: { "2026-10-05": "09:00", "2026-10-12": "2026-10-13T08:15" } };
eq("a late change is recorded on its scheduled day", [isTaken(changedLate, "2026-10-12"), openActionDay(changedLate, "2026-10-13")], [true, null]);
eq("…with the day it was done", doneAt(changedLate, "2026-10-12"), { day: "2026-10-13", time: "08:15" });
eq("…and found by that day", doneOn(changedLate, "2026-10-13"), { scheduled: "2026-10-12", time: "08:15" });
eq("a late mid-cycle change keeps the change weekday", actionOn(changedLate, "2026-10-19"), "change");
eq("next action after the 12th", nextAction(changedLate, "2026-10-13"), { day: "2026-10-19", action: "change" });

// Lateness rules
const due = Date.parse("2026-10-12T07:00:00Z"); // 09:00 Berlin
eq("patch change 47 h late: still protected", lateness(patch, "2026-10-12", due + 47 * 3_600_000)?.rule, "patch-change-under-48h");
eq("patch change 49 h late: extra contraception", lateness(patch, "2026-10-12", due + 49 * 3_600_000)?.rule, "patch-change-over-48h");
eq("not late before the time", lateness(patch, "2026-10-12", due - 60_000), null);
const ringOut = Date.parse("2026-10-26T08:00:00Z"); // 09:00 CET
eq("ring left in 3 days longer: still fine", lateness(ring, "2026-10-26", ringOut + 3 * 86_400_000)?.rule, "ring-remove-late");
eq("ring in more than 4 weeks: not protected", lateness(ring, "2026-10-26", ringOut + 7 * 86_400_000 + 3_600_000)?.rule, "ring-over-4-weeks");
eq("new ring 2 h late: fine", lateness({ ...ring, packStart: "2026-11-02" }, "2026-11-02", Date.parse("2026-11-02T10:00:00Z")), null);
eq("new ring 4 h late: late", lateness({ ...ring, packStart: "2026-11-02" }, "2026-11-02", Date.parse("2026-11-02T12:00:00Z"))?.rule, "ring-insert-late");
const shotDue = Date.parse("2026-12-28T08:00:00Z");
eq("injection 2 weeks late = 14 weeks: still within", lateness(shot, "2026-12-28", shotDue + 14 * 86_400_000)?.rule, "injection-due");
eq("injection later than 14 weeks: not certain", lateness(shot, "2026-12-28", shotDue + 15 * 86_400_000)?.rule, "injection-over-14-weeks");

// Moving the cycle (late or early cycle start)
const ringMoved: Plan = { ...ring, earlierPackStarts: ["2026-10-05"], packStart: "2026-11-04", takenDays: { "2026-10-05": "09:00", "2026-10-26": "09:00", "2026-11-04": "10:00" } };
eq("late new ring: the scheduled day counts as done late", [isTaken(ringMoved, "2026-11-02"), movedTo(ringMoved, "2026-11-02")], [true, "2026-11-04"]);
eq("…recorded on the actual day", doneAt(ringMoved, "2026-11-02"), { day: "2026-11-04", time: "10:00" });
eq("…and the next removal counts from it", actionOn(ringMoved, "2026-11-25"), "remove");
eq("…no reminder for the moved day", reminderTimes(ringMoved, "2026-11-03"), []);
const shotEarly: Plan = { ...shot, earlierPackStarts: ["2026-10-05"], packStart: "2026-12-14", takenDays: { "2026-10-05": "09:00", "2026-12-14": "11:00" } };
eq("early injection (week 10): the old date isn't due any more", actionOn(shotEarly, "2026-12-28"), null);
eq("…the next one is 12 weeks later", nextAction(shotEarly, "2026-12-15"), { day: "2027-03-08", action: "inject" });
eq("a mid-cycle change never moves the cycle", movedTo({ ...patch, earlierPackStarts: ["2026-10-05"], packStart: "2026-10-13" }, "2026-10-12"), null);

// Recording actions (what the app writes)
const ringDue: Plan = { ...ring, takenDays: { "2026-10-05": "09:00", "2026-10-26": "09:00" } };
const inserted = withAction(ringDue, "2026-11-02", { day: "2026-11-02", time: "09:10" });
eq("on time: just the time", [inserted.takenDays["2026-11-02"], inserted.packStart], ["09:10", "2026-10-05"]);
const late = withAction(ringDue, "2026-11-02", { day: "2026-11-04", time: "10:00" });
eq("new ring 2 days late: the cycle moves there", [late.packStart, late.earlierPackStarts, late.takenDays["2026-11-04"], "2026-11-02" in late.takenDays], ["2026-11-04", ["2026-10-05"], "10:00", false]);
eq("…removal 3 weeks after the actual insert", actionOn(late, "2026-11-25"), "remove");
const undone = withAction(late, "2026-11-02", null);
eq("undoing the late insert moves the cycle back", [undone.packStart, undone.earlierPackStarts, "2026-11-04" in undone.takenDays], ["2026-10-05", [], false]);
const relate = withAction(late, "2026-11-02", { day: "2026-11-03", time: "08:00" });
eq("correcting the late day re-moves it", [relate.packStart, relate.earlierPackStarts, "2026-11-04" in relate.takenDays], ["2026-11-03", ["2026-10-05"], false]);
const midLate = withAction({ ...patch, takenDays: { "2026-10-05": "09:00" } }, "2026-10-12", { day: "2026-10-13", time: "08:15" });
eq("late mid-cycle patch change: recorded with its day, cycle unchanged", [midLate.takenDays["2026-10-12"], midLate.packStart], ["2026-10-13T08:15", "2026-10-05"]);
const earlyShot = withAction({ ...shot, takenDays: { "2026-10-05": "09:00" } }, "2026-12-28", { day: "2026-12-14", time: "11:00" });
eq("early injection: the cycle moves back to it", [earlyShot.packStart, earlyShot.earlierPackStarts, actionOn(earlyShot, "2026-12-28")], ["2026-12-14", ["2026-10-05"], null]);

// Followers' late alerts for the other methods
const patchLate: Plan = { ...patch, lateMinutes: 60, takenDays: { "2026-10-05": "09:00" } };
eq("patch: followers hear about it a day late, at the reminder time", iso(nextLateAt(patchLate, Date.parse("2026-10-12T08:00:00Z"))), "2026-10-13T07:00:00.000Z");
eq("…not on the day itself", lateTime(patchLate, "2026-10-12"), null);
eq("…not when done", lateTime({ ...patchLate, takenDays: { ...patchLate.takenDays, "2026-10-12": "09:30" } }, "2026-10-13"), null);
eq("injection: a week late", iso(lateTime({ ...shot, lateMinutes: 60, takenDays: { "2026-10-05": "09:00" } }, "2027-01-04")), "2027-01-04T08:00:00.000Z");
eq("next reminder of an injection plan is weeks ahead", iso(nextReminderAt({ ...shot, takenDays: { "2026-10-05": "09:00" } }, Date.parse("2026-10-06T00:00:00Z"))), "2026-12-28T08:00:00.000Z");
// Injection: a heads-up 7 days before (time to book the appointment), moved along by an early injection.
const shotDone: Plan = { ...shot, takenDays: { "2026-10-05": "09:00" } };
eq("injection notice 7 days before it's due", iso(nextNoticeAt(shotDone, Date.parse("2026-10-06T00:00:00Z"))), "2026-12-21T08:00:00.000Z");
eq("noticesAt names the injection notice", noticesAt(shotDone, Date.parse("2026-12-21T08:00:00Z")), ["injection"]);
eq("after the notice, the next one is a cycle later", iso(nextNoticeAt({ ...shotDone, takenDays: { ...shotDone.takenDays, "2026-12-28": "09:00" } }, Date.parse("2026-12-21T08:00:00Z"))), "2027-03-15T08:00:00.000Z");
eq("no injection notice for a patch", nextNoticeAt({ ...patch, takenDays: {} }, Date.parse("2026-10-06T00:00:00Z")), null);
eq("actionKey tells patch and ring removal apart", [actionKey(patch, "remove"), actionKey({ method: "ring" }, "remove"), actionKey(shot, "inject")], ["removePatch", "removeRing", "inject"]);
eq("pre-setup marks only on action days (patch)", Object.keys(trackFromPackStart({ ...patch, trackingSince: "2026-10-14" }).takenDays), ["2026-10-05", "2026-10-12"]);

// Streaks (Nyxi's celebrations)
const taken = (from: string, n: number, skip: string[] = []) => Object.fromEntries(Array.from({ length: n }, (_, i) => addDays(from, i)).filter((d) => !skip.includes(d)).map((d) => [d, "20:00"]));
const streakPill: Plan = { ...base, packStart: "2026-10-01", trackingSince: "2026-10-01", takenDays: taken("2026-10-01", 21) };
eq("pill streak: 21 pills, the break doesn't count or break it", streak({ ...streakPill, takenDays: { ...streakPill.takenDays, ...taken("2026-10-29", 3) } }, "2026-10-31"), 24);
eq("pill streak: today still open doesn't break it", streak({ ...streakPill, takenDays: taken("2026-10-01", 20) }, "2026-10-21"), 20);
eq("pill streak: a missed pill starts it over", streak({ ...streakPill, takenDays: taken("2026-10-01", 21, ["2026-10-10"]) }, "2026-10-21"), 11);
eq("pill streak: nothing before the setup counts", streak({ ...streakPill, trackingSince: "2026-10-15" }, "2026-10-21"), 7);
const streakPatch: Plan = { ...patch, packStart: "2026-10-05", trackingSince: "2026-10-05", takenDays: { "2026-10-05": "09:00", "2026-10-12": "09:00", "2026-10-19": "09:00" } };
eq("patch streak counts actions on their day", streak(streakPatch, "2026-10-25"), 3);
eq("patch streak: a change done a day late breaks it", streak({ ...streakPatch, takenDays: { ...streakPatch.takenDays, "2026-10-12": "2026-10-13T09:00" } }, "2026-10-25"), 1);

console.log(failures ? `\n${failures} FAILED` : "\nAll schedule tests passed.");
process.exit(failures ? 1 : 0);
