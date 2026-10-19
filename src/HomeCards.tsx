// Home screen additions: supplies & appointment, daily note, travel notice, and their sheets.
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import {
  CalendarClock, Check, ChevronRight, Globe2, NotebookPen, Package, SkipForward, Stethoscope, Trash2, type LucideIcon,
} from "lucide-react-native";
import { addDays, clock, isTaken, packsLeft, zonedTime } from "../shared/schedule";
import { DatePicker } from "./DatePicker";
import { MOODS, setAppointment, setNote, setSupply, startPackEarly, todayOf, type Note, type Schedule } from "./data";
import { queued } from "./errors";
import { formatDay, useI18n, type Lang, type Strings } from "./i18n";
import { openSheet, SheetIcon, toast } from "./sheets";
import { C, F, R, themedStyles } from "./theme";
import { Badge, Button, Card, Field, LinkButton, s, Stepper, Toggle } from "./ui";

export type OwnNote = Note & { shared: boolean };

// ---------- Supplies & appointment ----------

export function SuppliesCard({ pid, schedule }: { pid: string; schedule: Schedule }) {
  const { t, lang } = useI18n();
  const today = todayOf(schedule);
  const left = packsLeft(schedule, today);
  const unopened = left === null ? null : Math.max(0, left - 1);
  const appointment = schedule.appointmentDay && schedule.appointmentDay >= today ? schedule.appointmentDay : null;
  return (
    <Card style={{ padding: 6 }}>
      <InfoRow icon={Package} tone={unopened === 0 ? "danger" : "primary"}
        title={unopened === null ? t.supplyNone : t.supplyLeft({ n: unopened })}
        subtitle={unopened === null ? t.supplyAction : unopened === 0 ? t.supplyRefill : t.supplyHint}
        onPress={() => openSheet((done) => <SupplySheet pid={pid} schedule={schedule} unopened={unopened} done={done} />)} />
      <View style={st.divider} />
      <InfoRow icon={Stethoscope} tone="primary"
        title={appointment ? t.appointmentOn({ date: formatDay(appointment, lang) }) : t.appointmentNone}
        subtitle={appointment ? schedule.appointmentNote || t.appointmentHint : t.appointmentAction}
        onPress={() => openSheet((done) => <AppointmentSheet pid={pid} schedule={schedule} done={done} />)} />
    </Card>
  );
}

function InfoRow({ icon: Icon, tone, title, subtitle, onPress }: {
  icon: LucideIcon; tone: "primary" | "danger"; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: C.primaryTint }]}>
      <View style={[st.rowIcon, { backgroundColor: tone === "danger" ? C.dangerSoft : C.primarySoft }]}>
        <Icon size={19} color={tone === "danger" ? C.danger : C.primaryDeep} strokeWidth={2.3} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.body, F.bold, tone === "danger" && { color: C.danger }]}>{title}</Text>
        <Text style={[s.small, { marginTop: 2 }]} numberOfLines={2}>{subtitle}</Text>
      </View>
      <ChevronRight size={20} color={C.muted} strokeWidth={2.2} />
    </Pressable>
  );
}

function SupplySheet({ pid, schedule, unopened, done }: { pid: string; schedule: Schedule; unopened: number | null; done: () => void }) {
  const { t } = useI18n();
  const [n, setN] = useState(unopened ?? 2);
  return (
    <View>
      <SheetIcon icon={Package} />
      <Text style={s.h1}>{t.supplySheetTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.supplySheetBody}</Text>
      <Stepper value={n} min={0} max={23} onChange={setN} />
      <Button title={t.save} icon={Check} style={{ marginTop: 22 }} onPress={() => { queued(setSupply(pid, schedule, n)); done(); toast(t.saved); }} />
      {unopened !== null && <LinkButton title={t.stopTracking} color={C.textSoft} onPress={() => { queued(setSupply(pid, schedule, null)); done(); }} />}
    </View>
  );
}

function AppointmentSheet({ pid, schedule, done }: { pid: string; schedule: Schedule; done: () => void }) {
  const { t } = useI18n();
  const today = todayOf(schedule);
  const [day, setDay] = useState<string | null>(schedule.appointmentDay && schedule.appointmentDay >= today ? schedule.appointmentDay : null);
  const [note, setNoteText] = useState(schedule.appointmentNote ?? "");
  return (
    <View>
      <SheetIcon icon={Stethoscope} />
      <Text style={s.h1}>{t.appointmentSheetTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.appointmentHint}</Text>
      <DatePicker value={day} onChange={setDay} min={addDays(today, 1)} />
      <Field label={t.appointmentNoteLabel} icon={CalendarClock} value={note} onChangeText={setNoteText} maxLength={80} />
      <Button title={t.save} icon={Check} disabled={!day} style={{ marginTop: 20 }}
        onPress={() => { queued(setAppointment(pid, schedule, day, note)); done(); toast(t.saved); }} />
      {schedule.appointmentDay && <LinkButton title={t.removeAppointment} icon={Trash2} color={C.textSoft}
        onPress={() => { queued(setAppointment(pid, schedule, null, "")); done(); }} />}
    </View>
  );
}

// ---------- Start the next pack early (delay a period) ----------

export function openEarlyPackSheet(pid: string, schedule: Schedule, lang: Lang) {
  return openSheet<void>((done) => <EarlyPackSheet pid={pid} schedule={schedule} lang={lang} done={done} />);
}

function EarlyPackSheet({ pid, schedule, lang, done }: { pid: string; schedule: Schedule; lang: Lang; done: () => void }) {
  const { t } = useI18n();
  const today = todayOf(schedule);
  // If today's pill (of the current pack) is already taken, the new pack can only start tomorrow.
  const takenToday = isTaken(schedule, today);
  const start = (day: string) => { queued(startPackEarly(pid, schedule, day)); done(); toast(t.earlyDone({ date: formatDay(day, lang) })); };
  return (
    <View>
      <SheetIcon icon={SkipForward} tone="warning" />
      <Text style={s.h1}>{t.earlyTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.earlyBody}</Text>
      <View style={st.hint}><Text style={[s.small, F.semibold, { color: C.warning }]}>{t.earlyMedical}</Text></View>
      {!takenToday && <Button title={t.startToday} onPress={() => start(today)} style={{ marginTop: 20 }} />}
      <Button title={t.startTomorrow} kind={takenToday ? "primary" : "secondary"} onPress={() => start(addDays(today, 1))} style={{ marginTop: takenToday ? 20 : 10 }} />
    </View>
  );
}

// ---------- Daily notes ----------

/** Mood chips, free text and the share switch. */
function NoteEditor({ initial, onSave, onDelete }: { initial: OwnNote | null; onSave: (n: OwnNote) => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const [mood, setMood] = useState<string | null>(initial?.mood ?? null);
  const [text, setText] = useState(initial?.text ?? "");
  const [shared, setShared] = useState(initial?.shared ?? false);
  const changed = mood !== (initial?.mood ?? null) || text.trim() !== (initial?.text ?? "") || shared !== (initial?.shared ?? false);
  return (
    <View>
      <View style={st.moods}>
        {MOODS.map((m) => (
          <Pressable key={m} onPress={() => setMood(mood === m ? null : m)} accessibilityRole="button" accessibilityLabel={m}
            accessibilityState={{ selected: mood === m }} style={[st.mood, mood === m && st.moodActive]}>
            <Text style={{ fontSize: 26 }}>{m}</Text>
          </Pressable>
        ))}
      </View>
      <TextInput value={text} onChangeText={setText} placeholder={t.notePlaceholder} placeholderTextColor={C.placeholder} multiline maxLength={280}
        style={st.noteInput} />
      <Toggle label={t.shareNote} value={shared} onChange={setShared} />
      <Button title={t.saveNote} icon={Check} disabled={!changed || (!mood && !text.trim())} style={{ marginTop: 18 }}
        onPress={() => onSave({ mood, text: text.trim(), shared })} />
      {onDelete && initial && <LinkButton title={t.deleteNote} icon={Trash2} color={C.textSoft} onPress={onDelete} />}
    </View>
  );
}

export function NoteCard({ pid, day, note }: { pid: string; day: string; note: OwnNote | null }) {
  const { t } = useI18n();
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <NotebookPen size={19} color={C.primaryDeep} strokeWidth={2.3} />
        <Text style={[s.h2, { flex: 1 }]}>{t.noteTitle}</Text>
        {note && <Badge tone={note.shared ? "primary" : "neutral"} label={note.shared ? t.sharedBadge : t.privateBadge} />}
      </View>
      <NoteEditor key={JSON.stringify(note)} initial={note}
        onSave={(n) => { queued(setNote(pid, day, { text: n.text, mood: n.mood }, n.shared, note?.shared ?? null)); toast(t.noteSaved); }} />
    </Card>
  );
}

/** Edit (or delete) the note of a past day. */
export function openNoteSheet(pid: string, day: string, note: OwnNote | null, lang: Lang) {
  return openSheet<void>((done) => <NoteSheet pid={pid} day={day} note={note} lang={lang} done={done} />);
}

function NoteSheet({ pid, day, note, lang, done }: { pid: string; day: string; note: OwnNote | null; lang: Lang; done: () => void }) {
  const { t } = useI18n();
  return (
    <View>
      <SheetIcon icon={NotebookPen} />
      <Text style={s.h1}>{formatDay(day, lang)}</Text>
      <NoteEditor initial={note}
        onSave={(n) => { queued(setNote(pid, day, { text: n.text, mood: n.mood }, n.shared, note?.shared ?? null)); done(); toast(t.noteSaved); }}
        onDelete={() => { if (note) queued(setNote(pid, day, null, note.shared, note.shared)); done(); }} />
    </View>
  );
}

/** Read-only note line (history list, follower card). */
export function NoteLine({ note, label, badge }: { note: Note; label?: string; badge?: string }) {
  return (
    <View style={st.noteLine}>
      <Text style={{ fontSize: 22 }}>{note.mood ?? "📝"}</Text>
      <View style={{ flex: 1 }}>
        {label ? <Text style={[s.small, F.bold]}>{label}</Text> : null}
        {note.text ? <Text style={[s.body, { marginTop: label ? 2 : 0 }]}>{note.text}</Text> : null}
      </View>
      {badge ? <Badge tone="neutral" label={badge} /> : null}
    </View>
  );
}

// ---------- Travelling ----------

/** Shown when the device is in another time zone than the schedule; offers to switch or keep home time. */
export function TravelNotice({ schedule, deviceTz, t, onUseLocal, onKeep }: {
  schedule: Schedule; deviceTz: string; t: Strings; onUseLocal: () => void; onKeep: () => void;
}) {
  const local = clock(zonedTime(todayOf(schedule), schedule.time, schedule.tz), deviceTz);
  const city = (tz: string) => tz.split("/").pop()!.replace(/_/g, " ");
  return (
    <View style={st.travel}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <View style={[st.rowIcon, { backgroundColor: C.card }]}><Globe2 size={18} color={C.primaryDeep} strokeWidth={2.4} /></View>
        <Text style={[s.small, F.semibold, { flex: 1, color: C.text, lineHeight: 19 }]}>
          {t.travelNotice({ zone: city(deviceTz), home: schedule.time, homeZone: city(schedule.tz), local })}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button title={t.useLocalTime} compact onPress={onUseLocal} style={{ flex: 1 }} />
        <Button title={t.keepHomeTime} kind="secondary" compact onPress={onKeep} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const st = themedStyles(() => ({
  row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 14, paddingHorizontal: 14, paddingVertical: 14, borderRadius: R.md },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center" as const, justifyContent: "center" as const },
  divider: { height: 1, backgroundColor: C.border, marginLeft: 66, marginRight: 14 },
  hint: { backgroundColor: C.warningSoft, borderRadius: R.md, padding: 12, marginTop: 14 },
  moods: { flexDirection: "row" as const, justifyContent: "space-between" as const, marginTop: 16 },
  mood: { width: 54, height: 54, borderRadius: 27, alignItems: "center" as const, justifyContent: "center" as const, backgroundColor: C.segment },
  moodActive: { backgroundColor: C.primarySoft, borderWidth: 2, borderColor: C.primary },
  noteInput: { ...F.medium, fontSize: 15, color: C.text, minHeight: 84, textAlignVertical: "top" as const, borderRadius: R.md, borderWidth: 1.5,
    borderColor: C.border, backgroundColor: C.primaryTint, padding: 14, marginTop: 14 },
  noteLine: { flexDirection: "row" as const, gap: 12, alignItems: "flex-start" as const, paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.border },
  travel: { backgroundColor: C.primarySoft, borderRadius: R.lg, padding: 14, marginTop: 14, gap: 4 },
}));
