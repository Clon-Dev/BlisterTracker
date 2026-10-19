// In-app bottom sheets and toasts (instead of system alerts), opened imperatively:
//   const ok = await confirm({ title, message, confirmLabel, destructive: true });
//   const value = await openSheet<string>((done) => <MyContent onPick={done} />);
// <SheetHost /> and <ToastHost /> are rendered once at the app root.
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Animated, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react-native";
import { strings } from "./i18n";
import { C, F, R, shadow, themedStyles, useThemeVersion } from "./theme";
import { Button, s } from "./ui";

const nativeDriver = Platform.OS !== "web";

// ---------- Tiny store ----------

function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => { value = next; listeners.forEach((l) => l()); },
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}

type Entry = { id: number; render: (done: (value?: unknown) => void) => React.ReactNode; resolve: (value: unknown) => void };
const sheets = store<Entry[]>([]);
let nextId = 1;

/** Opens a sheet; resolves with the value passed to `done`, or undefined when dismissed. */
export function openSheet<T>(render: (done: (value?: T) => void) => React.ReactNode): Promise<T | undefined> {
  return new Promise((resolve) => {
    const entry: Entry = { id: nextId++, render: render as Entry["render"], resolve: resolve as Entry["resolve"] };
    sheets.set([...sheets.get(), entry]);
  });
}

export function SheetHost() {
  const entries = useSyncExternalStore(sheets.subscribe, sheets.get, sheets.get);
  const themeVersion = useThemeVersion();
  return <>{entries.map((e) => <SheetFrame key={`${e.id}-${themeVersion}`} entry={e} />)}</>;
}

function SheetFrame({ entry }: { entry: Entry }) {
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: nativeDriver, speed: 18, bounciness: 4 }).start();
  }, [progress]);
  const done = (value?: unknown) => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: nativeDriver }).start(() => {
      sheets.set(sheets.get().filter((e) => e.id !== entry.id));
      entry.resolve(value);
    });
  };
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => done()} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end" }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: C.overlay, opacity: progress }]}>
          <Pressable style={{ flex: 1 }} onPress={() => done()} accessibilityLabel={strings().cancel} />
        </Animated.View>
        <Animated.View style={[st.sheet, shadow(3), { paddingBottom: 24 + insets.bottom },
          { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [500, 0] }) }] }]}>
          <View style={st.handle} />
          <Pressable onPress={() => done()} accessibilityRole="button" accessibilityLabel={strings().cancel} hitSlop={10} style={st.close}>
            <X size={18} color={C.textSoft} strokeWidth={2.4} />
          </Pressable>
          {entry.render(done)}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Round icon above a sheet title. */
export const SheetIcon = ({ icon: Icon, tone = "primary" }: { icon: LucideIcon; tone?: "primary" | "danger" | "success" | "warning" }) => {
  const [bg, fg] = { primary: [C.primarySoft, C.primaryDeep], danger: [C.dangerSoft, C.danger], success: [C.successSoft, C.success], warning: [C.warningSoft, C.warning] }[tone];
  return (
    <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: bg, alignItems: "center", justifyContent: "center", marginBottom: 14 }}>
      <Icon size={26} color={fg} strokeWidth={2.2} />
    </View>
  );
};

export function confirm(opts: { title: string; message?: string; confirmLabel: string; destructive?: boolean; icon?: LucideIcon }) {
  return openSheet<boolean>((done) => (
    <View>
      {opts.icon && <SheetIcon icon={opts.icon} tone={opts.destructive ? "danger" : "primary"} />}
      <Text style={s.h1}>{opts.title}</Text>
      {opts.message ? <Text style={[s.muted, { marginTop: 8 }]}>{opts.message}</Text> : null}
      <Button title={opts.confirmLabel} kind={opts.destructive ? "danger" : "primary"} onPress={() => done(true)} style={{ marginTop: 22 }} />
      <Button title={strings().cancel} kind="ghost" onPress={() => done(false)} style={{ marginTop: 4 }} />
    </View>
  )).then((v) => v === true);
}

export function alert(title: string, message?: string) {
  return openSheet<void>((done) => (
    <View>
      <SheetIcon icon={Info} />
      <Text style={s.h1}>{title}</Text>
      {message ? <Text style={[s.muted, { marginTop: 8 }]}>{message}</Text> : null}
      <Button title="OK" onPress={() => done()} style={{ marginTop: 22 }} />
    </View>
  )).then(() => undefined);
}

// ---------- Toasts ----------

type Toast = { id: number; message: string; tone: "success" | "error" };
const toasts = store<Toast[]>([]);

/** Short, self-dismissing confirmation at the top of the screen. */
export function toast(message: string, tone: Toast["tone"] = "success") {
  const id = nextId++;
  toasts.set([...toasts.get(), { id, message, tone }]);
  setTimeout(() => toasts.set(toasts.get().filter((x) => x.id !== id)), 3200);
}

export function ToastHost() {
  const items = useSyncExternalStore(toasts.subscribe, toasts.get, toasts.get);
  const insets = useSafeAreaInsets();
  useThemeVersion();
  return (
    <View pointerEvents="none" style={{ position: "absolute", top: insets.top + 10, left: 16, right: 16, alignItems: "center", gap: 8 }}>
      {items.map((x) => <ToastView key={x.id} toast={x} />)}
    </View>
  );
}

function ToastView({ toast: x }: { toast: Toast }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [Icon] = useState(() => (x.tone === "success" ? CheckCircle2 : AlertTriangle));
  useEffect(() => {
    Animated.sequence([
      Animated.spring(progress, { toValue: 1, useNativeDriver: nativeDriver, speed: 16, bounciness: 6 }),
      Animated.delay(2500),
      Animated.timing(progress, { toValue: 0, duration: 250, useNativeDriver: nativeDriver }),
    ]).start();
  }, [progress]);
  return (
    <Animated.View style={[st.toast, shadow(2), {
      opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }],
    }]}>
      <View style={{ width: 22 }}><Icon size={22} color={x.tone === "success" ? C.success : C.danger} strokeWidth={2.4} /></View>
      <Text style={[s.body, F.semibold, { flexShrink: 1 }]}>{x.message}</Text>
    </Animated.View>
  );
}

const st = themedStyles(() => ({
  sheet: {
    backgroundColor: C.card, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, paddingHorizontal: 22, paddingTop: 12,
    width: "100%", maxWidth: 560, alignSelf: "center",
  },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: C.handle, alignSelf: "center", marginBottom: 14 },
  close: { position: "absolute", right: 16, top: 16, width: 34, height: 34, borderRadius: 17, backgroundColor: C.closeBg, alignItems: "center", justifyContent: "center", zIndex: 1 },
  toast: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: C.card, borderRadius: R.lg, paddingHorizontal: 18, paddingVertical: 13, maxWidth: 480 },
}));
