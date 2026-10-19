import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { onAuthStateChanged, signInAnonymously, User } from "firebase/auth";
import { auth, firebaseConfigured } from "./src/firebase";
import { setupPush, listenForPush } from "./src/push";
type Schedule = { pillsPerPack: number; pillsTaken: number; reminderTime: string; takenToday: boolean };
type Subscribed = Schedule & { ownerUid: string; personalId: string };
type Dashboard = { personalId: string; hasPassword: boolean; own: Schedule | null; subscribed: Subscribed[] };

const call = async <T,>(name: string, data: Record<string, unknown> = {}) => {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) throw new Error("Set EXPO_PUBLIC_API_BASE_URL in .env after deploying the API.");
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Your sign-in has expired. Restart the app and try again.");
  const response = await fetch(`${baseUrl}/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
    body: JSON.stringify(data),
  });
  const result = await response.json() as { error?: string } & T;
  if (!response.ok) throw new Error(result.error ?? "The server could not complete that request.");
  return result as T;
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [pillCount, setPillCount] = useState("21");
  const [pillsTaken, setPillsTaken] = useState("0");
  const [reminderTime, setReminderTime] = useState("20:00");
  const [targetId, setTargetId] = useState("");
  const [targetPassword, setTargetPassword] = useState("");
  const [editingSchedule, setEditingSchedule] = useState(false);

  const loadDashboard = useCallback(async () => {
    const result = await call<Dashboard>("getDashboard");
    setDashboard(result);
    if (result.own) {
      setPillCount(String(result.own.pillsPerPack));
      setPillsTaken(String(result.own.pillsTaken));
      setReminderTime(result.own.reminderTime);
    }
  }, []);

  useEffect(() => onAuthStateChanged(auth, async (current) => {
    setUser(current);
    if (!current && firebaseConfigured) {
      try { await signInAnonymously(auth); } catch (e) { setLoading(false); Alert.alert("Connection issue", errorText(e)); }
    }
    if (current && firebaseConfigured) {
      try {
        await call("ensureProfile");
        await loadDashboard();
        await setupPush((token) => call("registerDevice", { token }));
      } catch (e) { Alert.alert("Couldn’t load your account", errorText(e)); }
      finally { setLoading(false); }
    }
  }), [loadDashboard]);

  useEffect(() => listenForPush(), []);

  const act = async (work: () => Promise<void>, success?: string) => {
    setBusy(true);
    try { await work(); if (success) Alert.alert("Done", success); }
    catch (e) { Alert.alert("Couldn’t complete that", errorText(e)); }
    finally { setBusy(false); }
  };

  const setSchedulePassword = () => act(async () => {
    await call("setSchedulePassword", { password });
    setPassword(""); await loadDashboard();
  }, "Your subscriber password is saved.");

  const createSchedule = () => act(async () => {
    await call("createSchedule", {
      pillsPerPack: Number(pillCount), pillsTaken: Number(pillsTaken), reminderTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    });
    await loadDashboard();
  }, "Your pill schedule is ready.");

  const subscribe = () => act(async () => {
    await call("subscribeToSchedule", { personalId: targetId, password: targetPassword });
    setTargetId(""); setTargetPassword(""); await loadDashboard();
  }, "You’re subscribed to this schedule.");

  const markTaken = () => act(async () => {
    await call("markPillTaken"); await loadDashboard();
  });

  if (!firebaseConfigured || !process.env.EXPO_PUBLIC_API_BASE_URL) return <SetupScreen />;
  if (loading || !user || !dashboard) return <View style={styles.loading}><ActivityIndicator size="large" color="#6256C7"/><Text style={styles.muted}>Getting your space ready…</Text></View>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar style="dark" />
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View><Text style={styles.eyebrow}>A LITTLE PEACE OF MIND</Text><Text style={styles.title}>Blister Buddy</Text></View>
          <View style={styles.avatar}><Text style={styles.avatarText}>✳</Text></View>
        </View>
        <Text style={styles.intro}>Your daily pill, kept simple.</Text>

        <View style={styles.idCard}>
          <View style={styles.idHeader}><Text style={styles.cardLabel}>YOUR PERSONAL ID</Text><Text style={styles.lock}>● PRIVATE</Text></View>
          <Text selectable style={styles.personalId}>{dashboard.personalId}</Text>
          <Text style={styles.cardFoot}>Share this ID and your password with someone you trust.</Text>
        </View>

        {dashboard.own ? <View style={styles.card}>
          <View style={styles.sectionTop}><View><Text style={styles.sectionTitle}>Your pill pack</Text><Text style={styles.muted}>Daily reminder · {dashboard.own.reminderTime}</Text></View><View style={[styles.status, dashboard.own.takenToday && styles.statusDone]}><Text style={[styles.statusText, dashboard.own.takenToday && styles.statusTextDone]}>{dashboard.own.takenToday ? "TAKEN TODAY" : "UP NEXT"}</Text></View></View>
          <Blister count={dashboard.own.pillsPerPack} taken={dashboard.own.pillsTaken} />
          <View style={styles.progressRow}><Text style={styles.progress}>{dashboard.own.pillsTaken} of {dashboard.own.pillsPerPack} pills in this pack</Text><Pressable onPress={() => setEditingSchedule(!editingSchedule)}><Text style={styles.link}>{editingSchedule ? "Close settings" : "Edit schedule"}</Text></Pressable></View>
          {editingSchedule && <>
            <Text style={styles.label}>PILLS IN A BLISTER</Text><Field value={pillCount} onChangeText={setPillCount} keyboardType="number-pad" />
            <Text style={styles.label}>PILLS ALREADY TAKEN</Text><Field value={pillsTaken} onChangeText={setPillsTaken} keyboardType="number-pad" />
            <Text style={styles.label}>DAILY REMINDER TIME · 24 HOUR</Text><Field value={reminderTime} onChangeText={setReminderTime} placeholder="20:00" />
            <Pressable disabled={busy} style={styles.secondaryButton} onPress={createSchedule}><Text style={styles.secondaryText}>Save schedule changes</Text></Pressable>
          </>}
          <Pressable disabled={busy || dashboard.own.takenToday} style={[styles.primaryButton, dashboard.own.takenToday && styles.disabledButton]} onPress={markTaken}>
            <Text style={styles.primaryText}>{dashboard.own.takenToday ? "Today's pill is marked taken" : "Mark today’s pill as taken"}</Text>
          </Pressable>
          <Text style={styles.hint}>Only your subscribers are notified when you mark it taken.</Text>
        </View> : <View style={styles.card}>
          <Text style={styles.sectionTitle}>Create your schedule</Text><Text style={styles.muted}>Start with the pack in front of you.</Text>
          <Text style={styles.label}>PILLS IN A BLISTER</Text><Field value={pillCount} onChangeText={setPillCount} keyboardType="number-pad" placeholder="21" />
          <Text style={styles.label}>PILLS ALREADY TAKEN</Text><Field value={pillsTaken} onChangeText={setPillsTaken} keyboardType="number-pad" placeholder="0" />
          <Text style={styles.label}>DAILY REMINDER TIME · 24 HOUR</Text><Field value={reminderTime} onChangeText={setReminderTime} placeholder="20:00" />
          <Text style={styles.hint}>Your time zone is detected automatically. We’ll remind you and your subscribers when the pill is due.</Text>
          <Blister count={previewCount(pillCount)} taken={previewTaken(pillsTaken, pillCount)} />
          <Pressable disabled={busy || !dashboard.hasPassword} style={[styles.primaryButton, (!dashboard.hasPassword || busy) && styles.disabledButton]} onPress={createSchedule}><Text style={styles.primaryText}>{dashboard.hasPassword ? "Save my schedule" : "Set a password first"}</Text></Pressable>
        </View>}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your subscriber password</Text>
          <Text style={styles.muted}>{dashboard.hasPassword ? "Change it any time. Existing subscribers keep access." : "Set a password so only people you choose can subscribe."}</Text>
          <Field value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry />
          <Pressable disabled={busy} style={styles.secondaryButton} onPress={setSchedulePassword}><Text style={styles.secondaryText}>{dashboard.hasPassword ? "Update password" : "Set password"}</Text></Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Subscribe to someone</Text><Text style={styles.muted}>Enter their personal ID and schedule password.</Text>
          <Text style={styles.label}>PERSONAL ID</Text><Field value={targetId} onChangeText={setTargetId} placeholder="e.g. 4A1B2C3D4E" autoCapitalize="characters" />
          <Text style={styles.label}>SCHEDULE PASSWORD</Text><Field value={targetPassword} onChangeText={setTargetPassword} placeholder="Their password" secureTextEntry />
          <Pressable disabled={busy} style={styles.secondaryButton} onPress={subscribe}><Text style={styles.secondaryText}>Subscribe to schedule</Text></Pressable>
        </View>

        <View style={styles.subHeader}><Text style={styles.sectionTitle}>Following</Text><Text style={styles.counter}>{dashboard.subscribed.length}</Text></View>
        {dashboard.subscribed.length ? dashboard.subscribed.map((item) => <View key={item.ownerUid} style={styles.followCard}>
          <View style={styles.followTop}><View><Text style={styles.followTitle}>Pill schedule</Text><Text style={styles.muted}>ID · {item.personalId}</Text></View><View style={[styles.status, item.takenToday && styles.statusDone]}><Text style={[styles.statusText, item.takenToday && styles.statusTextDone]}>{item.takenToday ? "TAKEN" : "UP NEXT"}</Text></View></View>
          <View style={styles.followBottom}><Text style={styles.progress}>{item.pillsTaken} of {item.pillsPerPack} pills · {item.reminderTime}</Text><Text style={styles.pillDot}>✳</Text></View>
          <Blister count={item.pillsPerPack} taken={item.pillsTaken} compact />
        </View>) : <View style={styles.empty}><Text style={styles.emptyIcon}>♡</Text><Text style={styles.emptyTitle}>Your circle starts here</Text><Text style={styles.muted}>Subscribe to a schedule to see its daily status.</Text></View>}
        <Text style={styles.footer}>Small reminders. More peace of mind.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
    {busy && <View style={styles.busyOverlay}><ActivityIndicator color="#fff" /></View>}
  </SafeAreaView>;
}

function Field(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput {...props} style={[styles.input, props.style]} placeholderTextColor="#A5A2AF" autoCapitalize={props.autoCapitalize ?? "none"} />;
}
function Blister({ count, taken, compact = false }: { count: number; taken: number; compact?: boolean }) {
  return <View style={[styles.blister, compact && styles.blisterCompact]}>
    {Array.from({ length: count }, (_, i) => <View key={i} style={[styles.cell, compact && styles.cellCompact]}>
      <View style={[styles.pill, compact && styles.pillCompact, i < taken && styles.pillTaken]}><Text style={[styles.pillGlyph, i < taken && styles.pillGlyphTaken]}>{i < taken ? "✓" : "✳"}</Text></View>
    </View>)}
  </View>;
}
function SetupScreen() {
  return <SafeAreaView style={styles.safe}><StatusBar style="dark"/><View style={styles.setup}><Text style={styles.setupIcon}>✳</Text><Text style={styles.title}>One last setup step</Text><Text style={styles.setupBody}>Add your Firebase settings and deployed API URL to <Text style={{fontWeight:"700"}}>.env</Text>, then restart Expo. See README for setup steps.</Text></View></SafeAreaView>;
}
function previewCount(value: string) { const parsed = Number(value); return Math.max(1, Math.min(42, Number.isInteger(parsed) ? parsed : 21)); }
function previewTaken(value: string, pack: string) { const parsed = Number(value); return Math.max(0, Math.min(previewCount(pack), Number.isInteger(parsed) ? parsed : 0)); }
function errorText(error: unknown) { return error instanceof Error ? error.message.replace(/^Firebase: /, "") : "Please check your connection and try again."; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F6F5FA" }, page: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 44, maxWidth: 600, width: "100%", alignSelf: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, eyebrow: { fontSize: 9, letterSpacing: 2, color: "#77728B", fontWeight: "800", marginBottom: 7 }, title: { fontSize: 29, color: "#252238", fontWeight: "800", letterSpacing: -1 }, avatar: { width: 42, height: 42, borderRadius: 15, backgroundColor: "#E8E4FA", alignItems: "center", justifyContent: "center" }, avatarText: { fontSize: 23, color: "#6558C8" }, intro: { color: "#777487", fontSize: 14, marginTop: 7, marginBottom: 21 },
  idCard: { backgroundColor: "#6457C8", borderRadius: 21, padding: 19, marginBottom: 15 }, idHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, cardLabel: { color: "#DCD8FA", fontSize: 9, letterSpacing: 1.4, fontWeight: "800" }, lock: { color: "#DCD8FA", fontSize: 9, fontWeight: "700" }, personalId: { color: "#FFF", fontSize: 26, fontWeight: "800", letterSpacing: 3, marginTop: 12 }, cardFoot: { color: "#E2DEFF", fontSize: 11, lineHeight: 17, marginTop: 9 },
  card: { backgroundColor: "#FFF", borderRadius: 20, padding: 18, marginBottom: 13, borderWidth: 1, borderColor: "#EFEDF4" }, sectionTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, sectionTitle: { fontSize: 17, fontWeight: "800", color: "#29263B" }, muted: { color: "#858292", fontSize: 12, lineHeight: 18, marginTop: 4 }, status: { borderRadius: 20, backgroundColor: "#F1EFF8", paddingHorizontal: 9, paddingVertical: 6 }, statusDone: { backgroundColor: "#E5F4ED" }, statusText: { color: "#6F6888", fontSize: 8, fontWeight: "800", letterSpacing: .6 }, statusTextDone: { color: "#2D8A61" },
  blister: { flexDirection: "row", flexWrap: "wrap", backgroundColor: "#F1F0F5", borderRadius: 16, padding: 10, marginTop: 17 }, blisterCompact: { marginTop: 12, padding: 6 }, cell: { width: "20%", padding: 5, alignItems: "center" }, cellCompact: { width: "16.66%", padding: 3 }, pill: { width: 39, height: 39, borderRadius: 14, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#E1DDEA", alignItems: "center", justifyContent: "center", shadowColor: "#2A2540", shadowOpacity: .05, shadowRadius: 3, shadowOffset: {width:0,height:2} }, pillCompact: { width: 29, height: 29, borderRadius: 10 }, pillTaken: { backgroundColor: "#DFF1E8", borderColor: "#B8DEC9" }, pillGlyph: { color: "#A39BBF", fontSize: 15 }, pillGlyphTaken: { color: "#31815E", fontWeight: "800" },
  progressRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 13 }, progress: { fontSize: 11, color: "#716D7D", fontWeight: "600" }, link: { fontSize: 11, color: "#6558C8", fontWeight: "700" }, primaryButton: { backgroundColor: "#6457C8", borderRadius: 14, minHeight: 49, alignItems: "center", justifyContent: "center", marginTop: 16, paddingHorizontal: 15 }, primaryText: { color: "#FFF", fontSize: 13, fontWeight: "800" }, disabledButton: { opacity: .48 }, hint: { color: "#9693A1", fontSize: 10, lineHeight: 16, marginTop: 9 }, label: { fontSize: 9, letterSpacing: 1, fontWeight: "800", color: "#777386", marginTop: 18, marginBottom: 7 }, input: { height: 47, borderRadius: 12, borderWidth: 1, borderColor: "#E9E6F0", backgroundColor: "#FCFBFD", paddingHorizontal: 13, fontSize: 14, color: "#302D42" }, secondaryButton: { minHeight: 46, borderRadius: 13, borderColor: "#D9D4F0", borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 14, backgroundColor: "#FAF9FD" }, secondaryText: { color: "#5D51B5", fontWeight: "800", fontSize: 12 },
  subHeader: { flexDirection: "row", alignItems: "center", marginTop: 8, marginBottom: 10, gap: 9 }, counter: { color: "#6256C7", fontSize: 11, fontWeight: "800", backgroundColor: "#EAE7FA", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 }, followCard: { backgroundColor: "#FFF", borderWidth: 1, borderColor: "#EFEDF4", borderRadius: 18, padding: 15, marginBottom: 10 }, followTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, followTitle: { color: "#302D42", fontWeight: "800", fontSize: 14 }, followBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }, pillDot: { color: "#9389D6", fontSize: 16 }, empty: { backgroundColor: "#F0EEF6", borderRadius: 18, padding: 23, alignItems: "center" }, emptyIcon: { color: "#8E84D5", fontSize: 25, marginBottom: 7 }, emptyTitle: { color: "#39354C", fontWeight: "800", fontSize: 14, marginBottom: 2 }, footer: { textAlign: "center", color: "#A09DAB", fontSize: 10, marginTop: 20 },
  loading: { flex: 1, backgroundColor: "#F6F5FA", alignItems: "center", justifyContent: "center", gap: 12 }, busyOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "#211D3780", alignItems: "center", justifyContent: "center" }, setup: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }, setupIcon: { color: "#6558C8", fontSize: 40, marginBottom: 18 }, setupBody: { textAlign: "center", color: "#777487", lineHeight: 23, marginTop: 15, fontSize: 14 },
});
