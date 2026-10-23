import { useSyncExternalStore } from "react";
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";

export const fonts = {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold,
};

/** Gradient stops; LinearGradient needs at least two. */
type Stops = readonly [string, string, ...string[]];

const light = {
  dark: false,
  bg: "#FBF6F9",
  card: "#FFFFFF",
  cardEdge: "#F6EDF2",
  border: "#F1E4EB",
  text: "#2B1A25",
  textSoft: "#6E5866",
  muted: "#A08C98",
  placeholder: "#C1AFB9",
  primary: "#D4567D",
  primaryDeep: "#A63A63",
  primarySoft: "#FCE8EF",
  primaryTint: "#FFF4F8",
  success: "#159C68",
  successSoft: "#E2F6EC",
  warning: "#B86E0B",
  warningSoft: "#FFF2DD",
  danger: "#D24545",
  dangerSoft: "#FDE9E9",
  white: "#FFFFFF",
  /** Text on the white "light" buttons that sit on gradients. */
  onLight: "#A63A63",
  segment: "#F5ECF1",
  switchOff: "#E6D9E0",
  neutralSoft: "#F2EDF0",
  calendarOpen: "#F7F1F4",
  handle: "#E8DCE3",
  closeBg: "#F5EEF2",
  overlay: "rgba(38,14,30,0.45)",
  // Blister foil and pills
  foil: ["#EEF0F4", "#D5D9E1", "#E4E7EC", "#C6CBD4"],
  foilStroke: "#B3B9C4",
  perforation: "#AEB4BF",
  blisterLabel: "#8A90A0",
  hole: ["#9EA5B2", "#7A8291"],
  torn: "#F4F5F8",
  tornStroke: "#A7AEBA",
  tornInner: "#C5CAD3",
  pillShadow: "#9AA1AE",
  breakStroke: "#A9B0BC",
  placebo: ["#FFFFFF", "#F1F2F5", "#C9CDD5"],
  placeboStroke: "#BFC4CD",
  dome: ["#FFFFFF", "#F9D7E2", "#E7A5BC"],
  domeStroke: "#D7A3B6",
  gradient: {
    primary: ["#EA6E92", "#B9416C"] as Stops,
    hero: ["#EF7A98", "#C14A78", "#8E3B7A"] as Stops,
    avatar: ["#F6A5BC", "#C95C8A"] as Stops,
  },
};
export type Palette = typeof light;

const dark: Palette = {
  dark: true,
  bg: "#120C10",
  card: "#1E161B",
  cardEdge: "#2A1F25",
  border: "#33262E",
  text: "#F7ECF2",
  textSoft: "#CDB8C3",
  muted: "#8E7985",
  placeholder: "#6E5A65",
  primary: "#F07A9C",
  primaryDeep: "#F6A3BC",
  primarySoft: "#3A1F2C",
  primaryTint: "#24171E",
  success: "#4FD39C",
  successSoft: "#15382A",
  warning: "#F3B65C",
  warningSoft: "#392911",
  danger: "#F27474",
  dangerSoft: "#3D1B1F",
  white: "#FFFFFF",
  onLight: "#A63A63",
  segment: "#2A1D24",
  switchOff: "#4A3A43",
  neutralSoft: "#2C2228",
  calendarOpen: "#271D23",
  handle: "#4A3A43",
  closeBg: "#2E2229",
  overlay: "rgba(0,0,0,0.6)",
  foil: ["#5A5F69", "#454A54", "#50555F", "#3A3E47"],
  foilStroke: "#2E3239",
  perforation: "#6B717C",
  blisterLabel: "#B7BCC7",
  hole: ["#262A31", "#1B1E23"],
  torn: "#4D525C",
  tornStroke: "#30343B",
  tornInner: "#646A75",
  pillShadow: "#15171B",
  breakStroke: "#7C828E",
  placebo: ["#F4F5F8", "#D9DCE2", "#A7ADB8"],
  placeboStroke: "#8D939E",
  dome: ["#FFFFFF", "#F7C9D8", "#D98AA6"],
  domeStroke: "#B9758F",
  gradient: {
    primary: ["#E0668A", "#A93E6A"],
    hero: ["#B84A74", "#7E2E62", "#4A1E4E"],
    avatar: ["#D9809F", "#9C3F6B"],
  },
};

/** The active palette. Mutated in place on a theme switch; screens re-render and read the new values. */
export const C: Palette = { ...light, gradient: { ...light.gradient } };
/** Gradient stops (top-left → bottom-right) of the active palette. */
export const G = C.gradient;

// ---------- Appearance (system / light / dark) ----------

export type Appearance = "system" | "light" | "dark";
const KEY = "appearance";
let appearance: Appearance = "system";
let systemDark = false;
let version = 0;
const listeners = new Set<() => void>();

function apply() {
  const next = appearance === "dark" || (appearance === "system" && systemDark) ? dark : light;
  if (next.dark === C.dark && version > 0) return;
  Object.assign(C, { ...next, gradient: G });
  Object.assign(G, next.gradient);
  version++;
  if (Platform.OS === "web") document.body.style.background = C.bg;
  listeners.forEach((l) => l());
}

export function setAppearance(a: Appearance) {
  appearance = a;
  AsyncStorage.setItem(KEY, a).catch(() => undefined);
  apply();
  listeners.forEach((l) => l()); // the setting itself changed even if the palette didn't
}
export const getAppearance = () => appearance;

export async function loadAppearance(isSystemDark: boolean) {
  const saved = await AsyncStorage.getItem(KEY).catch(() => null);
  if (saved === "light" || saved === "dark" || saved === "system") appearance = saved;
  systemDark = isSystemDark;
  apply();
}
export function setSystemDark(isDark: boolean) {
  systemDark = isDark;
  apply();
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getVersion = () => version;
/** Changes whenever the palette (or the appearance setting) changes; used as a remount key. */
export const useThemeVersion = () => useSyncExternalStore(subscribe, getVersion, getVersion);
export const useAppearance = () => useSyncExternalStore(subscribe, getAppearance, getAppearance);

/**
 * A StyleSheet whose colors follow the active palette: rebuilt lazily after a theme switch.
 * Use like a normal style object (`st.card`).
 */
type Styles = Parameters<typeof StyleSheet.create>[0];
export function themedStyles<S extends Styles>(factory: () => S & Styles): Readonly<S> {
  let built = -1;
  let sheet = {} as Readonly<S>;
  return new Proxy({} as Readonly<S>, {
    get(_, key) {
      if (built !== version) { sheet = StyleSheet.create(factory()); built = version; }
      return sheet[key as keyof S];
    },
  });
}

/** Each weight is its own font file (Android ignores fontWeight for custom fonts). */
// On the web a family list works, so a clean system sans-serif shows until (or if) the font file arrives.
const fallback = Platform.OS === "web" ? ", system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : "";
const family = (name: string): TextStyle => ({ fontFamily: name + fallback });
export const F: Record<"regular" | "medium" | "semibold" | "bold" | "extrabold", TextStyle> = {
  regular: family("PlusJakartaSans_400Regular"),
  medium: family("PlusJakartaSans_500Medium"),
  semibold: family("PlusJakartaSans_600SemiBold"),
  bold: family("PlusJakartaSans_700Bold"),
  extrabold: family("PlusJakartaSans_800ExtraBold"),
};

export const R = { sm: 12, md: 16, lg: 22, xl: 28, full: 999 };

/** Soft, warm-tinted elevation that renders on iOS, Android and the web. */
export const shadow = (level: 1 | 2 | 3 = 1): ViewStyle => {
  const [opacity, radius, y, elevation] = level === 1 ? [0.06, 12, 4, 2] : level === 2 ? [0.1, 20, 8, 5] : [0.18, 30, 14, 10];
  const color = C.dark ? "#000000" : "#7A2E52";
  return Platform.select({
    android: { elevation, shadowColor: color },
    default: { shadowColor: color, shadowOpacity: C.dark ? opacity * 3 : opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y } },
  })!;
};
