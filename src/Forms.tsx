import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowRight, BellRing, Check, CheckCircle2, Hash, KeyRound, Lock, MessageSquareText, Pill, Repeat, Tag, Users, UserPlus, type LucideIcon } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { addDays, clock, dayKey, slot, type Plan } from "../shared/schedule";
import { Blister } from "./Blister";
import { deviceTz, hasSchedule, normalizeId, REMINDER_TEXT_MAX, saveSchedule, setPassword, subscribe, textLength, type Profile } from "./data";
import { useI18n, type Strings } from "./i18n";
import { packCells } from "./pack";
import { alert, toast } from "./sheets";
import { defaultEarlier, EarlierPicker, TimeDial } from "./TakenTime";
import { C, F, G, R, shadow, themedStyles } from "./theme";
import { errorText, queued } from "./errors";
import { Button, Card, ChipGroup, Field, Header, s, Stepper, Toggle } from "./ui";

export function PasswordForm({ pid, hasPassword, onSaved, onBack }: { pid: string; hasPassword: boolean; onSaved: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const [password, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const valid = password.length >= 6 && password === repeat;

  const save = () => {
    if (!valid) return;
    queued(setPassword(pid, password));
    toast(t.passwordSaved);
    onSaved();
  };

  return (
    <View>
      <Header title={hasPassword ? t.changePassword : t.setPassword} subtitle={`${t.passwordIntro({ pid })}${hasPassword ? ` ${t.passwordKeepAccess}` : ""}`} onBack={onBack} />
      <Card>
        <Field label={t.passwordLabel} icon={Lock} value={password} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t.passwordRepeat} icon={Lock} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password"
          onSubmitEditing={save} error={repeat.length > 0 && password !== repeat ? t.passwordMismatch : null} />
        <Button title={t.passwordSave} icon={KeyRound} onPress={save} disabled={!valid} style={{ marginTop: 22 }} />
      </Card>
    </View>
  );
}

export function SubscribeForm({ uid, ownPid, onBack }: { uid: string; ownPid: string; onBack: () => void }) {
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [password, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const pid = normalizeId(id);
  const valid = pid.length === 6 && password.length >= 6 && pid !== ownPid;

  // Awaited (unlike other writes): the server's rules decide whether the password is right.
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await subscribe(uid, pid, password);
      toast(t.followingToast({ pid }));
      onBack();
    } catch (e) {
      alert(t.errorTitle, errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Header title={t.followTitle} subtitle={t.followIntro} onBack={onBack} />
      <Card>
        <Field label={t.idLabel} icon={Hash} value={id} onChangeText={setId} autoCapitalize="characters" autoCorrect={false} maxLength={8}
          placeholder={t.idPlaceholder} error={pid === ownPid ? t.ownIdHint : null} />
        <Field label={t.passwordField} icon={Lock} value={password} onChangeText={setPw} secureTextEntry autoCapitalize="none" onSubmitEditing={save} />
        <Button title={t.subscribe} icon={UserPlus} onPress={save} disabled={!valid} busy={busy} style={{ marginTop: 22 }} />
      </Card>
    </View>
  );
}

const defaultTime = () => `${String(new Date().getHours()).padStart(2, "0")}:00`;

const PRESETS = [
  { key: "preset21_7", pillsPerPack: 21, placebo: 0, breakDays: 7 },
  { key: "preset24_4", pillsPerPack: 28, placebo: 4, breakDays: 0 },
  { key: "preset21_7p", pillsPerPack: 28, placebo: 7, breakDays: 0 },
  { key: "preset28", pillsPerPack: 28, placebo: 0, breakDays: 0 },
  { key: "preset84_7", pillsPerPack: 84, placebo: 0, breakDays: 7 },
] as const;
type Layout = { pillsPerPack: number; placebo: number; breakDays: number };
const presetOf = (l: Layout) => PRESETS.find((p) => p.pillsPerPack === l.pillsPerPack && p.placebo === l.placebo && p.breakDays === l.breakDays);

/** Proportional bar of a pack layout: active pills, placebo pills, pill-free days. */
function LayoutBar({ layout }: { layout: Layout }) {
  const total = layout.pillsPerPack + layout.breakDays;
  const parts = [
    { n: layout.pillsPerPack - layout.placebo, style: { backgroundColor: C.primary } },
    { n: layout.placebo, style: { backgroundColor: C.placebo[1] } },
    { n: layout.breakDays, style: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.breakStroke } as object },
  ].filter((p) => p.n > 0);
  return (
    <View style={{ flexDirection: "row", gap: 3, height: 8, marginTop: 12 }}>
      {parts.map((p, i) => <View key={i} style={[{ flex: p.n / total, borderRadius: 4 }, p.style]} />)}
    </View>
  );
}

function OptionCard({ title, selected, onPress, children }: { title: string; selected: boolean; onPress: () => void; children?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }}
      style={[st.option, selected && [st.optionSelected, shadow(1)]]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Text style={[s.body, F.bold, { flex: 1 }]}>{title}</Text>
        {selected ? <CheckCircle2 size={22} color={C.primary} strokeWidth={2.4} /> : <View style={st.radio} />}
      </View>
      {children}
    </Pressable>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
      {[0, 1, 2].map((i) => <View key={i} style={[st.stepSeg, i <= step && { backgroundColor: C.primary }]} />)}
    </View>
  );
}

export function ScheduleWizard({ uid, pid, current, width, onBack }: {
  uid: string; pid: string; current: Profile | null; width: number; onBack: () => void;
}) {
  const { t } = useI18n();
  const existing = hasSchedule(current) ? current : null;
  const tz = deviceTz();
  const today = dayKey(Date.now(), tz);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(existing?.name ?? "");
  const [layout, setLayout] = useState<Layout>(existing ?? PRESETS[0]);
  const [custom, setCustom] = useState(!!existing && !presetOf(existing));
  const [todayIndex, setTodayIndex] = useState(existing ? slot(existing, today).index : 0);
  const existingTaken = existing && today in existing.takenDays ? existing.takenDays[today] : null;
  const [takenMode, setTakenMode] = useState<"no" | "now" | "earlier">(existingTaken === null ? "no" : "earlier");
  const [time, setTime] = useState(existing?.time ?? defaultTime());
  const [repeatMinutes, setRepeat] = useState(existing?.repeatMinutes ?? 30);
  const [lateMinutes, setLate] = useState(existing?.lateMinutes ?? 60);
  const [reminderText, setReminderText] = useState(existing?.reminderText ?? "");

  const cycle = layout.pillsPerPack + layout.breakDays;
  const index = Math.min(todayIndex, cycle - 1); // the layout may have shrunk since the day was picked
  const isBreak = index >= layout.pillsPerPack;
  const plan: Plan = useMemo(() => {
    const takenDays = { ...existing?.takenDays };
    delete takenDays[today];
    return { ...layout, packStart: addDays(today, -index), trackingSince: existing?.trackingSince ?? today, time, tz, repeatMinutes, lateMinutes, takenDays };
  }, [layout, index, existing, today, time, tz, repeatMinutes, lateMinutes]);
  const [earlier, setEarlier] = useState(existingTaken || defaultEarlier(plan, today));
  // Preview of the pack as it will be saved (past days keep their real marks).
  const preview = useMemo(() => packCells({ ...plan, takenDays: takenMode !== "no" && !isBreak ? { ...plan.takenDays, [today]: "" } : plan.takenDays }, today),
    [plan, takenMode, isBreak, today]);

  const save = () => {
    const takenTodayAt = isBreak || takenMode === "no" ? null : takenMode === "now" ? clock(Date.now(), tz) : earlier;
    queued(saveSchedule(uid, pid, { name, ...layout, todayIndex: index, takenTodayAt, time, repeatMinutes, lateMinutes, reminderText }, current));
    toast(t.scheduleSaved);
    onBack();
  };

  const setPart = (part: Partial<Layout>) => setLayout((l) => {
    const next = { ...l, ...part };
    return { ...next, placebo: Math.min(next.placebo, next.pillsPerPack - 1) };
  });
  const header = (
    <>
      <Header title={existing ? t.editTitle : t.createTitle} subtitle={t.step({ n: step + 1 })} onBack={step === 0 ? onBack : () => setStep(step - 1)} />
      <StepBar step={step} />
    </>
  );

  if (step === 0) return (
    <View>
      {header}
      <Text style={[s.h2, { marginTop: 24 }]}>{t.packQuestion}</Text>
      {PRESETS.map((p) => (
        <OptionCard key={p.key} title={t[p.key]} selected={!custom && presetOf(layout)?.key === p.key} onPress={() => { setCustom(false); setLayout(p); }}>
          <LayoutBar layout={p} />
        </OptionCard>
      ))}
      <OptionCard title={t.presetCustom} selected={custom} onPress={() => setCustom(true)}>
        {custom && <LayoutBar layout={layout} />}
      </OptionCard>
      {custom && (
        <Card style={{ marginTop: 10 }}>
          <Text style={[s.label, { marginBottom: 0 }]}>{t.pillsLabel}</Text>
          <Stepper value={layout.pillsPerPack} min={1} max={91} onChange={(n) => setPart({ pillsPerPack: n })} />
          <Text style={[s.label, { marginTop: 14, marginBottom: 0 }]}>{t.placeboLabel}</Text>
          <Stepper value={layout.placebo} min={0} max={layout.pillsPerPack - 1} onChange={(n) => setPart({ placebo: n })} />
          <Text style={[s.label, { marginTop: 14, marginBottom: 0 }]}>{t.breakLabel}</Text>
          <Stepper value={layout.breakDays} min={0} max={14} onChange={(n) => setPart({ breakDays: n })} />
        </Card>
      )}
      <Card>
        <Field label={t.nameLabel} icon={Tag} value={name} onChangeText={setName} maxLength={30} placeholder={pid} />
      </Card>
      <Button title={t.next} icon={ArrowRight} onPress={() => setStep(1)} style={{ marginTop: 22 }} />
    </View>
  );

  if (step === 1) return (
    <View>
      {header}
      <Card style={{ marginTop: 22 }}>
        <Text style={s.h2}>{t.todayQuestion}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{t.todayHint}</Text>
        <View style={{ alignItems: "center", marginTop: 16 }}>
          <Blister cells={preview.cells} startWeekday={preview.startWeekday} width={Math.min(width - 82, 440)} onPressCell={setTodayIndex} />
        </View>
      </Card>
      {!isBreak && (
        <Card>
          <Toggle label={t.takenTodayToggle} value={takenMode !== "no"} onChange={(v) => setTakenMode(v ? "now" : "no")} />
          {takenMode !== "no" && <>
            <ChipGroup options={[{ label: t.takenNow({ time: clock(Date.now(), tz) }), value: "now" }, { label: t.takenEarlier, value: "earlier" }]}
              value={takenMode} onChange={setTakenMode} />
            {takenMode === "earlier" && <EarlierPicker plan={plan} day={today} value={earlier} onChange={setEarlier} />}
          </>}
        </Card>
      )}
      <Button title={t.next} icon={ArrowRight} onPress={() => setStep(2)} style={{ marginTop: 22 }} />
    </View>
  );

  return (
    <View>
      {header}
      <Card style={{ marginTop: 22 }}>
        <Text style={s.h2}>{t.timeQuestion}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{t.timeHint}</Text>
        <TimeDial value={time} onChange={setTime} />
      </Card>
      <Card>
        <SettingTitle icon={Repeat} title={t.repeatLabel} />
        <ChipGroup options={[0, 15, 30, 60].map((n) => ({ label: n ? t.minutes({ n }) : t.off, value: n }))} value={repeatMinutes} onChange={setRepeat} />
        <View style={{ height: 22 }} />
        <SettingTitle icon={Users} title={t.lateLabel} />
        <ChipGroup options={[0, 30, 60, 120].map((n) => ({ label: !n ? t.off : n < 60 ? t.minutes({ n }) : t.hours({ n: n / 60 }), value: n }))} value={lateMinutes} onChange={setLate} />
      </Card>
      <Card>
        <SettingTitle icon={MessageSquareText} title={t.reminderTextLabel} />
        <Text style={[s.small, { marginTop: 6 }]}>{t.reminderTextHint}</Text>
        <Field label={`${textLength(reminderText)} / ${REMINDER_TEXT_MAX}`} value={reminderText} placeholder={t.defaultReminderTitle}
          onChangeText={(v) => setReminderText([...v].slice(0, REMINDER_TEXT_MAX).join(""))} />
        <Text style={[s.label, { marginTop: 16 }]}>{t.preview}</Text>
        <View style={st.preview}>
          <LinearGradient colors={G.primary} style={st.previewIcon}><Pill size={16} color={C.white} strokeWidth={2.4} /></LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[s.small, F.bold, { color: C.text }]} numberOfLines={2}>{reminderText.trim() || t.defaultReminderTitle}</Text>
            {!reminderText.trim() && <Text style={s.small}>{t.defaultReminderBody}</Text>}
          </View>
          <Text style={[s.small, { color: C.muted }]}>{time}</Text>
        </View>
      </Card>
      <Summary t={t} time={time} repeat={repeatMinutes} late={lateMinutes} />
      <Button title={existing ? t.saveChanges : t.startSchedule} icon={Check} onPress={save} style={{ marginTop: 22 }} />
    </View>
  );
}

function SettingTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon size={18} color={C.primaryDeep} strokeWidth={2.4} />
      <Text style={[s.body, F.bold, { flex: 1 }]}>{title}</Text>
    </View>
  );
}

function Summary({ t, time, repeat, late }: { t: Strings; time: string; repeat: number; late: number }) {
  const lateText = late === 0 ? "" : late < 60 ? t.minutes({ n: late }) : t.hours({ n: late / 60 });
  return (
    <View style={st.summary}>
      <BellRing size={18} color={C.primaryDeep} strokeWidth={2.4} />
      <Text style={[s.small, F.semibold, { flex: 1, color: C.text, lineHeight: 19 }]}>{t.scheduleSummary({ time, repeat, late: lateText })}</Text>
    </View>
  );
}

const st = themedStyles(() => ({
  option: { backgroundColor: C.card, borderRadius: R.lg, padding: 16, marginTop: 10, borderWidth: 1.5, borderColor: C.border },
  optionSelected: { borderColor: C.primary, backgroundColor: C.primaryTint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.switchOff },
  stepSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: C.border },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.segment, borderRadius: R.md, padding: 12 },
  previewIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: C.primarySoft, borderRadius: R.lg, padding: 16, marginTop: 16 },
}));
