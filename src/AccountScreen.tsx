import { useState } from "react";
import { Text, View } from "react-native";
import type { User } from "firebase/auth";
import { authErrorText, changeEmail, changePassword, deleteAccount, logout, resendVerification } from "./auth";
import { deleteAccountData, removeToken, type Account } from "./data";
import { confirm, notify } from "./dialog";
import { useI18n } from "./i18n";
import { Button, C, Card, Field, Header, LinkButton, s } from "./ui";

/** Runs one account action at a time; shows auth errors in the app language. */
function useAction() {
  const { t } = useI18n();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (name: string, work: () => Promise<void>) => {
    setBusy(name);
    try { await work(); } catch (e) { notify(t.errorTitle, authErrorText(e)); } finally { setBusy(null); }
  };
  return [busy, run] as const;
}

export function AccountScreen({ user, account, pushToken, onBack }: {
  user: User; account: Account; pushToken: string | null; onBack: () => void;
}) {
  const { t } = useI18n();
  const [busy, run] = useAction();
  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  const signOutDevice = () => run("logout", async () => {
    if (!(await confirm(t.logoutTitle, t.logoutBody, t.logout))) return;
    // Detach this device's push token first (needs the login). Offline, the write can't be confirmed,
    // so don't wait for it forever; the worker also prunes tokens that stop working.
    if (pushToken) await Promise.race([removeToken(user.uid, pushToken), new Promise((r) => setTimeout(r, 4000))]);
    await logout();
  });

  return (
    <View>
      <Header title={t.account} onBack={onBack} />
      <Card>
        <Text style={s.muted}>{t.signedInAs}</Text>
        <Text style={[s.h2, { marginTop: 2 }]} selectable>{user.email}</Text>
        <Text style={{ marginTop: 4, fontWeight: "600", color: user.emailVerified ? C.success : C.muted }}>
          {user.emailVerified ? `✓ ${t.emailConfirmed}` : t.emailUnconfirmed}
        </Text>
        {!user.emailVerified && (
          <LinkButton title={t.verifyResend} onPress={() => run("verify", async () => { await resendVerification(user); notify(t.verifySent); })} />
        )}
      </Card>

      <Card>
        <Text style={s.h2}>{t.changeEmail}</Text>
        <Field label={t.newEmail} value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label={t.currentPassword} value={emailPassword} onChangeText={setEmailPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
        <Button title={t.changeEmail} kind="secondary" busy={busy === "email"} disabled={!/^\S+@\S+\.\S+$/.test(newEmail.trim()) || !emailPassword}
          onPress={() => run("email", async () => {
            await changeEmail(user, emailPassword, newEmail);
            notify(t.changeEmail, t.changeEmailSent({ email: newEmail.trim() }));
            setNewEmail(""); setEmailPassword("");
          })} />
      </Card>

      <Card>
        <Text style={s.h2}>{t.changeAccountPassword}</Text>
        <Field label={t.currentPassword} value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
        <Field label={t.newPassword} value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        <Field label={t.passwordRepeat} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password" />
        {repeat.length > 0 && next !== repeat && <Text style={[s.muted, { marginTop: 8 }]}>{t.passwordMismatch}</Text>}
        <Button title={t.changeAccountPassword} kind="secondary" busy={busy === "password"} disabled={!current || next.length < 6 || next !== repeat}
          onPress={() => run("password", async () => {
            await changePassword(user, current, next);
            notify(t.passwordChanged);
            setCurrent(""); setNext(""); setRepeat("");
          })} />
      </Card>

      <Button title={t.logout} kind="secondary" onPress={signOutDevice} busy={busy === "logout"} style={{ marginTop: 22 }} />

      <Card style={{ marginTop: 30, borderColor: "#F1C9C9" }}>
        <Text style={[s.h2, { color: "#B33A3A" }]}>{t.deleteAccount}</Text>
        <Text style={[s.muted, { marginTop: 4 }]}>{t.deleteAccountBody}</Text>
        <Field label={t.currentPassword} value={deletePassword} onChangeText={setDeletePassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
        <Button title={t.deleteAccount} busy={busy === "delete"} disabled={!deletePassword} style={{ backgroundColor: "#B33A3A", marginTop: 14 }}
          onPress={() => run("delete", async () => {
            if (!(await confirm(t.deleteAccount, t.deleteAccountBody, t.deleteConfirm))) return;
            await deleteAccount(user, deletePassword, () => deleteAccountData(user.uid, account));
          })} />
      </Card>
    </View>
  );
}
