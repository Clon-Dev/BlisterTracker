// What a patch / ring / injection schedule looks like today: the open action, what's done, what's next, and the
// numbers for the hero ring. Shared by the owner's hero, the followers' badge and Nyxi.
import {
  actionKey, actionOn, addDays, cycleLength, diffDays, doneAt, doneOn, lateness, methodOf, nextAction, openActionDay, slot, startsCycle, zonedTime,
  type ActionKey, type LateRule, type Plan,
} from "../../shared/schedule";
import { formatDay, type Lang, type Strings } from "../i18n";

export { actionKey, type ActionKey };

export type MethodStatus = {
  /** Due today or carried over: its scheduled day, what, how late, and the rule that applies. */
  open: { day: string; key: ActionKey; overdue: boolean; daysLate: number; rule: LateRule | null } | null;
  /** Done today (any scheduled day). */
  doneToday: { day: string; key: ActionKey; time: string } | null;
  next: { day: string; key: ActionKey } | null;
  progress: number;
  center: string;
  centerSub: string;
  /** Where in the cycle (e.g. "Patch 2 · day 3 of 7"). */
  position: string;
  headline: string;
  sub: string;
};

/** Days until `day`, as "3 weeks 2 days". */
export const untilText = (t: Strings, today: string, day: string) => {
  const n = Math.max(0, diffDays(today, day));
  return t.duration({ w: Math.floor(n / 7), d: n % 7 });
};

export function methodStatus(p: Plan, today: string, now: number, t: Strings, lang: Lang): MethodStatus {
  const method = methodOf(p);
  const { index } = slot(p, today);
  const wear = p.pillsPerPack;
  const cycle = cycleLength(p);

  const openDay = openActionDay(p, today);
  const open = openDay ? (() => {
    const key = actionKey(p, actionOn(p, openDay)!);
    const late = lateness(p, openDay, now);
    return { day: openDay, key, overdue: now > zonedTime(openDay, p.time, p.tz), daysLate: diffDays(openDay, today), rule: late?.rule ?? null };
  })() : null;
  const doneRecord = doneOn(p, today);
  const doneToday = doneRecord && actionOn(p, doneRecord.scheduled)
    ? { day: doneRecord.scheduled, key: actionKey(p, actionOn(p, doneRecord.scheduled)!), time: doneRecord.time } : null;
  const nextRaw = nextAction(p, open ? today : addDays(today, 1));
  const next = nextRaw && nextRaw.day !== open?.day ? { day: nextRaw.day, key: actionKey(p, nextRaw.action) } : null;
  // A cycle start that's overdue hasn't started the new cycle: the days count on from the old one.
  const idx = open && open.daysLate > 0 && startsCycle(actionOn(p, open.day)) ? cycle + open.daysLate : index;

  let progress: number, center: string, centerSub: string, position: string;
  if (method === "patch") {
    const inWear = idx < wear;
    const d = inWear ? (idx % 7) + 1 : idx - wear + 1;
    progress = Math.min(1, d / 7);
    center = inWear ? String(Math.floor(idx / 7) + 1) : "–";
    centerSub = `/ ${wear / 7}`;
    position = inWear ? t.patchWearing({ n: Math.floor(idx / 7) + 1, d }) : t.patchFree({ d });
  } else if (method === "ring") {
    // Without a break, an overdue new ring means the old one is still in.
    const inWear = idx < wear || p.breakDays === 0;
    const d = inWear ? idx + 1 : idx - wear + 1;
    progress = Math.min(1, inWear ? d / wear : d / Math.max(1, p.breakDays));
    center = String(d);
    centerSub = `/ ${inWear ? wear : p.breakDays}`;
    position = inWear ? t.ringIn({ d, total: wear }) : t.ringFree({ d });
  } else {
    const week = Math.floor(idx / 7) + 1;
    progress = Math.min(1, idx / cycle);
    center = String(week);
    centerSub = `/ ${cycle / 7}`;
    position = idx < cycle ? t.injectionWeek({ w: week, total: cycle / 7 }) : t.injectionSince({ w: week });
  }

  let headline: string, sub: string;
  if (open) {
    headline = open.daysLate > 0 ? t.actionLate({ what: t.actionName[open.key] }) : t.actionTodo[open.key];
    sub = open.daysLate > 0 ? t.daysLate({ n: open.daysLate }) : open.overdue ? t.heroOverdue({ time: p.time }) : t.heroDue({ time: p.time });
  } else if (doneToday) {
    headline = t.doneAt({ what: t.actionPast[doneToday.key], time: doneToday.time });
    sub = next ? nextLine(t, lang, today, next) : position;
  } else {
    headline = position;
    sub = next ? nextLine(t, lang, today, next) : "";
  }
  return { open, doneToday, next, progress, center, centerSub, position, headline, sub };
}

function nextLine(t: Strings, lang: Lang, today: string, next: { day: string; key: ActionKey }) {
  return next.key === "inject"
    ? t.nextInjectionIn({ when: untilText(t, today, next.day) })
    : t.nextOn({ what: t.actionNext[next.key], day: formatDay(next.day, lang) });
}

/** "Patch changed · 09:12 · 1 day late" style line for a recorded action. */
export function doneLine(p: Plan, scheduled: string, t: Strings) {
  const done = doneAt(p, scheduled);
  const a = actionOn(p, scheduled);
  if (!done || !a) return null;
  const late = diffDays(scheduled, done.day);
  const base = t.doneAt({ what: t.actionPast[actionKey(p, a)], time: done.time });
  return late > 0 ? `${base} · ${t.daysLate({ n: late })}` : base;
}
