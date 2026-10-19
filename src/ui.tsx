import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, BackHandler, Platform, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronLeft, Minus, Plus, type LucideIcon } from "lucide-react-native";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import { LANGS, setLang, useI18n } from "./i18n";
import { C, F, G, R, shadow, themedStyles } from "./theme";

export { C } from "./theme";

const nativeDriver = Platform.OS !== "web";

/** Slight scale-down while pressed. */
function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v: number) => Animated.spring(scale, { toValue: v, useNativeDriver: nativeDriver, speed: 40, bounciness: 6 }).start();
  return { scale, onPressIn: () => to(0.97), onPressOut: () => to(1) };
}

type ButtonKind = "primary" | "secondary" | "ghost" | "danger" | "light";
type ButtonProps = {
  title: string; onPress: () => void; kind?: ButtonKind; icon?: LucideIcon;
  disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean;
};

export function Button({ title, onPress, kind = "primary", icon: Icon, disabled, busy, style, compact }: ButtonProps) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const inactive = disabled || busy;
  const fg = kind === "primary" || kind === "danger" ? C.white : kind === "light" ? C.onLight : kind === "ghost" ? C.textSoft : C.primaryDeep;
  const body = (
    <View style={[st.buttonInner, compact && st.buttonCompact]}>
      {busy ? <ActivityIndicator color={fg} /> : <>
        {Icon && <Icon size={compact ? 17 : 19} color={fg} strokeWidth={2.4} />}
        <Text style={[st.buttonText, compact && { fontSize: 14 }, { color: fg }]} numberOfLines={2}>{title}</Text>
      </>}
    </View>
  );
  return (
    <Animated.View style={[{ transform: [{ scale }], marginTop: 12 }, inactive && { opacity: 0.45 }, style]}>
      <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={inactive} onPressIn={onPressIn} onPressOut={onPressOut}
        style={[st.button, kind === "primary" && shadow(2), kind === "secondary" && st.secondary, kind === "light" && st.light, kind === "danger" && st.danger]}>
        {kind === "primary"
          ? <LinearGradient colors={G.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.gradientFill}>{body}</LinearGradient>
          : body}
      </Pressable>
    </Animated.View>
  );
}

export function IconButton({ icon: Icon, onPress, label, tone = "soft", size = 42 }: {
  icon: LucideIcon; onPress: () => void; label: string; tone?: "soft" | "glass" | "plain"; size?: number;
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const bg = tone === "soft" ? C.primarySoft : tone === "glass" ? "rgba(255,255,255,0.22)" : "transparent";
  const fg = tone === "glass" ? C.white : C.primaryDeep;
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable onPress={onPress} onPressIn={onPressIn} onPressOut={onPressOut} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
        <Icon size={size * 0.48} color={fg} strokeWidth={2.3} />
      </Pressable>
    </Animated.View>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) =>
  <View style={[st.card, shadow(1), style]}>{children}</View>;

export function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 28, marginBottom: 2 }}>
      <Text style={s.h2}>{title}</Text>
      {action}
    </View>
  );
}

export function Field({ label, icon: Icon, error, ...props }: TextInputProps & { label: string; icon?: LucideIcon; error?: string | null }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[st.input, focused && st.inputFocused, !!error && { borderColor: C.danger }]}>
        {Icon && <Icon size={18} color={focused ? C.primary : C.muted} strokeWidth={2.2} />}
        <TextInput placeholderTextColor={C.placeholder} style={st.inputText} {...props}
          onFocus={(e) => { setFocused(true); props.onFocus?.(e); }} onBlur={(e) => { setFocused(false); props.onBlur?.(e); }} />
      </View>
      {!!error && <Text style={[s.small, { color: C.danger, marginTop: 6 }]}>{error}</Text>}
    </View>
  );
}

/** Screen title with a round back button; also handles the Android hardware back button. */
export function Header({ title, subtitle, onBack }: { title: string; subtitle?: string; onBack: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);
  return (
    <View style={{ marginTop: 4, marginBottom: 8 }}>
      <IconButton icon={ChevronLeft} onPress={onBack} label={t.back} />
      <Text style={[s.title, { marginTop: 16 }]}>{title}</Text>
      {subtitle ? <Text style={[s.muted, { marginTop: 4 }]}>{subtitle}</Text> : null}
    </View>
  );
}

export function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  const { t } = useI18n();
  return (
    <View style={st.stepper}>
      <IconButton icon={Minus} label={t.decrease} onPress={() => onChange(Math.max(min, value - 1))} size={40} />
      <Text style={st.stepValue}>{value}</Text>
      <IconButton icon={Plus} label={t.increase} onPress={() => onChange(Math.min(max, value + 1))} size={40} />
    </View>
  );
}

/** Single choice from a few options, as a segmented row of pills. */
export function ChipGroup<T>({ options, value, onChange }: { options: { label: string; value: T }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={st.segment}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable key={o.label} onPress={() => onChange(o.value)} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: active }}
            style={[st.segmentItem, active && [st.segmentActive, shadow(1)]]}>
            <Text style={[s.small, F.bold, { color: active ? C.primaryDeep : C.textSoft }]} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** iOS-style switch with a label. */
export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  const x = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => { Animated.spring(x, { toValue: value ? 1 : 0, useNativeDriver: false, speed: 30, bounciness: 4 }).start(); }, [value, x]);
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: value }}
      style={{ flexDirection: "row", alignItems: "center", gap: 14, marginTop: 18 }}>
      <Text style={[s.body, { flex: 1 }]}>{label}</Text>
      <Animated.View style={[st.track, { backgroundColor: x.interpolate({ inputRange: [0, 1], outputRange: [C.switchOff, C.primary] }) }]}>
        <Animated.View style={[st.thumb, shadow(1), { transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [2, 22] }) }] }]} />
      </Animated.View>
    </Pressable>
  );
}

export function Badge({ label, tone, icon: Icon }: { label: string; tone: "success" | "primary" | "danger" | "neutral" | "glass"; icon?: LucideIcon }) {
  const [bg, fg] = {
    success: [C.successSoft, C.success], primary: [C.primarySoft, C.primaryDeep], danger: [C.dangerSoft, C.danger],
    neutral: [C.neutralSoft, C.textSoft], glass: ["rgba(255,255,255,0.22)", C.white],
  }[tone];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: bg, borderRadius: R.full, paddingHorizontal: 11, paddingVertical: 5 }}>
      {Icon && <Icon size={14} color={fg} strokeWidth={2.6} />}
      <Text style={[s.small, F.bold, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Circular progress (0–1) with content in the middle. */
export function ProgressRing({ progress, size = 96, stroke = 9, light, children }: {
  progress: number; size?: number; stroke?: number; light?: boolean; children?: React.ReactNode;
}) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="ring" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={light ? "#FFFFFF" : G.primary[0]} />
            <Stop offset="1" stopColor={light ? "#FFE3EC" : G.primary[1]} />
          </SvgGradient>
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={light ? "rgba(255,255,255,0.25)" : C.primarySoft} strokeWidth={stroke} fill="none" />
        <Circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ring)" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`} strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, progress)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </Svg>
      {children}
    </View>
  );
}

export function LanguageSwitch() {
  const { lang } = useI18n();
  return (
    <View style={[st.segment, { marginTop: 0, padding: 3 }]}>
      {LANGS.map((l) => (
        <Pressable key={l} onPress={() => setLang(l)} accessibilityRole="button" accessibilityLabel={l.toUpperCase()} accessibilityState={{ selected: l === lang }}
          style={[{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: R.full }, l === lang && [{ backgroundColor: C.card }, shadow(1)]]}>
          <Text style={[s.small, F.extrabold, { color: l === lang ? C.primaryDeep : C.muted }]}>{l.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Small text-style button (e.g. "Forgot password?"). */
export const LinkButton = ({ title, onPress, color = C.primaryDeep, icon: Icon }: { title: string; onPress: () => void; color?: string; icon?: LucideIcon }) => (
  <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={title} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingVertical: 10 }}>
    {Icon && <Icon size={16} color={color} strokeWidth={2.4} />}
    <Text style={[s.body, F.bold, { color }]}>{title}</Text>
  </Pressable>
);

export const s = themedStyles(() => ({
  title: { ...F.extrabold, fontSize: 30, color: C.text, letterSpacing: -0.6 },
  h1: { ...F.extrabold, fontSize: 24, color: C.text, letterSpacing: -0.4 },
  h2: { ...F.bold, fontSize: 18, color: C.text, letterSpacing: -0.2 },
  body: { ...F.medium, fontSize: 15, color: C.text, lineHeight: 22 },
  muted: { ...F.medium, fontSize: 14, color: C.textSoft, lineHeight: 20 },
  small: { ...F.medium, fontSize: 13, color: C.textSoft },
  label: { ...F.semibold, fontSize: 13, color: C.textSoft, marginBottom: 8 },
  eyebrow: { ...F.bold, fontSize: 12, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted },
}));

const st = themedStyles(() => ({
  button: { borderRadius: R.md, overflow: "hidden" },
  gradientFill: { borderRadius: R.md },
  buttonInner: { minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 20 },
  buttonCompact: { minHeight: 42, paddingHorizontal: 14 },
  buttonText: { ...F.bold, fontSize: 16, textAlign: "center", flexShrink: 1 },
  secondary: { backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  light: { backgroundColor: C.white },
  danger: { backgroundColor: C.danger },
  card: { backgroundColor: C.card, borderRadius: R.lg, padding: 20, marginTop: 16, borderWidth: 1, borderColor: C.cardEdge },
  input: { flexDirection: "row", alignItems: "center", gap: 10, height: 54, borderRadius: R.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.primaryTint, paddingHorizontal: 16 },
  inputFocused: { borderColor: C.primary, backgroundColor: C.card },
  inputText: { ...F.medium, flex: 1, fontSize: 16, color: C.text, height: "100%", outlineStyle: "none" } as object,
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 18, marginTop: 10 },
  stepValue: { ...F.extrabold, fontSize: 36, color: C.text, minWidth: 70, textAlign: "center", fontVariant: ["tabular-nums"] },
  segment: { flexDirection: "row", flexWrap: "wrap", backgroundColor: C.segment, borderRadius: R.md, padding: 4, gap: 4, marginTop: 10 },
  segmentItem: { flexGrow: 1, alignItems: "center", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12 },
  segmentActive: { backgroundColor: C.card },
  track: { width: 50, height: 30, borderRadius: 15, justifyContent: "center" },
  thumb: { width: 26, height: 26, borderRadius: 13, backgroundColor: C.white },
}));
