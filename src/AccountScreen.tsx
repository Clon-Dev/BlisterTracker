import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import type { User } from "firebase/auth";
import { AlertCircle, BadgeCheck, ChevronRight, KeyRound, Lock, LogOut, Mail, MailWarning, SunMoon, Trash2, type LucideIcon } from "lucide-react-native";
import { authErrorText, changeEmail, changePassword, deleteAccount, logout, resendVerification } from "./auth";
import { deleteAccountData, removeToken, type Account } from "./data";
import { useI18n } from "./i18n";
import { confirm, openSheet, SheetIcon, toast } from "./sheets";
import { C, F, G, R, setAppearance, themedStyles, useAppearance, type Appearance } from "./theme";
import { Badge, Button, Card, ChipGroup, Field, Header, s } from "./ui";

export function AccountScreen({ user, account, pushToken, onBack }: {
  user: User; account: Account; pushToken: string | null; onBack: () => void;
}) {
  const { t } = useI18n();
  const appearance = useAppearance();

  const signOutDevice = async () => {
    if (!(await confirm({ title: t.logoutTitle, message: t.logoutBody, confirmLabel: t.logout, icon: LogOut }))) return;
    // Detach this device's push token first (needs the login). Offline, the write can't be confirmed,
    // so don't wait for it forever; the worker also prunes tokens that stop working.
    if (pushToken) await Promise.race([removeToken(user.uid, pushToken), new Promise((r) => setTimeout(r, 4000))]);
    await logout();
  };

  return (
    <View>
      <Header title={t.account} onBack={onBack} />
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <LinearGradient colors={G.avatar} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
            <Text style={[F.extrabold, { color: C.white, fontSize: 22 }]}>{(user.email ?? "?").slice(0, 1).toUpperCase()}</Text>
          </LinearGradient>
          <View style={{ flex: 1, gap: 6 }}>
            <Text style={s.small}>{t.signedInAs}</Text>
            <Text style={[s.body, F.bold]} numberOfLines={1} selectable>{user.email}</Text>
            {user.emailVerified
              ? <Badge tone="success" icon={BadgeCheck} label={t.emailConfirmed} />
              : <Badge tone="danger" icon={MailWarning} label={t.emailUnconfirmed} />}
          </View>
        </View>
        {!user.emailVerified && (
          <Button title={t.verifyResend} kind="secondary" compact icon={Mail}
            onPress={() => resendVerification(user).then(() => toast(t.verifySent), (e) => toast(authErrorText(e), "error"))} />
        )}
      </Card>

      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <SunMoon size={19} color={C.primaryDeep} strokeWidth={2.3} />
          <Text style={[s.body, F.bold]}>{t.appearance}</Text>
        </View>
        <ChipGroup<Appearance> value={appearance} onChange={setAppearance} options={[
          { label: t.appearanceSystem, value: "system" }, { label: t.appearanceLight, value: "light" }, { label: t.appearanceDark, value: "dark" },
        ]} />
      </Card>

      <Card style={{ padding: 6 }}>
        <Row icon={Mail} title={t.changeEmail} onPress={() => openSheet((done) => <ChangeEmailSheet user={user} done={done} />)} />
        <Row icon={KeyRound} title={t.changeAccountPassword} onPress={() => openSheet((done) => <ChangePasswordSheet user={user} done={done} />)} />
        <Row icon={LogOut} title={t.logout} onPress={signOutDevice} last />
      </Card>

      <Card style={{ padding: 6 }}>
        <Row icon={Trash2} title={t.deleteAccount} danger last
          onPress={() => openSheet((done) => <DeleteSheet user={user} account={account} done={done} />)} />
      </Card>
    </View>
  );
}

function Row({ icon: Icon, title, onPress, danger, last }: { icon: LucideIcon; title: string; onPress: () => void; danger?: boolean; last?: boolean }) {
  return (
    <>
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title}
      style={({ pressed }) => [st.row, pressed && { backgroundColor: C.primaryTint }]}>
      <View style={[st.rowIcon, { backgroundColor: danger ? C.dangerSoft : C.primarySoft }]}>
        <Icon size={18} color={danger ? C.danger : C.primaryDeep} strokeWidth={2.4} />
      </View>
      <Text style={[s.body, F.semibold, { flex: 1, color: danger ? C.danger : C.text }]}>{title}</Text>
      <ChevronRight size={20} color={C.muted} strokeWidth={2.2} />
    </Pressable>
    {!last && <View style={st.rowDivider} />}
    </>
  );
}

/** Runs an auth action; keeps the sheet open with an inline error on failure. */
function useAuthAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } catch (e) { setError(authErrorText(e)); } finally { setBusy(false); }
  };
  const errorBox = error && (
    <View style={st.error}>
      <AlertCircle size={18} color={C.danger} strokeWidth={2.4} />
      <Text style={[s.small, F.semibold, { color: C.danger, flex: 1 }]}>{error}</Text>
    </View>
  );
  return { busy, run, errorBox };
}

function ChangeEmailSheet({ user, done }: { user: User; done: () => void }) {
  const { t } = useI18n();
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const { busy, run, errorBox } = useAuthAction();
  const valid = /^\S+@\S+\.\S+$/.test(newEmail.trim()) && password.length > 0;
  return (
    <View>
      <SheetIcon icon={Mail} />
      <Text style={s.h1}>{t.changeEmail}</Text>
      <Field label={t.newEmail} icon={Mail} value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
      <Field label={t.currentPassword} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
      {errorBox}
      <Button title={t.changeEmail} disabled={!valid} busy={busy} style={{ marginTop: 22 }} onPress={() => run(async () => {
        await changeEmail(user, password, newEmail);
        done();
        toast(t.changeEmailSent({ email: newEmail.trim() }));
      })} />
    </View>
  );
}

function ChangePasswordSheet({ user, done }: { user: User; done: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const { busy, run, errorBox } = useAuthAction();
  const valid = current.length > 0 && next.length >= 6 && next === repeat;
  return (
    <View>
      <SheetIcon icon={KeyRound} />
      <Text style={s.h1}>{t.changeAccountPassword}</Text>
      <Field label={t.currentPassword} icon={Lock} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
      <Field label={t.newPassword} icon={Lock} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
      <Field label={t.passwordRepeat} icon={Lock} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password"
        error={repeat.length > 0 && next !== repeat ? t.passwordMismatch : null} />
      {errorBox}
      <Button title={t.changeAccountPassword} disabled={!valid} busy={busy} style={{ marginTop: 22 }} onPress={() => run(async () => {
        await changePassword(user, current, next);
        done();
        toast(t.passwordChanged);
      })} />
    </View>
  );
}

function DeleteSheet({ user, account, done }: { user: User; account: Account; done: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const { busy, run, errorBox } = useAuthAction();
  return (
    <View>
      <SheetIcon icon={Trash2} tone="danger" />
      <Text style={s.h1}>{t.deleteAccount}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.deleteAccountBody}</Text>
      <Field label={t.currentPassword} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
      {errorBox}
      <Button title={t.deleteAccount} kind="danger" icon={Trash2} disabled={!password} busy={busy} style={{ marginTop: 22 }} onPress={() => run(async () => {
        await deleteAccount(user, password, () => deleteAccountData(user.uid, account));
        done();
      })} />
    </View>
  );
}

const st = themedStyles(() => ({
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 14, paddingVertical: 14, borderRadius: R.md },
  rowDivider: { height: 1, backgroundColor: C.border, marginLeft: 66, marginRight: 14 },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  error: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: C.dangerSoft, borderRadius: R.md, padding: 12, marginTop: 16 },
}));
