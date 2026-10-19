import React, { useEffect } from "react";
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from "react-native";
import { notify } from "./dialog";
import { LANGS, setLang, strings, useI18n } from "./i18n";

export const C = {
  bg: "#F7F1F4",
  card: "#FFFFFF",
  border: "#EEDFE6",
  primary: "#C2577A",
  primaryDark: "#A3415F",
  primarySoft: "#F8E4EC",
  text: "#3B2A33",
  muted: "#8A7480",
  success: "#2F8F6B",
  successSoft: "#E1F3EA",
};

type ButtonProps = { title: string; onPress: () => void; kind?: "primary" | "secondary" | "ghost"; disabled?: boolean; busy?: boolean; style?: ViewStyle };

export function Button({ title, onPress, kind = "primary", disabled, busy, style }: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [s.button, s[kind], (disabled || busy) && s.disabled, pressed && s.pressed, style]}
    >
      {busy ? <ActivityIndicator color={kind === "primary" ? "#FFF" : C.primary} />
        : <Text style={[s.buttonText, kind !== "primary" && s.buttonTextAlt]}>{title}</Text>}
    </Pressable>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: ViewStyle }) =>
  <View style={[s.card, style]}>{children}</View>;

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginTop: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor="#B9A7B0" style={s.input} {...props} />
    </View>
  );
}

/** Screen title with a back link; also handles the Android hardware back button. */
export function Header({ title, onBack }: { title: string; onBack: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  return (
    <View style={s.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t.back} hitSlop={12} style={s.back}>
        <Text style={s.backText}>{t.back}</Text>
      </Pressable>
      <Text style={s.title}>{title}</Text>
    </View>
  );
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  return (
    <View style={s.stepper}>
      <Pressable accessibilityLabel={t.decrease} onPress={() => onChange(Math.max(min, value - 1))} style={s.stepBtn} disabled={value <= min}>
        <Text style={[s.stepBtnText, value <= min && { opacity: 0.3 }]}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable accessibilityLabel={t.increase} onPress={() => onChange(Math.min(max, value + 1))} style={s.stepBtn} disabled={value >= max}>
        <Text style={[s.stepBtnText, value >= max && { opacity: 0.3 }]}>+</Text>
      </Pressable>
    </View>
  );
}

export const s = StyleSheet.create({
  button: { minHeight: 50, borderRadius: 14, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, marginTop: 10 },
  primary: { backgroundColor: C.primary },
  secondary: { backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  ghost: { backgroundColor: "transparent" },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { color: "#FFF", fontSize: 16, fontWeight: "700", textAlign: "center" },
  buttonTextAlt: { color: C.primaryDark },
  card: { backgroundColor: C.card, borderRadius: 20, padding: 18, marginTop: 14, borderWidth: 1, borderColor: C.border },
  label: { fontSize: 13, fontWeight: "600", color: C.muted, marginBottom: 6 },
  input: { height: 50, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: "#FFFBFD", paddingHorizontal: 14, fontSize: 17, color: C.text },
  header: { marginBottom: 6 },
  back: { paddingVertical: 6, alignSelf: "flex-start" },
  backText: { color: C.primaryDark, fontSize: 16, fontWeight: "600" },
  title: { fontSize: 28, fontWeight: "800", color: C.text, marginTop: 4 },
  h2: { fontSize: 18, fontWeight: "700", color: C.text },
  body: { fontSize: 15, color: C.text, lineHeight: 21 },
  muted: { fontSize: 14, color: C.muted, lineHeight: 20 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 12 },
  stepBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.primarySoft, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 28, color: C.primaryDark, fontWeight: "600", marginTop: -2 },
  stepValue: { fontSize: 40, fontWeight: "800", color: C.text, minWidth: 90, textAlign: "center", fontVariant: ["tabular-nums"] },
});

export function LanguageSwitch() {
  const { lang } = useI18n();
  return (
    <View style={{ flexDirection: "row", backgroundColor: C.primarySoft, borderRadius: 12, padding: 3 }}>
      {LANGS.map((l) => (
        <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="button" accessibilityState={{ selected: l === lang }}
          style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 9, backgroundColor: l === lang ? C.card : "transparent" }}>
          <Text style={{ fontWeight: "700", fontSize: 13, color: l === lang ? C.primaryDark : C.muted }}>{l.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Small text-style button (e.g. "Forgot password?"). */
export const LinkButton = ({ title, onPress, color = C.primaryDark }: { title: string; onPress: () => void; color?: string }) => (
  <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={{ alignSelf: "center", paddingVertical: 10 }}>
    <Text style={{ color, fontWeight: "600", fontSize: 15 }}>{title}</Text>
  </Pressable>
);

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * For Firestore writes that are fine to sync later: the local cache (and every listener) updates
 * immediately, but the promise only settles once the server confirms, which never happens while
 * offline. So don't block the UI on it; just report a rejection if one comes.
 */
export const queued = (write: Promise<unknown>) => { write.catch((e) => notify(strings().errorTitle, errorText(e))); };
