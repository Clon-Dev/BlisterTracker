import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Platform, Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { onAuthStateChanged, type User } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AlertTriangle, AtSign, BellRing, CalendarDays, CalendarHeart, Check, CheckCheck, Clock3, Copy, Eye, EyeOff, KeyRound, LockKeyhole, MailWarning, Moon, Pencil, Pill, Plus, SkipForward, SlidersHorizontal, Tag,
  UserMinus, UserPlus, UserRound, type LucideIcon,
} from "lucide-react-native";
import { actionOn, addDays, clock, cycleLength, dayKey, diffDays, doneOn, firstEditableDay, isTaken, methodOf, openActionDay, slot, trackFromPackStart, zonedTime } from "./shared/schedule";
import { auth } from "./src/firebase";
import { AccountScreen } from "./src/AccountScreen";
import { setAuthLanguage, resendVerification, takePendingPassword } from "./src/auth";
import { ErrorBoundary } from "./src/ErrorBoundary";
import { openRecoveryCodeSheet, openUnlockSharedSheet, UnlockScreen } from "./src/EncryptionScreens";
import { createKeyring, followedShareKey, loadCachedKey, ownShareKey, syncKeyring, unlockWithPassword, useDataKey } from "./src/keys";
import { AuthScreen } from "./src/AuthScreen";
import { Blister } from "./src/Blister";
import {
  deviceTz, recordAction, ensureAccount, cleanUsername, ensureUsername, fetchSharing, hasSchedule, markSeen, setUsername, USERNAME_MAX, usernameAvailable, validUsername, migrateToEncryption, openNotes, registerToken, renameSchedule, setAccountLang, setFollowerOnly, setTaken,
  setTimezone, todayOf, unsubscribe, watchAccount, watchNotes, watchOwnSeen, watchProfile, watchSeen, watchSubscriberCount,
  type Account, type Notes, type Profile, type Schedule, type Seen, type Sharing, type StoredNotes,
} from "./src/data";
import { NoteCard, NoteLine, openEarlyPackSheet, SuppliesCard, TravelNotice, UpdateCard, type OwnNote } from "./src/HomeCards";
import { checkForUpdate, type Release } from "./src/update";
import { openActionSheet } from "./src/methods/ActionSheet";
import { MethodSchedule, MethodVisual } from "./src/methods/MethodSchedule";
import { methodStatus } from "./src/methods/status";
import type { PillState } from "./src/mascot/brain";
import { loadMascot } from "./src/mascot/store";
import { MascotProvider, MascotSpot, useMascotScroll } from "./src/mascot/world";
import { PasswordForm, ScheduleWizard, SubscribeForm } from "./src/Forms";
import { HistoryScreen } from "./src/HistoryScreen";
import { formatDay, loadSavedLang, strings, useI18n, type Lang, type Strings } from "./src/i18n";
import { missedDays, packCells } from "./src/pack";
import { enablePush, onNotificationAction, pushStatus, registerActions, type PushStatus } from "./src/push";
import { alert, confirm, openSheet, SheetHost, SheetIcon, toast, ToastHost } from "./src/sheets";
import { openDaySheet } from "./src/TakenTime";
import { C, F, fonts, G, loadAppearance, R, setSystemDark, shadow, themedStyles, useThemeVersion } from "./src/theme";
import { errorText, queued } from "./src/errors";
import { Badge, Button, Card, Field, IconButton, LanguageSwitch, LinkButton, ProgressRing, s, SectionTitle } from "./src/ui";

type Screen = "home" | "password" | "subscribe" | "schedule" | "account" | "history";
type Followed = Profile | "denied" | undefined;

/**
 * Fonts get a few seconds to load; after that (or if a download fails) the app starts anyway. Waiting for
 * them forever left an empty screen whenever a font file didn't arrive, e.g. on a flaky network at launch.
 */
function useFontsReady() {
  const [loaded, error] = useFonts(fonts);
  const [waited, setWaited] = useState(false);
  useEffect(() => { const id = setTimeout(() => setWaited(true), 3000); return () => clearTimeout(id); }, []);
  return loaded || !!error || waited;
}

export default function App() {
  const fontsReady = useFontsReady();
  const systemDark = useColorScheme() === "dark";
  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => { Promise.all([loadAppearance(systemDark), loadMascot()]).then(() => setThemeReady(true)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (themeReady) setSystemDark(systemDark); }, [systemDark, themeReady]);
  useThemeVersion(); // re-render with the new palette
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={["top", "left", "right"]}>
        <StatusBar style={C.dark ? "light" : "dark"} />
        <ErrorBoundary>
          {fontsReady && themeReady ? <Root /> : <View style={{ flex: 1 }} />}
          <SheetHost />
          <ToastHost />
        </ErrorBoundary>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const scrollContent = { padding: 20, paddingBottom: 56, width: "100%", maxWidth: 560, alignSelf: "center" } as const;

const Loading = ({ text }: { text: string }) => (
  <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
    <ActivityIndicator size="large" color={C.primary} />
    <Text style={s.muted}>{text}</Text>
  </View>
);

/** Login gate: without an account only the login/register screen is shown. */
function Root() {
  const { t, lang } = useI18n();
  const themeVersion = useThemeVersion();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => setAuthLanguage(lang), [lang]);
  useEffect(() => {
    if (Platform.OS === "web") (globalThis as { bbStarted?: () => void }).bbStarted?.(); // hide the HTML start screen
    let unsub = () => {};
    loadSavedLang().then(() => { unsub = onAuthStateChanged(auth, setUser); });
    return () => unsub();
  }, []);

  if (user === undefined) return <Loading text={t.loading} />;
  if (!user) return (
    <ScrollView key={themeVersion} contentContainerStyle={scrollContent} keyboardShouldPersistTaps="handled">
      <AuthScreen />
    </ScrollView>
  );
  return <Main key={user.uid} user={user} />;
}

/** Re-renders when the local date changes, so "taken today" flips at midnight even if the app stays open. */
function useToday() {
  const [today, setToday] = useState(() => dayKey(Date.now(), deviceTz()));
  useEffect(() => {
    const id = setInterval(() => setToday(dayKey(Date.now(), deviceTz())), 60_000);
    return () => clearInterval(id);
  }, []);
  return today;
}

const celebrate = () => { if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); };

function Main({ user }: { user: User }) {
  const { t, lang } = useI18n();
  const themeVersion = useThemeVersion();
  const today = useToday();
  const uid = user.uid;
  const width = Math.min(useWindowDimensions().width, 560);
  const [account, setAccount] = useState<Account | null>(null);
  const [own, setOwn] = useState<Profile | null>(null);
  const [followed, setFollowed] = useState<Record<string, Followed>>({});
  const [sharing, setSharing] = useState<Sharing>({ set: false, password: null });
  const [subscriberCount, setSubscriberCount] = useState(0);
  const [push, setPush] = useState<PushStatus | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(user.emailVerified);
  const [screen, setScreen] = useState<Screen>("home");
  const [historyOf, setHistoryOf] = useState<string | null>(null);
  const [sharedNotes, setSharedNotes] = useState<StoredNotes>({});
  const [privateNotes, setPrivateNotes] = useState<StoredNotes>({});
  const [storedFollowedNotes, setFollowedNotes] = useState<Record<string, StoredNotes>>({});
  const [seen, setSeen] = useState<Seen[]>([]); // followers' confirmations for the own schedule
  // Hidden "set up your plan" card (accounts/{uid}.followerOnly); the local value shows a change before the write is confirmed.
  const [followerOnlyNow, setFollowerOnlyNow] = useState<boolean | null>(null);
  const followerOnly = followerOnlyNow ?? !!account?.followerOnly;
  useEffect(() => setFollowerOnlyNow(null), [account?.followerOnly]); // confirmed (from this or another device)
  const changeFollowerOnly = (v: boolean) => { setFollowerOnlyNow(v); queued(setFollowerOnly(uid, v)); };
  const [followedSeen, setFollowedSeen] = useState<Record<string, Seen | null>>({}); // own confirmations per followed schedule
  const [keptZones, setKeptZones] = useState<string | null>(null);
  const [release, setRelease] = useState<Release | null>(null);
  const mascotScroll = useMascotScroll();
  const [noteFocus, setNoteFocus] = useState(0);

  // App updates (Android APK): check on start and when the app returns, at most every 6 hours.
  useEffect(() => {
    let last = 0;
    const check = () => {
      if (Date.now() - last < 6 * 3600_000) return;
      last = Date.now();
      checkForUpdate().then(setRelease, () => undefined); // offline: try again next time
    };
    check();
    const sub = AppState.addEventListener("change", (st) => st === "active" && check());
    return () => sub.remove();
  }, []);
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

  // End-to-end encryption: this device needs the unlocked data key. Order: key cached on the device →
  // password from the login that just happened → unlock screen (once per device).
  const dataKey = useDataKey();
  const [keyState, setKeyState] = useState<"checking" | "ready" | "locked" | "recover">("checking");
  const [loginPassword, setLoginPassword] = useState<string | undefined>(undefined);
  useEffect(() => { syncKeyring(account?.keyring); }, [account?.keyring]);
  const accountLoaded = !!account;
  useEffect(() => {
    if (!account || keyState !== "checking") return;
    (async () => {
      syncKeyring(account.keyring);
      if (await loadCachedKey(uid)) return setKeyState("ready");
      const password = takePendingPassword();
      if (password) {
        if (!account.keyring) {
          openRecoveryCodeSheet(await createKeyring(uid, password));
          return setKeyState("ready");
        }
        try {
          await unlockWithPassword(uid, password);
          return setKeyState("ready");
        } catch {
          setLoginPassword(password); // the recovery screen re-wraps the keyring with it
          return setKeyState("recover"); // logged in with a password that doesn't open the keyring: it was reset
        }
      }
      setKeyState("locked");
    })().catch(() => setKeyState("locked"));
  }, [accountLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // After unlocking: encrypt what was stored in plain text before (once; idempotent).
  const ownLoaded = own !== null;
  useEffect(() => {
    if (keyState !== "ready" || !account || !ownLoaded) return;
    migrateToEncryption(uid, account.pid, hasSchedule(own) ? own : null)
      .then(() => fetchSharing(account.pid))
      .then(setSharing, () => undefined);
  }, [keyState, ownLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Notifications are sent in the account's language.
  useEffect(() => {
    if (account && account.lang !== lang) queued(setAccountLang(uid, lang));
  }, [uid, account?.lang, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const pid = account?.pid;
  useEffect(() => {
    if (!pid) return;
    const unsubs = [
      watchProfile(pid, setOwn), watchSubscriberCount(pid, setSubscriberCount), watchSeen(pid, setSeen),
      watchNotes(pid, "shared", setSharedNotes), watchNotes(pid, "private", setPrivateNotes),
    ];
    return () => unsubs.forEach((u) => u());
  }, [pid]);
  useEffect(() => { if (pid) fetchSharing(pid).then(setSharing, () => undefined); }, [pid, dataKey]);
  // Accounts from before usernames (and new ones) claim their personal ID as username, once.
  const claimingUsername = useRef(false);
  useEffect(() => {
    if (!pid || !own || own.username || claimingUsername.current) return;
    claimingUsername.current = true;
    ensureUsername(uid, pid, own).catch(() => undefined).finally(() => { claimingUsername.current = false; });
  }, [pid, own]); // eslint-disable-line react-hooks/exhaustive-deps

  // One live listener per followed schedule.
  const subsKey = account?.subs.join(",") ?? "";
  useEffect(() => {
    const pids = subsKey ? subsKey.split(",") : [];
    setFollowed((f) => Object.fromEntries(pids.map((p) => [p, f[p]])));
    const unsubs = pids.flatMap((p) => [
      watchProfile(p,
        (profile) => setFollowed((f) => ({ ...f, [p]: profile ?? "denied" })),
        () => setFollowed((f) => ({ ...f, [p]: "denied" }))),
      watchNotes(p, "shared", (n) => setFollowedNotes((f) => ({ ...f, [p]: n }))),
      watchOwnSeen(p, uid, (sn) => setFollowedSeen((f) => ({ ...f, [p]: sn }))),
    ]);
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
      else if (ask) alert(t.pushOffTitle, t.pushOffBody);
    } catch (e) {
      if (ask) alert(t.errorTitle, errorText(e));
    }
  }, [uid, account, t]);

  useEffect(() => { refreshPush(false); }, [pid]); // eslint-disable-line react-hooks/exhaustive-deps

  const schedule = hasSchedule(own) ? own : null;
  /** Own notes from both docs (decrypted), marked with where they live. */
  const keyring = account?.keyring;
  const ownNotes = useMemo(() => {
    const all: Record<string, OwnNote> = {};
    for (const [d, n] of Object.entries(openNotes(privateNotes, dataKey))) all[d] = { ...n, shared: false };
    for (const [d, n] of Object.entries(openNotes(sharedNotes, ownShareKey(keyring)))) all[d] = { ...n, shared: true };
    return all;
  }, [sharedNotes, privateNotes, dataKey, keyring]);
  /** Followed schedules' shared notes, decrypted with the share keys this account holds. */
  const followedNotes = useMemo(() => Object.fromEntries(Object.entries(storedFollowedNotes)
    .map(([p, n]) => [p, openNotes(n, followedShareKey(p, keyring))])) as Record<string, Notes>, [storedFollowedNotes, dataKey, keyring]);

  // Travelling: the device is in another zone than the schedule. "Keep home time" is remembered per zone pair.
  const here = deviceTz();
  const zonePair = schedule ? `${schedule.tz}>${here}` : null;
  useEffect(() => { AsyncStorage.getItem("keptZones").then(setKeptZones, () => undefined); }, []);
  const showTravel = !!schedule && schedule.tz !== here && keptZones !== zonePair;

  /** A follower confirms they've seen that `day`'s pill of schedule `p` was taken (card button or notification button). */
  const confirmSeen = (p: string, day: string) => {
    // The owner sees "Seen by …": the follower's chosen username, else their schedule name.
    const chosen = own?.username && own.username !== pid ? own.username : undefined;
    queued(markSeen(uid, p, day, chosen ?? (own && hasSchedule(own) ? own.name || undefined : undefined)));
    toast(strings().seenToast);
  };

  /** Opens the day sheet (now / earlier / change / unmark) and saves the choice. */
  /** Patch / ring / injection: records (or changes, or undoes) the action scheduled on `scheduled`. */
  const editAction = useCallback(async (sch: Schedule, scheduled: string) => {
    if (!pid || !actionOn(sch, scheduled)) return;
    const choice = await openActionSheet(sch, scheduled);
    if (!choice) return;
    queued(recordAction(pid, sch, scheduled, "undo" in choice ? null : choice));
    if (!("undo" in choice)) { celebrate(); toast(t.markedToast); }
  }, [pid, t]);

  const editDay = useCallback(async (sch: Schedule, day: string) => {
    if (methodOf(sch) !== "pill") return editAction(sch, day);
    if (!pid || slot(sch, day).kind === "break" || day > todayOf(sch) || day < firstEditableDay(sch)) return;
    const action = await openDaySheet(trackFromPackStart(sch), day, lang); // pre-setup pills show as taken (time unknown)
    if (!action) return;
    queued(setTaken(pid, sch, day, "untake" in action ? null : action.time));
    if (!("untake" in action)) { celebrate(); toast(t.markedToast); }
  }, [pid, lang, t, editAction]);

  // "Taken" button on the reminder notification: opens the day sheet once the schedule has loaded
  // (when the button launches the app, the action arrives first).
  const [pendingTaken, setPendingTaken] = useState<{ pid: string; day: string } | null>(null);
  useEffect(() => { registerActions({ taken: t.notificationTaken, done: t.notificationDone, seen: t.notificationSeen }); }, [t]);
  // "Mark as seen" on a follower's notification: waits for the own profile, whose schedule name goes with it.
  const [pendingSeen, setPendingSeen] = useState<{ pid: string; day: string } | null>(null);
  useEffect(() => onNotificationAction((action, actionPid, day) =>
    (action === "taken" ? setPendingTaken : setPendingSeen)({ pid: actionPid, day })), []);
  useEffect(() => {
    if (!pendingSeen || !own) return;
    setPendingSeen(null);
    confirmSeen(pendingSeen.pid, pendingSeen.day);
  }, [pendingSeen, own]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pendingTaken || !pid || !schedule) return;
    setPendingTaken(null);
    if (pendingTaken.pid !== pid) return;
    if (methodOf(schedule) !== "pill") { // the action still open (it may be carried over from an earlier day)
      const open = openActionDay(schedule, todayOf(schedule));
      if (open) editAction(schedule, open);
    } else if (!isTaken(schedule, pendingTaken.day)) editDay(schedule, pendingTaken.day);
  }, [pendingTaken, pid, schedule, editDay, editAction]);

  if (error) return (
    <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
      <Text style={s.h1}>{t.errorTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{error}</Text>
      <Button title={t.tryAgain} onPress={() => { setError(null); setAttempt((n) => n + 1); }} />
    </View>
  );
  if (!account || keyState === "checking") return <Loading text={t.loading} />;
  if (keyState !== "ready") return (
    <ScrollView key={`unlock-${themeVersion}`} contentContainerStyle={scrollContent} keyboardShouldPersistTaps="handled">
      <UnlockScreen user={user} hasKeyring={!!account.keyring} initialMode={keyState === "recover" ? "recover" : undefined}
        knownPassword={loginPassword} onReady={(code) => { setLoginPassword(undefined); if (code) openRecoveryCodeSheet(code); setKeyState("ready"); }} />
    </ScrollView>
  );

  const home = () => setScreen("home");
  const showHistory = (p: string) => { setHistoryOf(p); setScreen("history"); };
  const username = own?.username ?? account.pid;
  const historyProfile = historyOf === account.pid ? own : historyOf ? followed[historyOf] : null;
  const historySchedule = historyProfile && historyProfile !== "denied" && hasSchedule(historyProfile) ? historyProfile : null;

  // The kitten on the home screen: today's pill (read when it checks, since "overdue" starts with time) and today's note.
  const methodNow = schedule && methodOf(schedule) !== "pill" ? methodStatus(schedule, todayOf(schedule), Date.now(), t, lang) : null;
  const todayPill = (): PillState => {
    if (!schedule) return null;
    if (methodOf(schedule) !== "pill") {
      const st = methodStatus(schedule, todayOf(schedule), Date.now(), t, lang);
      const open = st.open;
      return {
        number: 0, action: open?.key ?? st.doneToday?.key,
        state: open ? (open.overdue ? "overdue" : "due") : st.doneToday ? "taken" : "break",
        minutesLate: open ? Math.floor((Date.now() - zonedTime(open.day, schedule.time, schedule.tz)) / 60_000) : 0,
        soonDays: !open && st.next?.key === "inject" ? diffDays(todayOf(schedule), st.next.day) : undefined,
      };
    }
    const info = todayInfo(schedule);
    return { number: info.index + 1, state: info.state, minutesLate: Math.floor((Date.now() - zonedTime(info.day, schedule.time, schedule.tz)) / 60_000) };
  };
  const pillDay = schedule && slot(schedule, todayOf(schedule)).kind !== "break";

  return (
    // key: each screen starts scrolled to the top; a theme switch redraws everything with the new palette.
    <Animated.ScrollView key={`${screen}-${themeVersion}`} ref={mascotScroll.ref} contentContainerStyle={scrollContent} keyboardShouldPersistTaps="handled"
      onScroll={mascotScroll.onScroll} scrollEventThrottle={16} onLayout={mascotScroll.onLayout}>
      {screen === "account" && <AccountScreen user={user} account={account} pushToken={pushToken} onBack={home} onUpdateFound={setRelease}
        followerOnly={schedule ? null : followerOnly} onFollowerOnly={changeFollowerOnly} />}
      {screen === "password" && <PasswordForm uid={uid} pid={account.pid} name={username} hasPassword={sharing.set} onSaved={(password) => { setSharing({ set: true, password }); home(); }} onBack={home} />}
      {screen === "subscribe" && <SubscribeForm uid={uid} ownPid={account.pid} onBack={home} />}
      {screen === "schedule" && <ScheduleWizard uid={uid} pid={account.pid} current={own} width={width} onBack={home} />}
      {screen === "history" && historySchedule && (
        <HistoryScreen schedule={historySchedule} onBack={home}
          notes={historyOf === account.pid ? ownNotes : followedNotes[historyOf!] ?? {}}
          owner={historyOf === account.pid ? { uid, pid: account.pid } : undefined}
          onEditDay={historyOf === account.pid ? (day) => editDay(historySchedule, day) : undefined} />
      )}
      {screen === "home" && <MascotProvider scroll={mascotScroll} day={today} getPill={todayPill}
        takenToday={methodNow ? (methodNow.doneToday ? true : methodNow.open ? false : null) : schedule && pillDay ? isTaken(schedule, todayOf(schedule)) : null}
        hasNoteToday={schedule ? !!ownNotes[todayOf(schedule)] : null}
        name={own?.username && own.username !== account.pid ? own.username : null}
        onTakePill={() => schedule && editDay(schedule, openActionDay(schedule, todayOf(schedule)) ?? todayOf(schedule))} onFocusNote={() => setNoteFocus((n) => n + 1)}>
        <View style={st.topBar}>
          <LinearGradient colors={G.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.logo}>
            <Pill size={20} color={C.white} strokeWidth={2.4} />
          </LinearGradient>
          <Text style={[s.h2, F.extrabold, { flex: 1 }]} numberOfLines={1}>Blister Buddy</Text>
          <LanguageSwitch />
          <IconButton icon={UserRound} label={t.account} onPress={() => setScreen("account")} />
        </View>

        {release && <UpdateCard release={release} />}

        {!emailVerified && (
          <Notice icon={MailWarning} tone="warning" text={t.verifyBanner({ email: user.email ?? "" })}
            action={t.verifyResend} onAction={() => resendVerification(user).then(() => toast(t.verifySent), (e) => alert(t.errorTitle, errorText(e)))} />
        )}
        {sharing.set && sharing.password === null && (
          <Notice icon={KeyRound} tone="warning" text={t.sharingAgainNotice} action={t.setItAgain} onAction={() => setScreen("password")} />
        )}
        {push && push !== "granted" && (
          <Notice icon={BellRing} tone="primary"
            text={{ default: t.pushDefault, denied: t.pushDenied, "needs-install": t.pushInstall, unsupported: t.pushUnsupported }[push]}
            action={push === "default" ? t.pushEnable : undefined} onAction={() => refreshPush(true)} />
        )}

        {schedule && showTravel && (
          <TravelNotice schedule={schedule} deviceTz={here} t={t}
            onUseLocal={() => { queued(setTimezone(account.pid, schedule, here)); toast(t.tzSwitched); }}
            onKeep={() => { setKeptZones(zonePair); AsyncStorage.setItem("keptZones", zonePair!).catch(() => undefined); }} />
        )}

        {schedule
          ? methodOf(schedule) !== "pill"
            ? <MethodSchedule schedule={schedule} today={todayOf(schedule)} width={width} t={t} lang={lang}
                onAction={(day) => editAction(schedule, day)} onHistory={() => showHistory(account.pid)} onEdit={() => setScreen("schedule")}
                onRename={() => openRenameSheet(account.pid, schedule.name, t)}
                heroFooter={doneOn(schedule, todayOf(schedule)) && <SeenLine seen={seen.filter((x) => seenSinceDone(schedule, x))} tz={schedule.tz} t={t} />}
                extra={<MascotSpot id="note">
                  <NoteCard uid={uid} pid={account.pid} day={todayOf(schedule)} note={ownNotes[todayOf(schedule)] ?? null} focusKey={noteFocus} />
                </MascotSpot>}
                after={<MascotSpot id="supplies"><SuppliesCard pid={account.pid} schedule={schedule} /></MascotSpot>} />
            : <OwnSchedule schedule={schedule} today={today} width={width} t={t} lang={lang} seen={seen}
              onEditDay={(day) => editDay(schedule, day)} onHistory={() => showHistory(account.pid)} onEdit={() => setScreen("schedule")}
              onEarlyPack={() => openEarlyPackSheet(account.pid, schedule, lang)}
              onRename={() => openRenameSheet(account.pid, schedule.name, t)}
              extra={<MascotSpot id="note">
                <NoteCard uid={uid} pid={account.pid} day={todayOf(schedule)} note={ownNotes[todayOf(schedule)] ?? null} focusKey={noteFocus} />
              </MascotSpot>}
              after={<MascotSpot id="supplies"><SuppliesCard pid={account.pid} schedule={schedule} /></MascotSpot>} />
          : !followerOnly && <MascotSpot id="setup"><SetupCard t={t} onCreate={() => setScreen("schedule")}
            onFollowerOnly={() => { changeFollowerOnly(true); toast(t.followerOnlyToast); }} /></MascotSpot>}

        <MascotSpot id="id"><IdCard username={username} sharing={sharing} followers={subscriberCount} t={t} onPassword={() => setScreen("password")}
          onEditUsername={() => openSheet<void>((done) => <UsernameSheet uid={uid} pid={account.pid} current={username} t={t} done={done} />)} /></MascotSpot>

        <Button title={t.followSchedule} icon={UserPlus} onPress={() => setScreen("subscribe")} style={{ marginTop: 18 }} />
        {/* Hidden setup card: the way back to an own plan. */}
        {!schedule && followerOnly && <LinkButton title={t.ownPlanLink} icon={Plus} onPress={() => setScreen("schedule")} />}

        {account.subs.length > 0 && <SectionTitle title={t.following} />}
        {account.subs.map((p) => (
          <MascotSpot key={p} id={`follow-${p}`}><FollowedSchedule seen={followedSeen[p] ?? null} onSeen={(day) => confirmSeen(p, day)} pid={p} profile={followed[p]} notes={followedNotes[p] ?? {}} today={today} width={width} t={t} onHistory={() => showHistory(p)}
            canRead={!!followedShareKey(p, keyring)} onUnlock={(name) => openUnlockSharedSheet(uid, p, name)}
            onRemove={async () => {
              const f = followed[p];
              const name = (f && f !== "denied" && (f.name || f.username)) || p;
              if (await confirm({ title: t.unsubscribeTitle, message: t.unsubscribeBody({ name }), confirmLabel: t.unsubscribe, destructive: true, icon: UserMinus })) {
                queued(unsubscribe(uid, p));
              }
            }} /></MascotSpot>
        ))}
        <MascotSpot id="end" inset={0}><View style={{ height: 1 }} /></MascotSpot>
      </MascotProvider>}
    </Animated.ScrollView>
  );
}

function Notice({ icon: Icon, tone, text, action, onAction }: {
  icon: LucideIcon; tone: "warning" | "primary" | "danger"; text: string; action?: string; onAction?: () => void;
}) {
  const [bg, fg] = { warning: [C.warningSoft, C.warning], primary: [C.primarySoft, C.primaryDeep], danger: [C.dangerSoft, C.danger] }[tone];
  return (
    <View style={[st.notice, { backgroundColor: bg }]}>
      <View style={[st.iconDot, { backgroundColor: C.card }]}><Icon size={18} color={fg} strokeWidth={2.4} /></View>
      <View style={{ flex: 1 }}>
        <Text style={[s.small, F.semibold, { color: C.text, lineHeight: 19 }]}>{text}</Text>
        {action && onAction && (
          <Pressable onPress={onAction} accessibilityRole="button" accessibilityLabel={action} hitSlop={6} style={{ marginTop: 6, alignSelf: "flex-start" }}>
            <Text style={[s.small, F.extrabold, { color: fg }]}>{action} →</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function SetupCard({ t, onCreate, onFollowerOnly }: { t: Strings; onCreate: () => void; onFollowerOnly: () => void }) {
  return (
    <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, shadow(3)]}>
      <View style={st.heroBubble} />
      <View style={[st.iconDot, { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(255,255,255,0.22)" }]}>
        <CalendarHeart size={26} color={C.white} strokeWidth={2.2} />
      </View>
      <Text style={[s.h1, { color: C.white, marginTop: 14 }]}>{t.setupTitle}</Text>
      <Text style={[s.body, { color: "rgba(255,255,255,0.88)", marginTop: 6 }]}>{t.setupBody}</Text>
      <Button title={t.createSchedule} kind="light" icon={Plus} onPress={onCreate} style={{ marginTop: 18 }} />
      <Pressable onPress={onFollowerOnly} accessibilityRole="button" accessibilityLabel={t.followerOnlyButton} hitSlop={6}
        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 14, paddingVertical: 6 }}>
        <EyeOff size={16} color={C.white} strokeWidth={2.4} />
        <Text style={[s.small, F.bold, { color: C.white, flexShrink: 1, textAlign: "center" }]}>{t.followerOnlyButton}</Text>
      </Pressable>
    </LinearGradient>
  );
}

type Today = { state: "break" | "taken" | "due" | "overdue"; day: string; index: number; placebo: boolean; nextPack: string };

/** What today looks like for a schedule, in its own time zone. */
function todayInfo(sch: Schedule): Today {
  const day = todayOf(sch);
  const { kind, index, packStart } = slot(sch, day);
  const base = { day, index, placebo: kind === "placebo", nextPack: addDays(packStart, cycleLength(sch)) };
  if (kind === "break") return { ...base, state: "break" };
  if (isTaken(sch, day)) return { ...base, state: "taken" };
  return { ...base, state: Date.now() > zonedTime(day, sch.time, sch.tz) ? "overdue" : "due" };
}

function StatusBadge({ sch, t }: { sch: Schedule; t: Strings }) {
  const { lang } = useI18n();
  if (methodOf(sch) !== "pill") {
    const st = methodStatus(sch, todayOf(sch), Date.now(), t, lang);
    if (st.open) {
      const late = st.open.daysLate > 0 || st.open.overdue;
      return <Badge tone={late ? "danger" : "primary"} icon={late ? AlertTriangle : BellRing}
        label={st.open.daysLate ? `${t.actionLate({ what: t.actionName[st.open.key] })} · ${t.daysLate({ n: st.open.daysLate })}` : t.actionTodo[st.open.key]} />;
    }
    if (st.doneToday) return <Badge tone="success" icon={Check} label={t.doneAt({ what: t.actionPast[st.doneToday.key], time: st.doneToday.time })} />;
    return <Badge tone="neutral" icon={CalendarDays} label={st.position} />;
  }
  const info = todayInfo(sch);
  const time = sch.takenDays[info.day];
  if (info.state === "break") return <Badge tone="neutral" icon={Moon} label={t.heroBreak} />;
  if (info.state === "taken") return <Badge tone="success" icon={Check} label={time ? t.takenAtShort({ time }) : t.takenUnknown} />;
  if (info.state === "overdue") return <Badge tone="danger" icon={AlertTriangle} label={t.overdue({ time: sch.time })} />;
  return <Badge tone="primary" icon={BellRing} label={info.placebo ? t.placeboDue({ time: sch.time }) : t.dueAt({ time: sch.time })} />;
}

/** Blister of the current pack. `today` (device day) only triggers the recompute at midnight. */
function PackView({ sch, today, width, onPressDay }: { sch: Schedule; today: string; width: number; onPressDay?: (day: string) => void }) {
  const { cells, startWeekday } = useMemo(() => packCells(sch, todayOf(sch)), [sch, today]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ alignItems: "center", marginTop: 16 }}>
      <Blister cells={cells} startWeekday={startWeekday} width={width} onPressCell={onPressDay && ((i) => onPressDay(cells[i].day))} />
    </View>
  );
}

function Legend({ t, sch }: { t: Strings; sch: Schedule }) {
  const items: [string, object][] = [
    [t.legendTaken, { backgroundColor: C.hole[0] }],
    [t.legendMissed, { borderWidth: 2.5, borderColor: C.danger }],
  ];
  if (sch.placebo > 0) items.push([t.legendPlacebo, { backgroundColor: C.placebo[1], borderWidth: 1, borderColor: C.placeboStroke }]);
  if (sch.breakDays > 0) items.push([t.legendBreak, { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.breakStroke }]);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 14, marginTop: 14 }}>
      {items.map(([label, dot]) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={[{ width: 12, height: 12, borderRadius: 6 }, dot]} />
          <Text style={s.small}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function OwnSchedule({ schedule, today, width, t, lang, seen, onEditDay, onHistory, onEdit, onEarlyPack, onRename, extra, after }: {
  schedule: Schedule; today: string; width: number; t: Strings; lang: Lang;
  /** Followers' "seen" confirmations (shown under today's taken time). */
  seen: Seen[];
  onEditDay: (day: string) => void; onHistory: () => void; onEdit: () => void; onEarlyPack: () => void; onRename: () => void;
  /** Rendered between the hero and the pack card / after the pack card. */
  extra: React.ReactNode; after: React.ReactNode;
}) {
  const info = todayInfo(schedule);
  const takenTime = schedule.takenDays[info.day];
  const missed = missedDays(schedule, info.day, 7);
  const yesterday = addDays(info.day, -1);
  const isBreak = info.state === "break";
  const n = isBreak ? info.index - schedule.pillsPerPack + 1 : info.index + 1;
  const total = isBreak ? schedule.breakDays : schedule.pillsPerPack;
  const headline = info.state === "break" ? t.heroBreak
    : info.state === "taken" ? (takenTime ? t.takenAtShort({ time: takenTime }) : t.takenUnknown)
    : info.state === "overdue" ? t.heroOverdue({ time: schedule.time })
    : t.heroDue({ time: schedule.time });
  const sub = isBreak ? t.heroBreakSub({ date: formatDay(info.nextPack, lang) })
    : `${info.placebo ? `${t.legendPlacebo} · ` : ""}${t.reminderSub({ time: schedule.time, repeat: schedule.repeatMinutes })}`;

  return (
    <>
      <MascotSpot id="hero">
      <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, shadow(3)]}>
        <View style={st.heroBubble} />
        <View style={[st.heroBubble, { width: 130, height: 130, right: undefined, top: undefined, left: -45, bottom: -60, opacity: 0.08 }]} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
          <ProgressRing progress={n / total} size={92} stroke={8} light>
            <Text style={[F.extrabold, { fontSize: 28, color: C.white, letterSpacing: -1 }]}>{n}</Text>
            <Text style={[s.small, F.bold, { color: "rgba(255,255,255,0.8)", marginTop: -2 }]}>/ {total}</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text style={[s.eyebrow, { color: "rgba(255,255,255,0.75)" }]}>{isBreak ? t.breakOf({ n, total }) : t.today}</Text>
            <Text style={[s.h1, { color: C.white, marginTop: 4 }]}>{headline}</Text>
            <Text style={[s.small, { color: "rgba(255,255,255,0.85)", marginTop: 4 }]}>{sub}</Text>
            {info.state === "taken" && <SeenLine seen={seen.filter((x) => x.day === info.day)} tz={schedule.tz} t={t} />}
          </View>
        </View>
        {!isBreak && (info.state === "taken"
          ? <Button title={t.changeTime} kind="light" icon={Clock3} compact onPress={() => onEditDay(info.day)} style={{ marginTop: 18 }} />
          : <Button title={t.takeCta} kind="light" icon={Check} onPress={() => onEditDay(info.day)} style={{ marginTop: 18 }} />)}
      </LinearGradient>
      </MascotSpot>

      {missed.length > 0 && (
        <Notice icon={AlertTriangle} tone="danger"
          text={missed.length === 1 && missed[0] === yesterday ? t.missedOne : t.missedMany({ n: missed.length })}
          action={missed.includes(yesterday) ? t.markYesterday : undefined} onAction={() => onEditDay(yesterday)} />
      )}

      {extra}

      <MascotSpot id="pack">
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable style={{ flex: 1 }} onPress={onRename} accessibilityRole="button" accessibilityLabel={t.renameTitle}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[s.h2, { flexShrink: 1 }]} numberOfLines={1}>{schedule.name || t.myPack}</Text>
              <Pencil size={14} color={C.muted} strokeWidth={2.4} />
            </View>
            <Text style={[s.small, { marginTop: 2 }]}>{isBreak ? t.breakOf({ n, total }) : t.pillOfShort({ n, total })}</Text>
          </Pressable>
          <IconButton icon={CalendarDays} label={t.history} onPress={onHistory} />
          <IconButton icon={SkipForward} label={t.earlyTitle} onPress={onEarlyPack} />
          <IconButton icon={SlidersHorizontal} label={t.editSchedule} onPress={onEdit} />
        </View>
        <PackView sch={schedule} today={today} width={Math.min(width - 82, 440)} onPressDay={onEditDay} />
        <Legend t={t} sch={schedule} />
      </Card>
      </MascotSpot>
      {after}
    </>
  );
}

function openRenameSheet(pid: string, current: string, t: Strings) {
  openSheet<void>((done) => <RenameSheet pid={pid} current={current} t={t} done={done} />);
}

function RenameSheet({ pid, current, t, done }: { pid: string; current: string; t: Strings; done: () => void }) {
  const [name, setName] = useState(current);
  const save = () => { queued(renameSchedule(pid, name)); done(); toast(t.renamed); };
  return (
    <View>
      <SheetIcon icon={Tag} />
      <Text style={s.h1}>{t.renameTitle}</Text>
      <Field label={t.nameLabel} icon={Tag} value={name} onChangeText={setName} maxLength={30} autoFocus onSubmitEditing={save} />
      <Button title={t.save} icon={Check} disabled={name.trim() === current} onPress={save} style={{ marginTop: 20 }} />
    </View>
  );
}

/** Changes the own username (awaited: the server decides whether it's free). */
function UsernameSheet({ uid, pid, current, t, done }: { uid: string; pid: string; current: string; t: Strings; done: () => void }) {
  const [name, setName] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = cleanUsername(name);
  const valid = validUsername(trimmed);
  const save = async () => {
    if (!valid || busy || trimmed === current) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await usernameAvailable(trimmed, pid))) return setError(t.usernameTaken);
      await setUsername(uid, pid, trimmed, current);
      done();
      toast(t.usernameSaved);
    } catch (e) {
      // Claimed by someone else in the meantime: the rules reject it.
      setError((e as { code?: string }).code === "permission-denied" ? t.usernameTaken : errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View>
      <SheetIcon icon={AtSign} />
      <Text style={s.h1}>{t.usernameTitle}</Text>
      <Text style={[s.muted, { marginTop: 8 }]}>{t.usernameIntro}</Text>
      <Field label={t.idLabel} icon={AtSign} value={name} onChangeText={(v) => { setName(v); setError(null); }} maxLength={USERNAME_MAX}
        autoCapitalize="none" autoCorrect={false} autoFocus onSubmitEditing={save} error={error ?? (trimmed && !valid ? t.usernameInvalid : null)} />
      <Text style={[s.small, { marginTop: 10 }]}>{t.usernameRules}</Text>
      <Button title={t.usernameSave} icon={Check} disabled={!valid || trimmed === current} busy={busy} onPress={save} style={{ marginTop: 20 }} />
    </View>
  );
}

/** Big on the card, smaller for long names; Japanese characters count about double (they're wider). */
const usernameFontSize = (name: string) => {
  const width = [...name].reduce((w, c) => w + (c >= "\u3040" ? 1.8 : 1), 0);
  return width <= 8 ? 32 : width <= 12 ? 25 : width <= 18 ? 20 : width <= 26 ? 18 : 15; // long names take two lines
};

function IdCard({ username, sharing, followers, t, onPassword, onEditUsername }: {
  username: string; sharing: Sharing; followers: number; t: Strings; onPassword: () => void; onEditUsername: () => void;
}) {
  const passwordSet = sharing.set;
  const [revealed, setRevealed] = useState(false);
  return (
    <Card>
      <Text style={s.eyebrow}>{t.yourId}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
        <Text selectable numberOfLines={2} testID="personal-id" style={[st.pid, { fontSize: usernameFontSize(username) }]}>{username}</Text>
        <IconButton icon={Pencil} label={t.editUsername} onPress={onEditUsername} />
        <IconButton icon={Copy} label={t.copy} onPress={() => Clipboard.setStringAsync(username).then(() => toast(t.copiedBody({ name: username })))} />
      </View>
      <View style={st.divider} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={[st.iconDot, { backgroundColor: passwordSet ? C.successSoft : C.primarySoft }]}>
          <KeyRound size={18} color={passwordSet ? C.success : C.primaryDeep} strokeWidth={2.4} />
        </View>
        <Text style={[s.small, F.semibold, { flex: 1, color: C.text }]}>{passwordSet ? t.subscriberLine({ n: followers }) : t.noPasswordHint}</Text>
      </View>
      {passwordSet && (sharing.password !== null ? (
        <View style={st.secret}>
          <View style={{ flex: 1 }}>
            <Text style={s.eyebrow}>{t.sharingPassword}</Text>
            <Text selectable style={[st.secretText, !revealed && { letterSpacing: 3 }]} testID="sharing-password">
              {revealed ? sharing.password : "•".repeat(Math.max(6, sharing.password.length))}
            </Text>
          </View>
          {revealed && <IconButton icon={Copy} label={t.copyPassword} size={38}
            onPress={() => Clipboard.setStringAsync(sharing.password!).then(() => toast(t.passwordCopied))} />}
          <IconButton icon={revealed ? EyeOff : Eye} label={revealed ? t.hidePassword : t.showPassword} size={38} onPress={() => setRevealed(!revealed)} />
        </View>
      ) : null)}
      <Button title={passwordSet ? t.changePassword : t.setPassword} kind="secondary" compact onPress={onPassword} />
    </Card>
  );
}

function FollowedSchedule({ pid, profile, notes, today, width, t, onHistory, onRemove, canRead, onUnlock, seen, onSeen }: {
  pid: string; profile: Followed; notes: Notes; today: string; width: number; t: Strings; onHistory: () => void; onRemove: () => void;
  /** This follower's own "seen" confirmation; `onSeen(day)` confirms today's taken pill. */
  seen: Seen | null; onSeen: (day: string) => void;
  /** This account holds the schedule's share key; otherwise shared notes need the sharing password once. */
  canRead: boolean; onUnlock: (name: string) => void;
}) {
  const { lang } = useI18n();
  const sch = profile && profile !== "denied" && hasSchedule(profile) ? profile : null;
  const todaysNote = sch ? notes[todayOf(sch)] : undefined;
  const someLocked = Object.values(notes).some((n) => n.locked);
  // The key can be fetched once the owner has published it; until then there is nothing to enter.
  const canUnlock = !!sch?.shareKeyWrap && (!canRead || someLocked);
  const waiting = !!sch && !sch.shareKeyWrap && someLocked;
  const handle = (profile && profile !== "denied" && profile.username) || pid;
  const name = sch?.name || handle;
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        <LinearGradient colors={G.avatar} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
          <Text style={[F.extrabold, { color: C.white, fontSize: 18 }]}>{name.slice(0, 1).toUpperCase()}</Text>
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={s.h2} numberOfLines={1}>{name}</Text>
          {sch?.name ? <Text style={s.small}>{handle}</Text> : null}
        </View>
      </View>
      {sch && (
        <View style={{ marginTop: 14, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <StatusBadge sch={sch} t={t} />
          {(methodOf(sch) === "pill" ? todayInfo(sch).state === "taken" : !!doneOn(sch, todayOf(sch))) &&
            <SeenButton seen={!!seen && seenSinceDone(sch, seen)} t={t} onPress={() => onSeen(todayOf(sch))} />}
        </View>
      )}
      {profile === undefined && <ActivityIndicator color={C.primary} style={{ marginTop: 14 }} />}
      {profile === "denied" && <Text style={[s.muted, { marginTop: 12 }]}>{t.noLongerAvailable}</Text>}
      {profile && profile !== "denied" && !sch && <Text style={[s.muted, { marginTop: 12 }]}>{t.noScheduleYet}</Text>}
      {todaysNote && <View style={{ marginTop: 12 }}><NoteLine note={todaysNote} label={t.todaysNote} /></View>}
      {canUnlock && <Button title={t.unlockSharedNotes} kind="secondary" compact icon={LockKeyhole} onPress={() => onUnlock(sch!.name || pid)} />}
      {waiting && <Text style={[s.small, { marginTop: 10, color: C.muted }]}>🔒 {t.notesWaiting}</Text>}
      {sch && (methodOf(sch) === "pill"
        ? <PackView sch={sch} today={today} width={Math.min(width - 82, 400)} />
        : <MethodVisual plan={sch} today={todayOf(sch)} width={width} t={t} lang={lang} />)}
      <View style={[st.divider, { marginBottom: 0 }]} />
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        {sch ? <LinkButton title={t.history} icon={CalendarDays} onPress={onHistory} /> : <View />}
        <LinkButton title={t.unsubscribe} icon={UserMinus} color={C.textSoft} onPress={onRemove} />
      </View>
    </Card>
  );
}

/** Under the owner's taken time: who confirmed they've seen it (like a read receipt). */
/**
 * A confirmation of today's pill, or of the patch / ring / injection action done today. Methods: only if given after it
 * was done (a second action on the same day, e.g. after switching methods, isn't seen yet).
 */
function seenSinceDone(sch: Schedule, x: Seen) {
  const today = todayOf(sch);
  if (x.day !== today) return false;
  const done = methodOf(sch) === "pill" ? null : doneOn(sch, today);
  return !done?.time || x.at >= zonedTime(today, done.time, sch.tz);
}

function SeenLine({ seen, tz, t }: { seen: Seen[]; tz: string; t: Strings }) {
  if (!seen.length) return null;
  const names = seen.map((x) => x.name).filter((n): n is string => !!n);
  const unnamed = seen.length - names.length;
  const time = clock(Math.max(...seen.map((x) => x.at)), tz);
  const label = !names.length
    ? (unnamed === 1 ? t.seenAt({ time }) : t.seenByCount({ n: unnamed, time }))
    : t.seenByNames({ names: [...names, ...(unnamed ? [t.seenOthers({ n: unnamed })] : [])].join(", "), time });
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }} accessibilityLabel={label}>
      <CheckCheck size={15} color={C.white} strokeWidth={2.6} />
      <Text style={[s.small, F.bold, { color: C.white, flexShrink: 1 }]}>{label}</Text>
    </View>
  );
}

/** Next to a followed schedule's "Taken at …": the follower confirms they're informed. */
function SeenButton({ seen, t, onPress }: { seen: boolean; t: Strings; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={seen} accessibilityRole="button" accessibilityLabel={seen ? t.seenDone : t.markSeen}
      accessibilityState={{ disabled: seen }} hitSlop={6}
      style={({ pressed }) => [st.seenButton, { backgroundColor: seen ? C.successSoft : C.primarySoft }, pressed && { opacity: 0.7 }]}>
      {seen ? <CheckCheck size={14} color={C.success} strokeWidth={2.6} /> : <Eye size={14} color={C.primaryDeep} strokeWidth={2.4} />}
      <Text style={[s.small, F.bold, { color: seen ? C.success : C.primaryDeep }]}>{seen ? t.seenDone : t.markSeen}</Text>
    </Pressable>
  );
}

const st = themedStyles(() => ({
  seenButton: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: R.full, paddingHorizontal: 11, paddingVertical: 6 },
  topBar: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, marginBottom: 4 },
  logo: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  hero: { borderRadius: R.xl, padding: 22, marginTop: 16, overflow: "hidden" },
  heroBubble: { position: "absolute", width: 180, height: 180, borderRadius: 90, backgroundColor: C.white, opacity: 0.1, right: -50, top: -70 },
  notice: { flexDirection: "row", gap: 12, alignItems: "flex-start", borderRadius: R.lg, padding: 14, marginTop: 14 },
  iconDot: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  pid: { ...F.extrabold, flex: 1, color: C.text, letterSpacing: 1 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 14 },
  secret: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: C.segment, borderRadius: R.md, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, marginTop: 12 },
  secretText: { ...F.bold, fontSize: 17, color: C.text, marginTop: 2 },
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center" },
}));
