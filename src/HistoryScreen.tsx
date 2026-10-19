import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { addDays, dayKey, isTaken, slot, weekday } from "../shared/schedule";
import type { Note, Schedule } from "./data";
import { NoteLine, openNoteSheet, type OwnNote } from "./HomeCards";
import { formatDay, formatMonth, useI18n } from "./i18n";
import { C, F, themedStyles } from "./theme";
import { Card, Header, IconButton, ProgressRing, s } from "./ui";

type Status = "taken" | "missed" | "break" | "open" | "untracked";

/**
 * Month calendar of a schedule plus the month's notes. Owner only (`ownerPid`/`onEditDay`): correct days and edit notes;
 * followers see the shared notes.
 */
export function HistoryScreen({ schedule, notes, ownerPid, onEditDay, onBack }: {
  schedule: Schedule; notes: Record<string, Note | OwnNote>; ownerPid?: string; onEditDay?: (day: string) => void; onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const today = dayKey(Date.now(), schedule.tz);
  const [month, setMonth] = useState({ year: +today.slice(0, 4), month: +today.slice(5, 7) - 1 });

  const first = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const days = Array.from({ length: 31 }, (_, i) => addDays(first, i)).filter((d) => d.slice(0, 7) === first.slice(0, 7));
  const status = (day: string): Status => {
    if (day < schedule.trackingSince) return "untracked";
    if (slot(schedule, day).kind === "break") return "break";
    if (isTaken(schedule, day)) return "taken";
    return day < today ? "missed" : "open";
  };
  // Today only counts once it's marked; until then its pill is still due, not missed.
  const counted = days.filter((d) => (d < today || (d === today && isTaken(schedule, d))) && d >= schedule.trackingSince && slot(schedule, d).kind !== "break");
  const takenCount = counted.filter((d) => isTaken(schedule, d)).length;
  const rate = counted.length ? takenCount / counted.length : 0;
  const monthNotes = days.filter((d) => notes[d]).reverse();

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
            <Text style={s.h2}>{t.monthStats({ taken: takenCount, due: counted.length })}</Text>
            <View style={{ flexDirection: "row", gap: 14 }}>
              <Stat color={C.success} label={t.legendTaken} n={takenCount} />
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
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 6 }}>
          {Array.from({ length: weekday(first) }, (_, i) => <View key={`pad${i}`} style={st.col} />)}
          {days.map((day) => {
            const stt = status(day);
            const placebo = slot(schedule, day).kind === "placebo";
            const time = stt === "taken" ? schedule.takenDays[day] : undefined;
            const editable = !!onEditDay && day <= today && day >= schedule.trackingSince && stt !== "break";
            return (
              <Pressable key={day} onPress={() => onEditDay?.(day)} disabled={!editable} accessibilityRole="button"
                accessibilityLabel={`${formatDay(day, lang)}: ${stt === "taken" ? t.legendTaken : stt === "missed" ? t.legendMissed : stt === "break" ? t.legendBreak : ""}`}
                style={[st.col, { alignItems: "center", paddingVertical: 4 }]}>
                <View style={[st.day, dayStyle[stt], day === today && st.today]}>
                  {notes[day] && <View style={st.noteDot} />}
                  <Text style={[F.bold, { fontSize: 15, color: stt === "taken" ? C.white : stt === "missed" ? C.danger : stt === "untracked" ? C.muted : C.text }]}>
                    {+day.slice(8)}
                  </Text>
                </View>
                <Text style={[F.semibold, { fontSize: 10, color: C.muted, height: 14, marginTop: 2 }]} numberOfLines={1}>
                  {time || (placebo && stt !== "untracked" ? "•" : "")}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={st.legend}>
          {([["taken", t.legendTaken], ["missed", t.legendMissed], ["break", t.legendBreak]] as const).map(([k, label]) => (
            <View key={k} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View style={[{ width: 14, height: 14, borderRadius: 7 }, dayStyle[k]]} />
              <Text style={s.small}>{label}</Text>
            </View>
          ))}
          <Text style={s.small}>• {t.legendPlacebo}</Text>
        </View>
        {onEditDay && <Text style={[s.small, { textAlign: "center", marginTop: 12 }]}>{t.historyHint}</Text>}
      </Card>

      <Card>
        <Text style={[s.h2, { marginBottom: 6 }]}>{t.notesTitle}</Text>
        {monthNotes.length === 0 && <Text style={[s.muted, { marginTop: 4 }]}>{t.noNotes}</Text>}
        {monthNotes.map((day) => {
          const note = notes[day];
          const own = "shared" in note ? (note as OwnNote) : null;
          const line = <NoteLine note={note} label={formatDay(day, lang)} badge={own ? (own.shared ? t.sharedBadge : t.privateBadge) : undefined} />;
          return ownerPid
            ? <Pressable key={day} onPress={() => openNoteSheet(ownerPid, day, own, lang)} accessibilityRole="button" accessibilityLabel={formatDay(day, lang)}>{line}</Pressable>
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
  col: { width: `${100 / 7}%` },
  day: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  today: { borderWidth: 2.5, borderColor: C.primary },
  noteDot: { position: "absolute", top: 1, right: 1, width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, borderWidth: 1.5, borderColor: C.card },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border },
}));

const dayStyle = themedStyles(() => ({
  taken: { backgroundColor: C.success },
  missed: { backgroundColor: C.dangerSoft, borderWidth: 1.5, borderColor: C.danger },
  break: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.placeboStroke },
  open: { backgroundColor: C.calendarOpen },
  untracked: {},
}));
