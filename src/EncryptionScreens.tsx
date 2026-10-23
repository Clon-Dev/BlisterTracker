// Unlocking the end-to-end encryption: unlock / set up screen, recovery code, follower share-key unlock.
import { useState } from "react";
import { Text, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import type { User } from "firebase/auth";
import { AlertCircle, Copy, KeyRound, LifeBuoy, Lock, LockKeyhole, LogOut, ShieldCheck } from "lucide-react-native";
import { logout, verifyPassword } from "./auth";
import { unlockFollowedNotes } from "./data";
import { useI18n } from "./i18n";
import { createKeyring, forgetKey, unlockWithPassword, unlockWithRecovery } from "./keys";
import { confirm, openSheet, SheetIcon, toast } from "./sheets";
import { C, F, R, themedStyles } from "./theme";
import { Button, Card, Field, LinkButton, s, Toggle } from "./ui";

type Mode = "unlock" | "setup" | "recover";

/**
 * Shown when this device has no unlocked key: "unlock" with the account password, "setup" for accounts from
 * before encryption, "recover" when the password was changed elsewhere (e.g. "forgot password").
 * `onReady(recoveryCode)` gets a code when a new keyring was created (to show once).
 */
export function UnlockScreen({ user, hasKeyring, initialMode, knownPassword, onReady }: {
  user: User; hasKeyring: boolean; initialMode?: Mode;
  /** The password of the login that just happened (recovery re-wraps the keyring with it). */
  knownPassword?: string;
  onReady: (recoveryCode: string | null) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>(initialMode ?? (hasKeyring ? "unlock" : "setup"));
  const [password, setPassword] = useState(knownPassword ?? "");
  const [passwordVerified, setPasswordVerified] = useState(!!knownPassword);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await work(); } finally { setBusy(false); }
  };

  const submitPassword = () => run(async () => {
    if (!(await verifyPassword(user, password))) { setError(t.authInvalid); return; }
    setPasswordVerified(true);
    if (mode === "setup") { onReady(await createKeyring(user.uid, password)); return; }
    try {
      await unlockWithPassword(user.uid, password);
      onReady(null);
    } catch {
      setMode("recover"); // the account password is right but doesn't open the keyring: it was reset
    }
  });

  const submitCode = () => run(async () => {
    // The keyring gets re-wrapped with the current account password, so it must be the right one.
    if (!passwordVerified && !(await verifyPassword(user, password))) { setError(t.authInvalid); return; }
    setPasswordVerified(true);
    try {
      await unlockWithRecovery(user.uid, code, password);
      onReady(null);
    } catch {
      setError(t.invalidRecoveryCode);
    }
  });

  const startFresh = async () => {
    if (!passwordVerified && !(await verifyPassword(user, password))) { setError(t.authInvalid); return; }
    if (!(await confirm({ title: t.startFreshTitle, message: t.startFreshBody, confirmLabel: t.startFresh, destructive: true, icon: AlertCircle }))) return;
    await run(async () => onReady(await createKeyring(user.uid, password)));
  };

  const icon = mode === "recover" ? LifeBuoy : mode === "setup" ? ShieldCheck : LockKeyhole;
  return (
    <View style={{ marginTop: 30 }}>
      <Card>
        <SheetIcon icon={icon} tone={mode === "recover" ? "warning" : "primary"} />
        <Text style={s.h1}>{mode === "unlock" ? t.unlockTitle : mode === "setup" ? t.setupEncryptionTitle : t.recoverTitle}</Text>
        <Text style={[s.muted, { marginTop: 8 }]}>{mode === "unlock" ? t.unlockBody : mode === "setup" ? t.setupEncryptionBody : t.recoverBody}</Text>
        {mode === "recover" ? (
          <>
            {!passwordVerified && (
              <Field label={t.accountPassword} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
            )}
            <Field label={t.recoveryCodeLabel} icon={LifeBuoy} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false}
              placeholder="XXXX-XXXX-XXXX-…" onSubmitEditing={submitCode} />
            {error && <ErrorBox text={error} />}
            <Button title={t.recoverButton} icon={KeyRound} disabled={code.replace(/[^A-Za-z0-9]/g, "").length < 26 || !password} busy={busy} onPress={submitCode} style={{ marginTop: 20 }} />
            <LinkButton title={t.startFresh} color={C.danger} onPress={startFresh} />
          </>
        ) : (
          <>
            <Field label={t.accountPassword} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none"
              autoComplete="current-password" onSubmitEditing={submitPassword} />
            {error && <ErrorBox text={error} />}
            <Button title={mode === "setup" ? t.setupEncryptionButton : t.unlockButton} icon={KeyRound} disabled={!password} busy={busy}
              onPress={submitPassword} style={{ marginTop: 20 }} />
          </>
        )}
      </Card>
      <LinkButton title={t.logout} icon={LogOut} color={C.textSoft} onPress={() => { forgetKey(user.uid).then(logout); }} />
    </View>
  );
}

const ErrorBox = ({ text }: { text: string }) => (
  <View style={st.error}>
    <AlertCircle size={18} color={C.danger} strokeWidth={2.4} />
    <Text style={[s.small, F.semibold, { color: C.danger, flex: 1 }]}>{text}</Text>
  </View>
);

/** Shows a (new) recovery code once, with copy and an "I've saved it" confirmation. */
export function openRecoveryCodeSheet(code: string) {
  return openSheet<void>((done) => <RecoveryCodeSheet code={code} done={done} />);
}

function RecoveryCodeSheet({ code, done }: { code: string; done: () => void }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState(false);
  return (
    <View>
      <SheetIcon icon={ShieldCheck} tone="success" />
      <Text style={s.h1}>{t.recoveryCodeTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.recoveryCodeBody}</Text>
      <View style={st.code}>
        <Text selectable style={st.codeText} testID="recovery-code">{code}</Text>
      </View>
      <Button title={t.copyCode} kind="secondary" icon={Copy} compact onPress={() => Clipboard.setStringAsync(code).then(() => toast(t.codeCopied))} />
      <Toggle label={t.recoveryCodeSaved} value={saved} onChange={setSaved} />
      <Button title={t.done} disabled={!saved} onPress={() => done()} style={{ marginTop: 18 }} />
    </View>
  );
}

/** Follower: enter the sharing password once to read a schedule's encrypted shared notes. */
export function openUnlockSharedSheet(uid: string, pid: string, name: string) {
  return openSheet<void>((done) => <UnlockSharedSheet uid={uid} pid={pid} name={name} done={done} />);
}

function UnlockSharedSheet({ uid, pid, name, done }: { uid: string; pid: string; name: string; done: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlockFollowedNotes(uid, pid, password);
      done();
      toast(t.sharedUnlocked);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <SheetIcon icon={LockKeyhole} />
      <Text style={s.h1}>{t.unlockSharedTitle({ name })}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.unlockSharedBody({ name })}</Text>
      <Field label={t.passwordField} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" onSubmitEditing={submit} />
      {error && <ErrorBox text={error} />}
      <Button title={t.unlockButton} icon={KeyRound} disabled={!password} busy={busy} onPress={submit} style={{ marginTop: 20 }} />
    </View>
  );
}

const st = themedStyles(() => ({
  error: { flexDirection: "row" as const, gap: 10, alignItems: "center" as const, backgroundColor: C.dangerSoft, borderRadius: R.md, padding: 12, marginTop: 16 },
  code: { backgroundColor: C.segment, borderRadius: R.md, padding: 16, marginTop: 18, alignItems: "center" as const },
  codeText: { ...F.extrabold, fontSize: 19, color: C.text, letterSpacing: 1.5, textAlign: "center" as const, lineHeight: 30 },
}));
