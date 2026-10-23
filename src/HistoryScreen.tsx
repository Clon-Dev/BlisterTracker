import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { actionOn, addDays, dayKey, doneAt, firstEditableDay, isTaken, methodOf, movedTo, slot, weekday } from "../shared/schedule";
import type { Note, Schedule } from "./data";
import { NoteLine, openNoteSheet, type OwnNote } from "./HomeCards";
import { formatDay, formatMonth, useI18n } from "./i18n";
import { actionState } from "./methods/MethodViews";
import { C, F, themedStyles } from "./theme";
import { Card, Header, IconButton, ProgressRing, s } from "./ui";

// Patch / ring / injection add "late" (done on a later day), "moved" (a cycle start done later, which moved the cycle),
// "wearing" (a day between actions) and "plain" (the injection's days between injections).
type Status = "taken" | "late" | "moved" | "missed" | "break" | "open" | "untracked" | "wearing" | "plain";

/**
 * Month calendar of a schedule plus the month's notes. Owner only (`ownerPid`/`onEditDay`): correct days and edit notes;
 * followers see the shared notes.
 */
export function HistoryScreen({ schedule, notes, owner, onEditDay, onBack }: {
  schedule: Schedule; notes: Record<string, Note | OwnNote>; owner?: { uid: string; pid: string }; onEditDay?: (day: string) => void; onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const today = dayKey(Date.now(), schedule.tz);
  const [month, setMonth] = useState({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 });

  const first = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const days = Array.from({ length: 31 }, (_, i) => addDays(first, i)).filter((d) => d.slice(0, 7) === first.slice(0, 7));
  // Pills of the pack in which tracking started, before the setup day: the setup said they were taken
  // (the blister shows them popped), so the history shows them as taken too, without a time. They can be
  // corrected like any other day.
  const editableFrom = firstEditableDay(schedule);
  const method = methodOf(schedule);
  const pill = method === "pill";
  // Patch / ring / injection: only action days are marked, and an action stays open (not missed) while it carries over.
  const methodStatus = (day: string): Status => {
    if (actionOn(schedule, day)) {
      if (day < schedule.trackingSince && !(day in schedule.takenDays)) return day >= editableFrom ? "taken" : "untracked";
      if (movedTo(schedule, day)) return "moved";
      const state = actionState(schedule, day, today);
      return state === "done" ? "taken" : state === "late" || state === "missed" ? state : "open";
    }
    if (day < schedule.trackingSince) return "untracked";
    return slot(schedule, day).kind === "break" ? "break" : method === "injection" ? "plain" : "wearing";
  };
  const status = (day: string): Status => {
    if (!pill) return methodStatus(day);
    if (day in schedule.takenDays) return "taken"; // a marked day always shows, even if it now falls into a break
    const kind = slot(schedule, day).kind;
    if (day < schedule.trackingSince) return kind !== "break" && day >= editableFrom ? "taken" : "untracked";
    if (kind === "break") return "break";
    if (isTaken(schedule, day)) return "taken";
    return day < today ? "missed" : "open";
  };
  // Today only counts once it's marked; until then its pill is still due, not missed.
  const counted = days.filter((d) => { const st = status(d); return st === "taken" || st === "late" || st === "missed"; });
  const takenCount = counted.filter((d) => status(d) !== "missed").length;
  // Fixed weeks of 7 (a wrapping row of 1/7-wide cells can round into 6 per row and shift the weekdays).
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const rate = counted.length ? takenCount / counted.length : 0;
  const monthNotes = days.filter((d) => notes[d]).reverse();
  const legend: [Status, string][] = pill
    ? [["taken", t.legendTaken], ["missed", t.legendMissed], ["break", t.legendBreak]]
    : [
      ["taken", t.legendDone], ["late", t.legendLate], ["missed", t.legendMissed],
      ...(method === "injection" ? [] : [["wearing", t.legendWearing[method]] as [Status, string]]),
      ...(method !== "injection" && schedule.breakDays > 0 ? [["break", t.legendFree[method]] as [Status, string]] : []),
    ];

  const shift = (n: number) => setMonth(({ year, month: m }) => {
    const d = new Date(Date.UTC(year, m + n, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });

  return (
    <View>
      <Header title={t.history} subtitle={schedule.name || undefined} onBack={onBack} />

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <ProgressRing progress={rate} size={84} stroke={8}>
            <Text style={[F.extrabold, { fontSize: 20, color: C.text }]}>{Math.round(rate * 100)}%</Text>
          </ProgressRing>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={s.h2}>{pill ? t.monthStats({ taken: takenCount, due: counted.length }) : t.monthStatsMethod({ done: takenCount, due: counted.length })}</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Stat color={C.success} label={pill ? t.legendTaken : t.legendDone} n={takenCount} />
              <Stat color={C.danger} label={t.legendMissed} n={counted.length - takenCount} />
            </View>
          </View>
        </View>
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <IconButton icon={ChevronLeft} label="‹" onPress={() => shift(-1)} />
          <Text style={s.h2}>{formatMonth(month.year, month.month, lang)}</Text>
          <IconButton icon={ChevronRight} label="›" onPress={() => shift(1)} />
        </View>
        <View style={{ flexDirection: "row", marginTop: 16 }}>
          {t.weekdays.map((w) => <Text key={w} style={[s.eyebrow, st.col, { textAlign: "center", letterSpacing: 0.4 }]}>{w}</Text>)}
        </View>
        <View style={{ marginTop: 6 }}>
          {weeks.map((week, w) => (
          <View key={w} style={{ flexDirection: "row" }}>
          {week.map((day, i) => {
            if (!day) return <View key={`pad${i}`} style={st.col} />;
            const stt = status(day);
            const placebo = pill && slot(schedule, day).kind === "placebo";
            const moved = stt === "moved" ? movedTo(schedule, day) : null;
            const time = stt === "taken" || stt === "late" ? (pill ? schedule.takenDays[day] : doneAt(schedule, day)?.time) || "✓" : moved ? `→ ${+moved.slice(8)}` : undefined;
            const editable = !!onEditDay && day <= today && (pill
              ? day >= editableFrom && stt !== "break"
              : !!actionOn(schedule, day) && (day >= schedule.trackingSince || day in schedule.takenDays));
            const label = stt === "taken" ? (pill ? t.legendTaken : t.legendDone) : stt === "late" || stt === "moved" ? t.legendLate : stt === "missed" ? t.legendMissed
              : stt === "break" ? (pill ? t.legendBreak : t.legendFree[method as "patch" | "ring"]) : stt === "wearing" ? t.legendWearing[method] : "";
            // Patch / ring / injection: a dot under an action day that is still to come.
            const due = !pill && stt === "open";
            return (
              <Pressable key={day} onPress={() => onEditDay?.(day)} disabled={!editable} accessibilityRole="button"
                accessibilityLabel={`${formatDay(day, lang)}: ${label}`}
                style={[st.col, { alignItems: "center", paddingVertical: 4 }]}>
                <View style={[st.day, dayStyle[stt], day === today && st.today]}>
                  {notes[day] && <View style={st.noteDot} />}
                  <Text style={[F.bold, { fontSize: 15, color: stt === "taken" || stt === "late" ? C.white : stt === "missed" ? C.danger : stt === "untracked" ? C.muted : C.text }]}>
                    {+day.slice(8)}
                  </Text>
                </View>
                <Text style={[F.semibold, { fontSize: 10, color: due ? C.primary : stt === "late" || stt === "moved" ? C.warning : C.muted, height: 14, marginTop: 2 }]} numberOfLines={1}>
                  {time || ((placebo && stt !== "untracked") || due ? "•" : "")}
                </Text>
              </Pressable>
            );
          })}
          </View>
          ))}
        </View>
        <View style={st.legend}>
          {legend.map(([k, label]) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[{ width: 14, height: 14, borderRadius: 7 }, dayStyle[k]]} />
              <Text style={s.small}>{label}</Text>
            </View>
          ))}
          {pill && <Text style={s.small}>• {t.legendPlacebo}</Text>}
        </View>
        {onEditDay && <Text style={[s.small, { textAlign: "center", marginTop: 12 }]}>{pill ? t.historyHint : t.historyHintMethod}</Text>}
      </Card>

      <Card>
        <Text style={[s.h2, { marginBottom: 6 }]}>{t.notesTitle}</Text>
        {monthNotes.length === 0 && <Text style={[s.muted, { marginTop: 4 }]}>{t.noNotes}</Text>}
        {monthNotes.map((day) => {
          const note = notes[day];
          const own = "shared" in note ? (note as OwnNote) : null;
          const line = <NoteLine note={note} label={formatDay(day, lang)} badge={own ? (own.shared ? t.sharedBadge : t.privateBadge) : undefined} />;
          return owner
            ? <Pressable key={day} onPress={() => openNoteSheet(owner.uid, owner.pid, day, own, lang)} accessibilityRole="button" accessibilityLabel={formatDay(day, lang)}>{line}</Pressable>
            : <View key={day}>{line}</View>;
        })}
      </Card>
    </View>
  );
}

const Stat = ({ color, label, n }: { color: string; label: string; n: number }) => (
  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    <Text style={s.small}>{n} {label}</Text>
  </View>
);

const st = themedStyles(() => ({
  col: { flex: 1 },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 2.5, borderColor: C.primary },
  noteDot: { position: "absolute", top: 1, right: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, borderWidth: 1.5, borderColor: C.card },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
}));

const dayStyle = themedStyles(() => ({
  taken: { backgroundColor: C.success },
  late: { backgroundColor: C.warning },
  moved: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.warning },
  wearing: { backgroundColor: C.primarySoft },
  plain: {},
  missed: { backgroundColor: C.dangerSoft, borderWidth: 1.5, borderColor: C.danger },
  break: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.placeboStroke },
  open: { backgroundColor: C.calendarOpen },
  untracked: {},
}));
