import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Blister, packStartWeekday } from "./Blister";
import { notify } from "./dialog";
import { useI18n } from "./i18n";
import { Button, C, Card, errorText, Field, Header, queued, s, Stepper } from "./ui";
import { TimeField } from "./TimeField";
import { hasSchedule, normalizeId, saveSchedule, setPassword, subscribe, takenToday, type Profile } from "./data";


export function PasswordForm({ pid, hasPassword, onSaved, onBack }: { pid: string; hasPassword: boolean; onSaved: () => void; onBack: () => void }) {
  const { t } = useI18n();
  const [password, setPw] = useState("");
  const [repeat, setRepeat] = useState("");
  const valid = password.length >= 6 && password === repeat;

  const save = () => {
    queued(setPassword(pid, password));
    notify(t.passwordSaved, t.passwordSavedBody({ pid }));
    onSaved();
  };

  return (
    <View>
      <Header title={hasPassword ? t.changePassword : t.setPassword} onBack={onBack} />
      <Text style={s.muted}>{t.passwordIntro({ pid })}{hasPassword ? ` ${t.passwordKeepAccess}` : ""}</Text>
      <Card>
        <Field label={t.passwordLabel} value={password} onChangeText={setPw} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t.passwordRepeat} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={() => valid && save()} />
        {repeat.length > 0 && password !== repeat && <Text style={[s.muted, { marginTop: 8 }]}>{t.passwordMismatch}</Text>}
        <Button title={t.passwordSave} onPress={save} disabled={!valid} style={{ marginTop: 18 }} />
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
    setBusy(true);
    try {
      await subscribe(uid, pid, password);
      notify(t.subscribed, t.subscribedBody({ pid }));
      onBack();
    } catch (e) {
      notify(t.errorTitle, errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      <Header title={t.followTitle} onBack={onBack} />
      <Text style={s.muted}>{t.followIntro}</Text>
      <Card>
        <Field label={t.idLabel} value={id} onChangeText={setId} autoCapitalize="characters" autoCorrect={false} maxLength={8} placeholder={t.idPlaceholder} />
        <Field label={t.passwordField} value={password} onChangeText={setPw} secureTextEntry autoCapitalize="none" onSubmitEditing={() => valid && save()} />
        {pid === ownPid && <Text style={[s.muted, { marginTop: 8 }]}>{t.ownIdHint}</Text>}
        <Button title={t.subscribe} onPress={save} disabled={!valid} busy={busy} style={{ marginTop: 18 }} />
      </Card>
    </View>
  );
}

const defaultTime = () => `${String(new Date().getHours()).padStart(2, "0")}:00`;

export function ScheduleWizard({ uid, pid, current, width, onBack }: {
  uid: string; pid: string; current: Profile | null; width: number; onBack: () => void;
}) {
  const { t } = useI18n();
  const existing = hasSchedule(current) ? current : null;
  const [step, setStep] = useState(0);
  const [name, setName] = useState(existing?.name ?? "");
  const [count, setCount] = useState(existing?.pillsPerPack ?? 21);
  const [taken, setTaken] = useState(existing?.taken ?? 0);
  const [time, setTime] = useState(existing?.time ?? defaultTime());

  const save = () => {
    queued(saveSchedule(uid, pid, { name, pillsPerPack: count, taken, time }, current));
    onBack();
  };

  const header = (
    <>
      <Header title={existing ? t.editTitle : t.createTitle} onBack={step === 0 ? onBack : () => setStep(step - 1)} />
      <Text style={[s.muted, { marginTop: 2 }]}>{t.step({ n: step + 1 })}</Text>
    </>
  );

  if (step === 0) return (
    <View>
      {header}
      <Card>
        <Text style={s.h2}>{t.pillsQuestion}</Text>
        <Stepper value={count} min={1} max={42} onChange={setCount} />
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 12 }}>
          {[21, 24, 28].map((n) => (
            <Pressable key={n} onPress={() => setCount(n)} style={[chip, n === count && chipActive]} accessibilityRole="button">
              <Text style={{ color: n === count ? "#FFF" : C.primaryDark, fontWeight: "700" }}>{n}</Text>
            </Pressable>
          ))}
        </View>
        <Field label={t.nameLabel} value={name} onChangeText={setName} maxLength={30} placeholder={pid} />
        <Button title={t.next} onPress={() => { setTaken(Math.min(taken, count)); setStep(1); }} style={{ marginTop: 18 }} />
      </Card>
    </View>
  );

  if (step === 1) return (
    <View>
      {header}
      <Card>
        <Text style={s.h2}>{t.takenQuestion}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{t.takenHint}</Text>
        <View style={{ alignItems: "center", marginTop: 14 }}>
          <Blister count={count} taken={taken} width={Math.min(width - 72, 420)}
            onPressPill={(i) => setTaken(i + 1 === taken ? i : i + 1)}
            startWeekday={packStartWeekday(taken, existing ? takenToday(existing) : false)} />
        </View>
        <Stepper value={taken} min={0} max={count} onChange={setTaken} />
        <Text style={[s.muted, { textAlign: "center" }]}>{t.takenLeft({ taken, left: count - taken })}</Text>
        <Button title={t.next} onPress={() => setStep(2)} style={{ marginTop: 18 }} />
      </Card>
    </View>
  );

  return (
    <View>
      {header}
      <Card>
        <Text style={s.h2}>{t.timeQuestion}</Text>
        <Text style={[s.muted, { marginTop: 4, marginBottom: 16 }]}>{t.timeHint}</Text>
        <TimeField value={time} onChange={setTime} />
        <Button title={existing ? t.saveChanges : t.startSchedule} onPress={save} style={{ marginTop: 22 }} />
      </Card>
    </View>
  );
}

const chip = { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: C.primarySoft };
const chipActive = { backgroundColor: C.primary };
