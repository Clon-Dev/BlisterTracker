import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ArrowRight, AtSign, Bandage, BellRing, Check, CheckCircle2, CircleDot, KeyRound, Lock, MessageSquareText, Pill, Repeat, Syringe, Tag, Users, UserPlus, type LucideIcon } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { actionOn, addDays, clock, cycleLength, dayKey, isTaken, methodOf, METHODS, nextAction, slot, type Method, type Plan } from "../shared/schedule";
import { Blister } from "./Blister";
import { DatePicker } from "./DatePicker";
import { cleanUsername, deviceTz, hasSchedule, prepareSharingPassword, REMINDER_TEXT_MAX, resolveUsername, saveSchedule, subscribe, textLength, USERNAME_MAX, USERNAME_MIN, type Profile } from "./data";
import { formatDay, useI18n } from "./i18n";
import { actionKey } from "./methods/status";
import { packCells } from "./pack";
import { alert, toast } from "./sheets";
import { defaultEarlier, EarlierPicker, TimeDial } from "./TakenTime";
import { C, F, G, R, shadow, themedStyles } from "./theme";
import { errorText, queued } from "./errors";
import { Button, Card, ChipGroup, Field, Header, s, Stepper, Toggle } from "./ui";

export function PasswordForm({ uid, pid, name, hasPassword, onSaved, onBack }: {
  uid: string; pid: string; /** The username others follow with. */ name: string; hasPassword: boolean; onSaved: (password: string) => void; onBack: () => void;
}) {
  const { t } = useI18n();
  const [password, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = password.length >= 6 && password === repeat;

  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      queued((await prepareSharingPassword(uid, pid, password))()); // confirmed once the keys are ready; the write itself may wait for the network
      toast(t.passwordSaved);
      onSaved(password);
    } catch (e) {
      alert(t.errorTitle, errorText(e));
      setBusy(false);
    }
  };

  return (
    <View>
      <Header title={hasPassword ? t.changePassword : t.setPassword} subtitle={`${t.passwordIntro({ name })}${hasPassword ? ` ${t.passwordKeepAccess}` : ""}`} onBack={onBack} />
      <Card>
        <Field label={t.passwordLabel} icon={Lock} value={password} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t.passwordRepeat} icon={Lock} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password"
          onSubmitEditing={save} error={repeat.length > 0 && password !== repeat ? t.passwordMismatch : null} />
        <Button title={t.passwordSave} icon={KeyRound} onPress={save} disabled={!valid} busy={busy} style={{ marginTop: 22 }} />
      </Card>
    </View>
  );
}

export function SubscribeForm({ uid, ownPid, onBack }: { uid: string; ownPid: string; onBack: () => void }) {
  const { t } = useI18n();
  const [id, setId] = useState("");
  const [password, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const name = cleanUsername(id);
  const length = [...name].length;
  const valid = length >= USERNAME_MIN && length <= USERNAME_MAX && password.length >= 6;

  // Awaited (unlike other writes): the server's rules decide whether the password is right.
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const pid = await resolveUsername(name); // a personal ID from before usernames works too
      if (!pid) throw new Error(t.usernameNotFound);
      if (pid === ownPid) throw new Error(t.ownIdHint);
      await subscribe(uid, pid, password);
      toast(t.followingToast({ name }));
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
        <Field label={t.idLabel} icon={AtSign} value={id} onChangeText={setId} autoCapitalize="none" autoCorrect={false} maxLength={USERNAME_MAX}
          placeholder={t.idPlaceholder} />
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

function OptionCard({ title, selected, onPress, icon, children }: {
  title: string; selected: boolean; onPress: () => void; icon?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ selected }}
      style={[st.option, selected && [st.optionSelected, shadow(1)]]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {icon}
        <Text style={[s.body, F.bold, { flex: 1 }]}>{title}</Text>
        {selected ? <CheckCircle2 size={22} color={C.primary} strokeWidth={2.4} /> : <View style={st.radio} />}
      </View>
      {children}
    </Pressable>
  );
}

function StepBar({ step, total }: { step: number; total: number }) {
  return (
    <View style={{ flexDirection: "row", gap: 6, marginTop: 4 }}>
      {Array.from({ length: total }, (_, i) => <View key={i} style={[st.stepSeg, i <= step && { backgroundColor: C.primary }]} />)}
    </View>
  );
}

const METHOD_ICON: Record<Method, LucideIcon> = { pill: Pill, patch: Bandage, ring: CircleDot, injection: Syringe };
const VARIANTS = {
  patch: [{ key: "patchStandard", pillsPerPack: 21, placebo: 0, breakDays: 7 }, { key: "patchSix", pillsPerPack: 42, placebo: 0, breakDays: 7 }],
  ring: [{ key: "ringStandard", pillsPerPack: 21, placebo: 0, breakDays: 7 }, { key: "ringNoBreak", pillsPerPack: 21, placebo: 0, breakDays: 0 }],
} as const;
const INTERVALS = [56, 84, 91];
/** The injection: the day of the last one given (a cycle start since then may be overdue, not given). */
function lastInjectionOf(p: Plan, today: string) {
  let day = slot(p, today).packStart;
  while (day > p.packStart && !isTaken(p, day)) day = addDays(day, -cycleLength(p));
  return day;
}
const layoutOf = (l: Layout): Layout => ({ pillsPerPack: l.pillsPerPack, placebo: l.placebo, breakDays: l.breakDays });
const defaultLayout = (m: Method): Layout =>
  layoutOf(m === "pill" ? PRESETS[0] : m === "injection" ? { pillsPerPack: 84, placebo: 0, breakDays: 0 } : VARIANTS[m][0]);

export function ScheduleWizard({ uid, pid, current, width, onBack }: {
  uid: string; pid: string; current: Profile | null; width: number; onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const existing = hasSchedule(current) ? current : null;
  const tz = deviceTz();
  const today = dayKey(Date.now(), tz);
  const [step, setStep] = useState(0);
  const [method, setMethodState] = useState<Method>(existing ? methodOf(existing) : "pill");
  const [name, setName] = useState(existing?.name ?? "");
  const [layout, setLayout] = useState<Layout>(layoutOf(existing ?? PRESETS[0]));
  const [custom, setCustom] = useState(!!existing && methodOf(existing) === "pill" && !presetOf(existing));
  const [todayIndex, setTodayIndex] = useState(existing ? slot(existing, today).index : 0);
  // The injection: the day of the last one (the current cycle's start).
  const [lastInjection, setLastInjection] = useState(existing && methodOf(existing) === "injection" ? lastInjectionOf(existing, today) : today);
  const existingTaken = existing && today in existing.takenDays ? existing.takenDays[today] : null;
  const [takenMode, setTakenMode] = useState<"no" | "now" | "earlier">(existingTaken === null ? "no" : "earlier");
  const [time, setTime] = useState(existing?.time ?? defaultTime());
  const [repeatMinutes, setRepeat] = useState(existing?.repeatMinutes ?? 30);
  const [lateMinutes, setLate] = useState(existing?.lateMinutes ?? 60);
  const [reminderText, setReminderText] = useState(existing?.reminderText ?? "");
  const setMethod = (m: Method) => {
    setMethodState(m);
    if (m === method) return;
    const same = existing && methodOf(existing) === m;
    setLayout(same ? layoutOf(existing) : defaultLayout(m));
    setCustom(!!same && m === "pill" && !presetOf(existing));
    setTodayIndex(same ? slot(existing, today).index : 0);
  };
  const steps = method === "injection" ? 3 : 4;

  const cycle = layout.pillsPerPack + layout.breakDays;
  const index = Math.min(todayIndex, cycle - 1); // the layout may have shrunk since the day was picked
  const plan: Plan = useMemo(() => {
    const takenDays = { ...existing?.takenDays };
    delete takenDays[today];
    const packStart = method === "injection" ? lastInjection : addDays(today, -index);
    const tracking = (existing && methodOf(existing) === method && existing.trackingSince) || today;
    const trackingSince = method === "injection" && lastInjection < tracking ? lastInjection : tracking;
    return { ...layout, method, packStart, trackingSince, time, tz, repeatMinutes, lateMinutes, takenDays };
  }, [layout, method, index, lastInjection, existing, today, time, tz, repeatMinutes, lateMinutes]);
  const todayAction = method === "injection" ? null : actionOn(plan, today);
  const [earlier, setEarlier] = useState(existingTaken || defaultEarlier(plan, today));
  // Preview of the pack as it will be saved (past days keep their real marks).
  const preview = useMemo(() => packCells({ ...plan, takenDays: takenMode !== "no" && todayAction ? { ...plan.takenDays, [today]: "" } : plan.takenDays }, today),
    [plan, takenMode, todayAction, today]);
  const futureInjection = method === "injection" && lastInjection > today;

  const save = () => {
    const takenTodayAt = !todayAction || takenMode === "no" ? null : takenMode === "now" ? clock(Date.now(), tz) : earlier;
    queued(saveSchedule(uid, pid, {
      method, name, ...layout, todayIndex: index, start: method === "injection" ? lastInjection : undefined, takenTodayAt, time, repeatMinutes, lateMinutes, reminderText,
    }, current));
    toast(t.scheduleSaved);
    onBack();
  };

  const setPart = (part: Partial<Layout>) => setLayout((l) => {
    const next = { ...l, ...part };
    return { ...next, placebo: Math.min(next.placebo, next.pillsPerPack - 1) };
  });
  const header = (
    <>
      <Header title={existing ? t.editTitle : t.createTitle} subtitle={t.step({ n: step + 1, total: steps })} onBack={step === 0 ? onBack : () => setStep(step - 1)} />
      <StepBar step={step} total={steps} />
    </>
  );
  const next = <Button title={t.next} icon={ArrowRight} onPress={() => setStep(step + 1)} disabled={step === 1 && futureInjection} style={{ marginTop: 22 }} />;

  if (step === 0) return (
    <View>
      {header}
      <Text style={[s.h2, { marginTop: 24 }]}>{t.methodQuestion}</Text>
      {METHODS.map((m) => {
        const Icon = METHOD_ICON[m];
        return (
          <OptionCard key={m} title={t.methods[m].name} selected={method === m} onPress={() => setMethod(m)}
            icon={<LinearGradient colors={G.primary} style={st.methodIcon}><Icon size={20} color={C.white} strokeWidth={2.3} /></LinearGradient>}>
            <Text style={[s.small, { marginTop: 6 }]}>{t.methods[m].desc}</Text>
          </OptionCard>
        );
      })}
      <Card>
        <Field label={t.nameLabel} icon={Tag} value={name} onChangeText={setName} maxLength={30} placeholder={method === "pill" ? pid : t.methods[method].name} />
      </Card>
      {next}
    </View>
  );

  if (step === 1) return (
    <View>
      {header}
      {method === "pill" && <>
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
      </>}
      {(method === "patch" || method === "ring") && <>
        <Text style={[s.h2, { marginTop: 24 }]}>{t.variantQuestion}</Text>
        {VARIANTS[method].map((v) => (
          <OptionCard key={v.key} title={t[v.key]} selected={layout.pillsPerPack === v.pillsPerPack && layout.breakDays === v.breakDays} onPress={() => setLayout(layoutOf(v))}>
            <LayoutBar layout={v} />
          </OptionCard>
        ))}
        {(layout.pillsPerPack !== 21 || layout.breakDays !== 7) && (
          <Text style={[s.small, { color: C.warning, marginTop: 12 }]}>{t.continuousNote}</Text>
        )}
      </>}
      {method === "injection" && <>
        <Card style={{ marginTop: 22 }}>
          <Text style={s.h2}>{t.injectionIntervalQuestion}</Text>
          <ChipGroup options={INTERVALS.map((d) => ({ label: t.everyWeeks({ n: d / 7 }), value: d }))} value={layout.pillsPerPack}
            onChange={(d) => setLayout({ pillsPerPack: d, placebo: 0, breakDays: 0 })} />
          <Text style={[s.small, { marginTop: 10 }]}>{t.injectionIntervalHint}</Text>
        </Card>
        <Card>
          <Text style={s.h2}>{t.lastInjectionQuestion}</Text>
          <DatePicker value={lastInjection} min={addDays(today, -120)} onChange={setLastInjection} />
          <Text style={[s.body, F.bold, { textAlign: "center", marginTop: 8, color: futureInjection ? C.danger : C.text }]}>
            {futureInjection ? t.futureNotAllowed : formatDay(lastInjection, lang)}
          </Text>
        </Card>
      </>}
      {next}
    </View>
  );

  if (step === 2 && method !== "injection") return (
    <View>
      {header}
      <Card style={{ marginTop: 22 }}>
        <Text style={s.h2}>{method === "pill" ? t.todayQuestion : t.positionQuestion}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{method === "pill" ? t.todayHint : method === "patch" ? t.positionHintPatch : t.positionHintRing}</Text>
        {method === "pill"
          ? <View style={{ alignItems: "center", marginTop: 16 }}>
              <Blister cells={preview.cells} startWeekday={preview.startWeekday} width={Math.min(width - 82, 440)} onPressCell={setTodayIndex} />
            </View>
          : <CyclePicker plan={plan} index={index} today={today} onPick={setTodayIndex} />}
      </Card>
      {todayAction && (
        <Card>
          <Toggle label={t.doneTodayToggle[actionKey(plan, todayAction)]} value={takenMode !== "no"} onChange={(v) => setTakenMode(v ? "now" : "no")} />
          {takenMode !== "no" && <>
            <ChipGroup options={[{ label: t.takenNow({ time: clock(Date.now(), tz) }), value: "now" }, { label: t.takenEarlier, value: "earlier" }]}
              value={takenMode} onChange={setTakenMode} />
            {takenMode === "earlier" && <EarlierPicker plan={plan} day={today} value={earlier} onChange={setEarlier} />}
          </>}
        </Card>
      )}
      {next}
    </View>
  );

  const pill = method === "pill";
  const lateText = lateMinutes === 0 ? "" : pill ? (lateMinutes < 60 ? t.minutes({ n: lateMinutes }) : t.hours({ n: lateMinutes / 60 })) : method === "injection" ? t.lateAWeek : t.lateADay;
  const MethodIcon = METHOD_ICON[method];
  return (
    <View>
      {header}
      <Card style={{ marginTop: 22 }}>
        <Text style={s.h2}>{pill ? t.timeQuestion : t.timeQuestionMethod}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{pill ? t.timeHint : t.timeHintMethod}</Text>
        <TimeDial value={time} onChange={setTime} />
      </Card>
      <Card>
        <SettingTitle icon={Repeat} title={t.repeatLabel} />
        <ChipGroup options={[0, 15, 30, 60].map((n) => ({ label: n ? t.minutes({ n }) : t.off, value: n }))} value={repeatMinutes} onChange={setRepeat} />
        <View style={{ height: 22 }} />
        {pill ? <>
          <SettingTitle icon={Users} title={t.lateLabel} />
          <ChipGroup options={[0, 30, 60, 120].map((n) => ({ label: !n ? t.off : n < 60 ? t.minutes({ n }) : t.hours({ n: n / 60 }), value: n }))} value={lateMinutes} onChange={setLate} />
        </> : <Toggle label={method === "injection" ? t.lateLabelInjection : t.lateLabelPatchRing} value={lateMinutes > 0} onChange={(v) => setLate(v ? 60 : 0)} />}
      </Card>
      <Card>
        <SettingTitle icon={MessageSquareText} title={t.reminderTextLabel} />
        <Text style={[s.small, { marginTop: 6 }]}>{t.reminderTextHint}</Text>
        <Field label={`${textLength(reminderText)} / ${REMINDER_TEXT_MAX}`} value={reminderText} placeholder={pill ? t.defaultReminderTitle : t.mascotActionReminder.change}
          onChangeText={(v) => setReminderText([...v].slice(0, REMINDER_TEXT_MAX).join(""))} />
        <Text style={[s.label, { marginTop: 16 }]}>{t.preview}</Text>
        <View style={st.preview}>
          <LinearGradient colors={G.primary} style={st.previewIcon}><MethodIcon size={16} color={C.white} strokeWidth={2.4} /></LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={[s.small, F.bold, { color: C.text }]} numberOfLines={2}>{reminderText.trim() || (pill ? t.defaultReminderTitle : t.methods[method].name)}</Text>
            {!reminderText.trim() && <Text style={s.small}>{pill ? t.defaultReminderBody : t.timeQuestionMethod}</Text>}
          </View>
          <Text style={[s.small, { color: C.muted }]}>{time}</Text>
        </View>
      </Card>
      <View style={st.summary}>
        <BellRing size={18} color={C.primaryDeep} strokeWidth={2.4} />
        <Text style={[s.small, F.semibold, { flex: 1, color: C.text, lineHeight: 19 }]}>
          {(pill ? t.scheduleSummary : t.scheduleSummaryMethod)({ time, repeat: repeatMinutes, late: lateText })}
        </Text>
      </View>
      <Button title={existing ? t.saveChanges : t.startSchedule} icon={Check} onPress={save} style={{ marginTop: 22 }} />
    </View>
  );
}

/** Patch / ring: one row per week of the cycle (label + 7 days); tap today's day. */
function CyclePicker({ plan, index, today, onPick }: { plan: Plan; index: number; today: string; onPick: (i: number) => void }) {
  const { t, lang } = useI18n();
  const weeks = (plan.pillsPerPack + plan.breakDays) / 7;
  const wearWeeks = plan.pillsPerPack / 7;
  const patch = methodOf(plan) === "patch";
  const next = nextAction(plan, addDays(today, 1));
  return (
    <View style={{ marginTop: 16, gap: 8 }}>
      {Array.from({ length: weeks }, (_, w) => (
        <View key={w} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={[s.small, F.bold, { width: 74 }]} numberOfLines={1}>
            {w >= wearWeeks ? (patch ? t.weekPatchFree : t.weekRingFree) : patch ? t.weekPatch({ n: w + 1 }) : t.weekRing({ n: w + 1 })}
          </Text>
          {Array.from({ length: 7 }, (_, d) => {
            const i = w * 7 + d;
            const selected = i === index;
            const date = addDays(today, i - index);
            const free = w >= wearWeeks;
            return (
              <Pressable key={d} onPress={() => onPick(i)} accessibilityRole="button" accessibilityLabel={formatDay(date, lang)} accessibilityState={{ selected }}
                style={[st.cycleDay, free && st.cycleDayFree, actionOn(plan, date) && !selected && st.cycleDayAction, selected && st.cycleDaySelected]}>
                <Text style={[F.bold, { fontSize: 11, color: selected ? C.white : C.textSoft }]}>{t.weekdays[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7].slice(0, 2)}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {next && <Text style={[s.small, F.semibold, { marginTop: 6, color: C.primaryDeep }]}>{t.nextOn({ what: t.actionNext[actionKey(plan, next.action)], day: formatDay(next.day, lang) })}</Text>}
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

const st = themedStyles(() => ({
  option: { backgroundColor: C.card, borderRadius: R.lg, padding: 16, marginTop: 10, borderWidth: 1.5, borderColor: C.border },
  optionSelected: { borderColor: C.primary, backgroundColor: C.primaryTint },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.switchOff },
  stepSeg: { flex: 1, height: 5, borderRadius: 3, backgroundColor: C.border },
  preview: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: C.segment, borderRadius: R.md, padding: 12 },
  previewIcon: { width: 32, height: 32, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  summary: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: C.primarySoft, borderRadius: R.lg, padding: 16, marginTop: 16 },
  methodIcon: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cycleDay: { flex: 1, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: C.primarySoft },
  cycleDayFree: { backgroundColor: "transparent", borderWidth: 1.5, borderStyle: "dashed", borderColor: C.placeboStroke },
  cycleDayAction: { borderWidth: 2, borderColor: C.primary },
  cycleDaySelected: { backgroundColor: C.primary, borderColor: C.primary },
}));
