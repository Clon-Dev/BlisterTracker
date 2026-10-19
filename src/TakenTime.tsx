// Choosing when a pill was taken: "just now" or an earlier time, never in the future.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Check, ChevronDown, ChevronUp, Clock3, History, Pill, Undo2 } from "lucide-react-native";
import { clock, dayKey, type Plan } from "../shared/schedule";
import { formatDay, useI18n, type Lang } from "./i18n";
import { openSheet, SheetIcon } from "./sheets";
import { C, F, R, shadow, themedStyles } from "./theme";
import { Badge, Button, IconButton, s } from "./ui";

const toMin = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
const toTime = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** Current time in the schedule's zone, and today's day there. */
export const nowIn = (tz: string) => ({ time: clock(Date.now(), tz), day: dayKey(Date.now(), tz) });

/** Hour and minute columns with up/down buttons; minutes move in 5-minute steps. Never exceeds `max`. */
export function TimeDial({ value, onChange, max }: { value: string; onChange: (v: string) => void; max?: string }) {
  const { t } = useI18n();
  const v = toMin(value);
  const limit = max ? toMin(max) : 24 * 60 - 1;
  const set = (min: number) => onChange(toTime(Math.min(limit, Math.max(0, min))));
  const hour = Math.floor(v / 60);
  const minute = v % 60;
  const column = (label: string, digits: number, up: () => void, down: () => void, upDisabled: boolean) => (
    <View style={{ alignItems: "center", gap: 6 }}>
      <View style={{ opacity: upDisabled ? 0.3 : 1 }}>
        <IconButton icon={ChevronUp} label={`${label} +`} onPress={up} size={40} />
      </View>
      <View style={st.digitBox}><Text style={st.digits}>{String(digits).padStart(2, "0")}</Text></View>
      <IconButton icon={ChevronDown} label={`${label} −`} onPress={down} size={40} />
    </View>
  );
  return (
    <View style={st.dial} accessibilityLabel={`${t.reminderTime} ${value}`}>
      {column("h", hour, () => set(v + 60 > limit ? v : (hour + 1) % 24 * 60 + minute), () => set(((hour + 23) % 24) * 60 + minute), v + 60 > limit)}
      <Text style={[st.digits, { marginHorizontal: 4, color: C.muted }]}>:</Text>
      {column("min", minute, () => set(hour * 60 + (Math.floor(minute / 5) * 5 + 5) % 60), () => set(hour * 60 + (Math.ceil(minute / 5) * 5 - 5 + 60) % 60), v + 5 > limit)}
    </View>
  );
}

/** Dial plus quick choices for an earlier intake time on `day`. `""` means "time unknown" (past days only). */
export function EarlierPicker({ plan, day, value, onChange }: { plan: Plan; day: string; value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const now = nowIn(plan.tz);
  const isToday = day === now.day;
  const max = isToday ? now.time : undefined;
  const nowMin = toMin(now.time);
  const quick: { label: string; value: string }[] = [];
  if (!isToday || toMin(plan.time) <= nowMin) quick.push({ label: t.atReminder({ time: plan.time }), value: plan.time });
  if (isToday) for (const ago of [30, 60, 120]) if (nowMin - ago >= 0) quick.push({ label: ago < 60 ? t.minutesAgo({ n: ago }) : t.hoursAgo({ n: ago / 60 }), value: toTime(nowMin - ago) });
  if (!isToday) quick.push({ label: t.timeUnknown, value: "" });
  return (
    <View>
      {value !== "" && <TimeDial value={value} onChange={onChange} max={max} />}
      <View style={st.quickRow}>
        {quick.map((q) => {
          const active = q.value === value;
          return (
            <Pressable key={q.label} onPress={() => onChange(q.value)} accessibilityRole="button" accessibilityLabel={q.label}
              style={[st.quick, active && st.quickActive]}>
              <Text style={[s.small, F.bold, { color: active ? C.white : C.primaryDeep }]}>{q.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Default for "earlier": the reminder time if it has passed, else now rounded down to 5 minutes. */
export function defaultEarlier(plan: Plan, day: string) {
  const now = nowIn(plan.tz);
  if (day !== now.day || toMin(plan.time) <= toMin(now.time)) return plan.time;
  return toTime(Math.floor(toMin(now.time) / 5) * 5);
}

export type DayAction = { time: string } | { untake: true };

/**
 * Sheet for one pill day: mark it (now / earlier), change its time, or unmark it.
 * Resolves with the chosen action, or undefined when dismissed.
 */
export function openDaySheet(plan: Plan, day: string, lang: Lang) {
  return openSheet<DayAction>((done) => <DaySheet plan={plan} day={day} lang={lang} done={done} />);
}

function DaySheet({ plan, day, lang, done }: { plan: Plan; day: string; lang: Lang; done: (a?: DayAction) => void }) {
  const { t } = useI18n();
  const now = nowIn(plan.tz);
  const isToday = day === now.day;
  const taken = day in plan.takenDays;
  const [mode, setMode] = useState<"status" | "pick">(taken ? "status" : isToday ? "status" : "pick");
  const [time, setTime] = useState(taken && plan.takenDays[day] ? plan.takenDays[day] : defaultEarlier(plan, day));
  const future = isToday && time !== "" && toMin(time) > toMin(now.time);
  const title = isToday ? t.todaysPill : formatDay(day, lang);

  return (
    <View>
      <SheetIcon icon={Pill} tone={taken ? "success" : "primary"} />
      <Text style={s.h1}>{title}</Text>
      {taken && mode === "status" && <>
        <View style={{ marginTop: 10 }}>
          <Badge tone="success" icon={Check} label={plan.takenDays[day] ? t.takenAtShort({ time: plan.takenDays[day] }) : t.takenUnknown} />
        </View>
        <Button title={t.changeTime} kind="secondary" icon={Clock3} onPress={() => setMode("pick")} style={{ marginTop: 22 }} />
        <Button title={t.markDayNotTaken} kind="ghost" icon={Undo2} onPress={() => done({ untake: true })} style={{ marginTop: 4 }} />
      </>}
      {!taken && mode === "status" && <>
        <Text style={[s.muted, { marginTop: 6 }]}>{t.whenTaken}</Text>
        <Button title={t.takenNow({ time: now.time })} icon={Check} onPress={() => done({ time: now.time })} style={{ marginTop: 20 }} />
        <Button title={t.takenEarlier} kind="secondary" icon={History} onPress={() => setMode("pick")} style={{ marginTop: 10 }} />
      </>}
      {mode === "pick" && <>
        <Text style={[s.muted, { marginTop: 6 }]}>{t.whenTaken}</Text>
        <EarlierPicker plan={plan} day={day} value={time} onChange={setTime} />
        {future && <Text style={[s.small, { color: C.danger, textAlign: "center", marginTop: 10 }]}>{t.futureNotAllowed}</Text>}
        <Button title={time ? t.saveTime({ time }) : t.saveTimeUnknown} icon={Check} disabled={future} onPress={() => done({ time })} style={{ marginTop: 18 }} />
      </>}
    </View>
  );
}

const st = themedStyles(() => ({
  dial: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 18 },
  digitBox: { ...shadow(1), backgroundColor: C.primaryTint, borderRadius: R.md, borderWidth: 1.5, borderColor: C.border, paddingHorizontal: 16, paddingVertical: 6 },
  digits: { ...F.extrabold, fontSize: 44, color: C.text, fontVariant: ["tabular-nums"], letterSpacing: -1 },
  quickRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8, marginTop: 18 },
  quick: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: R.full, backgroundColor: C.primarySoft },
  quickActive: { backgroundColor: C.primary },
}));
