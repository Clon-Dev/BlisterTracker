import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as Clipboard from "expo-clipboard";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./src/firebase";
import { AccountScreen } from "./src/AccountScreen";
import { setAuthLanguage, resendVerification } from "./src/auth";
import { AuthScreen } from "./src/AuthScreen";
import { Blister, packStartWeekday } from "./src/Blister";
import {
  dayKey, ensureAccount, fetchHasPassword, hasSchedule, markTaken, packFinished, registerToken, setAccountLang,
  startNewPack, takenToday, unsubscribe, watchAccount, watchProfile, watchSubscriberCount,
  type Account, type Profile, type Schedule,
} from "./src/data";
import { confirm, notify } from "./src/dialog";
import { PasswordForm, ScheduleWizard, SubscribeForm } from "./src/Forms";
import { loadSavedLang, useI18n, type Strings } from "./src/i18n";
import { enablePush, pushStatus, type PushStatus } from "./src/push";
import { Button, C, Card, errorText, LanguageSwitch, LinkButton, queued, s } from "./src/ui";

type Screen = "home" | "password" | "subscribe" | "schedule" | "account";
type Followed = Profile | "denied" | undefined;

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
        <StatusBar style="dark" />
        <Root />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const scrollContent = { padding: 18, paddingBottom: 48, width: "100%", maxWidth: 520, alignSelf: "center" } as const;

const Loading = ({ text }: { text: string }) => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
    <ActivityIndicator size="large" color={C.primary} />
    <Text style={s.muted}>{text}</Text>
  </View>
);

/** Login gate: without an account only the login/register screen is shown. */
function Root() {
  const { t, lang } = useI18n();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => setAuthLanguage(lang), [lang]);
  useEffect(() => {
    let unsub = () => {};
    loadSavedLang().then(() => { unsub = onAuthStateChanged(auth, setUser); });
    return () => unsub();
  }, []);

  if (user === undefined) return <Loading text={t.loading} />;
  if (!user) return (
    <ScrollView contentContainerStyle={scrollContent} keyboardShouldPersistTaps="handled">
      <AuthScreen />
    </ScrollView>
  );
  return <Main key={user.uid} user={user} />;
}

/** Re-renders when the local date changes, so "taken today" flips at midnight even if the app stays open. */
function useToday() {
  const [today, setToday] = useState(() => dayKey(new Date()));
  useEffect(() => {
    const id = setInterval(() => setToday(dayKey(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

function Main({ user }: { user: User }) {
  const { t, lang } = useI18n();
  useToday();
  const uid = user.uid;
  const width = Math.min(useWindowDimensions().width, 520);
  const [account, setAccount] = useState<Account | null>(null);
  const [own, setOwn] = useState<Profile | null>(null);
  const [followed, setFollowed] = useState<Record<string, Followed>>({});
  const [passwordSet, setPasswordSet] = useState(false);
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [screen, setScreen] = useState<Screen>("home");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // The verification link is opened outside the app; re-check whenever the app comes back.
  useEffect(() => {
    if (emailVerified) return;
    const check = () => user.reload().then(() => setEmailVerified(user.emailVerified), () => undefined);
    check();
    const sub = AppState.addEventListener("change", (st) => st === "active" && check());
    return () => sub.remove();
  }, [user, emailVerified]);

  useEffect(() => {
    let unsub = () => {};
    ensureAccount(uid, lang)
      .then((a) => { setAccount(a); unsub = watchAccount(uid, setAccount); })
      .catch((e) => setError(errorText(e)));
    return () => unsub();
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- uid is fixed per Main; lang only seeds a new account

  // Notifications are sent in the account's language.
  useEffect(() => {
    if (account && account.lang !== lang) queued(setAccountLang(uid, lang));
  }, [uid, account?.lang, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const pid = account?.pid;
  useEffect(() => {
    if (!pid) return;
    const unsubs = [watchProfile(pid, setOwn), watchSubscriberCount(pid, setSubscriberCount)];
    fetchHasPassword(pid).then(setPasswordSet, () => undefined);
    return () => unsubs.forEach((u) => u());
  }, [pid]);

  // One live listener per followed schedule.
  const subsKey = account?.subs.join(",") ?? "";
  useEffect(() => {
    const pids = subsKey ? subsKey.split(",") : [];
    setFollowed((f) => Object.fromEntries(pids.map((p) => [p, f[p]])));
    const unsubs = pids.map((p) => watchProfile(p,
      (profile) => setFollowed((f) => ({ ...f, [p]: profile ?? "denied" })),
      () => setFollowed((f) => ({ ...f, [p]: "denied" }))));
    return () => unsubs.forEach((u) => u());
  }, [subsKey]);

  // Push: silently refresh the token when permission exists; `ask` comes from the button (a user gesture, required on iOS).
  const refreshPush = useCallback(async (ask: boolean) => {
    if (!account) return;
    const status = await pushStatus();
    setPush(status);
    if (status !== "granted" && !(ask && status === "default")) return;
    try {
      const token = await enablePush();
      setPush(await pushStatus());
      setPushToken(token);
      if (token) await registerToken(uid, account, token);
      else if (ask) notify(t.pushOffTitle, t.pushOffBody);
    } catch (e) {
      if (ask) notify(t.errorTitle, errorText(e));
    }
  }, [uid, account, t]);

  useEffect(() => { refreshPush(false); }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={s.h2}>{t.errorTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{error}</Text>
      <Button title={t.tryAgain} onPress={() => { setError(null); setAttempt((n) => n + 1); }} />
    </View>
  );
  if (!account) return <Loading text={t.loading} />;

  const home = () => setScreen("home");
  const schedule = hasSchedule(own) ? own : null;

  return (
    // key: each screen starts scrolled to the top.
    <ScrollView key={screen} contentContainerStyle={scrollContent} keyboardShouldPersistTaps="handled">
      {screen === "account" && <AccountScreen user={user} account={account} pushToken={pushToken} onBack={home} />}
      {screen === "password" && <PasswordForm pid={account.pid} hasPassword={passwordSet} onSaved={() => { setPasswordSet(true); home(); }} onBack={home} />}
      {screen === "subscribe" && <SubscribeForm uid={uid} ownPid={account.pid} onBack={home} />}
      {screen === "schedule" && <ScheduleWizard uid={uid} pid={account.pid} current={own} width={width} onBack={home} />}
      {screen === "home" && <>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
          <Text style={s.title}>Blister Buddy</Text>
          <LanguageSwitch />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={[s.muted, { flex: 1 }]} numberOfLines={1}>{user.email}</Text>
          <LinkButton title={`${t.account} ›`} onPress={() => setScreen("account")} />
        </View>

        <View style={{ backgroundColor: C.primary, borderRadius: 22, padding: 20, marginTop: 4 }}>
          <Text style={{ color: "#F9DCE7", fontSize: 13, fontWeight: "700", letterSpacing: 1 }}>{t.yourId}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <Text selectable style={{ color: "#FFF", fontSize: 36, fontWeight: "800", letterSpacing: 4 }} testID="personal-id">{account.pid}</Text>
            <Pressable onPress={() => Clipboard.setStringAsync(account.pid).then(() => notify(t.copied, t.copiedBody({ pid: account.pid })))}
              style={{ backgroundColor: "#FFFFFF33", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12 }} accessibilityRole="button">
              <Text style={{ color: "#FFF", fontWeight: "700" }}>{t.copy}</Text>
            </Pressable>
          </View>
          <Text style={{ color: "#FBE8EF", marginTop: 8, fontSize: 13, lineHeight: 18 }}>
            {passwordSet ? t.subscriberLine({ n: subscriberCount }) : t.noPasswordHint}
          </Text>
        </View>

        {!emailVerified && (
          <Card style={{ backgroundColor: "#FFF8E8", borderColor: "#F3E1B5" }}>
            <Text style={s.body}>{t.verifyBanner({ email: user.email ?? "" })}</Text>
            <LinkButton title={t.verifyResend} onPress={() => resendVerification(user).then(() => notify(t.verifySent), (e) => notify(t.errorTitle, errorText(e)))} />
          </Card>
        )}
        {push && <PushBanner status={push} t={t} onEnable={() => refreshPush(true)} />}

        <Button title={t.followSchedule} onPress={() => setScreen("subscribe")} style={{ marginTop: 16 }} />
        {/* Both of these concern your own schedule, so they sit together. */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button kind="secondary" title={schedule ? t.editSchedule : t.createSchedule} onPress={() => setScreen("schedule")} style={{ flex: 1 }} />
          <Button kind="secondary" title={passwordSet ? t.changePassword : t.setPassword} onPress={() => setScreen("password")} style={{ flex: 1 }} />
        </View>

        {schedule && (
          <OwnSchedule schedule={schedule} width={width} t={t}
            onTaken={async () => {
              if (await confirm(t.markTakenTitle, t.markTakenBody, t.markTakenOk)) queued(markTaken(account.pid, schedule));
            }}
            onNewPack={() => queued(startNewPack(account.pid, schedule))} />
        )}

        {account.subs.length > 0 && <Text style={[s.h2, { marginTop: 26 }]}>{t.following}</Text>}
        {account.subs.map((p) => (
          <FollowedSchedule key={p} pid={p} profile={followed[p]} width={width} t={t}
            onRemove={async () => {
              const f = followed[p];
              const name = (f && f !== "denied" && f.name) || p;
              if (await confirm(t.unsubscribeTitle, t.unsubscribeBody({ name }), t.unsubscribe)) queued(unsubscribe(uid, p));
            }} />
        ))}
      </>}
    </ScrollView>
  );
}

function PushBanner({ status, t, onEnable }: { status: PushStatus; t: Strings; onEnable: () => void }) {
  if (status === "granted") return null;
  const text = { default: t.pushDefault, denied: t.pushDenied, "needs-install": t.pushInstall, unsupported: t.pushUnsupported }[status];
  return (
    <Card style={{ backgroundColor: "#FFF8E8", borderColor: "#F3E1B5" }}>
      <Text style={s.body}>{text}</Text>
      {status === "default" && <Button title={t.pushEnable} onPress={onEnable} />}
    </Card>
  );
}

function StatusPill({ sch, t }: { sch: Schedule; t: Strings }) {
  const done = takenToday(sch) || packFinished(sch);
  const label = takenToday(sch) ? t.takenToday : packFinished(sch) ? t.packFinished : t.dueAt({ time: sch.time });
  return (
    <View style={{ alignSelf: "flex-start", backgroundColor: done ? C.successSoft : C.primarySoft, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, marginTop: 6 }}>
      <Text style={{ color: done ? C.success : C.primaryDark, fontWeight: "700", fontSize: 13 }}>{label}</Text>
    </View>
  );
}

function PackView({ sch, width }: { sch: Schedule; width: number }) {
  const done = takenToday(sch);
  return (
    <View style={{ alignItems: "center", marginTop: 14 }}>
      <Blister count={sch.pillsPerPack} taken={sch.taken} width={width}
        showNext={!done && !packFinished(sch)} startWeekday={packStartWeekday(sch.taken, done)} />
    </View>
  );
}

function OwnSchedule({ schedule, width, t, onTaken, onNewPack }: {
  schedule: Schedule; width: number; t: Strings; onTaken: () => void; onNewPack: () => void;
}) {
  const done = takenToday(schedule);
  return (
    <Card style={{ marginTop: 22 }}>
      <Text style={s.h2}>{t.myPack}</Text>
      <StatusPill sch={schedule} t={t} />
      <PackView sch={schedule} width={Math.min(width - 72, 420)} />
      <Text style={[s.muted, { textAlign: "center", marginTop: 8 }]}>
        {t.ownProgress({ taken: schedule.taken, total: schedule.pillsPerPack, time: schedule.time })}
      </Text>
      {packFinished(schedule)
        ? <Button title={t.newPack} onPress={onNewPack} />
        : <Button title={done ? t.alreadyTaken : t.markTaken} onPress={onTaken} disabled={done} />}
    </Card>
  );
}

function FollowedSchedule({ pid, profile, width, t, onRemove }: { pid: string; profile: Followed; width: number; t: Strings; onRemove: () => void }) {
  const sch = profile && profile !== "denied" && hasSchedule(profile) ? profile : null;
  return (
    <Card>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <View style={{ flex: 1 }}>
          <Text style={s.h2}>{sch?.name || pid}</Text>
          {sch?.name ? <Text style={s.muted}>{pid}</Text> : null}
          {sch && <StatusPill sch={sch} t={t} />}
        </View>
        <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button"><Text style={{ color: C.muted, fontWeight: "600" }}>{t.unsubscribe}</Text></Pressable>
      </View>
      {profile === undefined && <ActivityIndicator color={C.primary} style={{ marginTop: 12 }} />}
      {profile === "denied" && <Text style={[s.muted, { marginTop: 8 }]}>{t.noLongerAvailable}</Text>}
      {profile && profile !== "denied" && !sch && <Text style={[s.muted, { marginTop: 8 }]}>{t.noScheduleYet}</Text>}
      {sch && (
        <>
          <PackView sch={sch} width={Math.min(width - 72, 360)} />
          <Text style={[s.muted, { textAlign: "center", marginTop: 8 }]}>{t.progress({ taken: sch.taken, total: sch.pillsPerPack })}</Text>
        </>
      )}
    </Card>
  );
}
