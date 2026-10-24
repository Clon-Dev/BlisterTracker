// The cycle views for patch (4-week strip), ring (ring dial) and injection (window bar), instead of the blister.
import { Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Clock3, X } from "lucide-react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { actionState, addDays, cycleLength, diffDays, openActionDay, slot, type DayState, type Plan } from "../../shared/schedule";
import { formatDay, useI18n } from "../i18n";
import { C, F, R, themedStyles } from "../theme";
import { s } from "../ui";

export { actionState };

const stateColor = (st: DayState) =>
  st === "done" ? C.success : st === "late" ? C.warning : st === "missed" ? C.danger : st === "open" ? C.primary : C.muted;

function StateBadge({ state }: { state: DayState }) {
  if (state === "future") return null;
  const Icon = state === "done" ? Check : state === "late" ? Clock3 : state === "missed" ? X : null;
  return (
    <View style={[st.badge, { backgroundColor: stateColor(state) }]}>
      {Icon ? <Icon size={11} color={C.white} strokeWidth={3} /> : <View style={st.badgeDot} />}
    </View>
  );
}

// ---------- Patch: one tile per week ----------

const SKIN_LIGHT = ["#F8E1D2", "#ECC4AB"] as const;
const SKIN_DARK = ["#C9A38D", "#A27A64"] as const;

export function PatchStrip({ plan, today, onPressDay }: { plan: Plan; today: string; onPressDay?: (day: string) => void }) {
  const { t, lang } = useI18n();
  const { packStart, index } = slot(plan, today);
  const weeks = cycleLength(plan) / 7;
  const wearWeeks = plan.pillsPerPack / 7;
  const tiles = Array.from({ length: weeks }, (_, w) => {
    const day = addDays(packStart, w * 7);
    return { w, day, free: w >= wearWeeks, state: actionState(plan, day, today), current: Math.floor(index / 7) === w };
  });
  const rows = [];
  for (let i = 0; i < tiles.length; i += 4) rows.push(tiles.slice(i, i + 4));
  return (
    <View style={{ gap: 10, marginTop: 16 }}>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 8 }}>
          {row.map((tile) => (
            <Pressable key={tile.day} onPress={() => onPressDay?.(tile.day)} disabled={!onPressDay || tile.day > today}
              accessibilityRole="button" accessibilityLabel={`${tile.free ? t.weekPatchFree : t.weekPatch({ n: tile.w + 1 })}, ${formatDay(tile.day, lang)}`}
              style={[st.tile, tile.current && st.tileCurrent]}>
              <Text style={[s.small, F.bold, { color: tile.current ? C.primaryDeep : C.textSoft }]} numberOfLines={1}>
                {tile.free ? t.weekPatchFree : t.weekPatch({ n: tile.w + 1 })}
              </Text>
              <View style={st.patchArea}>
                {tile.free
                  ? <View style={st.patchFree} />
                  : <LinearGradient colors={C.dark ? SKIN_DARK : SKIN_LIGHT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.patch, tile.state === "future" && !tile.current && { opacity: 0.55 }]}>
                      <View style={st.patchInner} />
                    </LinearGradient>}
                <View style={{ position: "absolute", top: -4, right: -4 }}><StateBadge state={tile.state} /></View>
              </View>
              <Text style={[s.small, { fontSize: 11 }]} numberOfLines={1}>{formatDay(tile.day, lang)}</Text>
              {tile.current && (
                <View style={st.dots}>
                  {Array.from({ length: 7 }, (_, d) => <View key={d} style={[st.dot, d <= index % 7 && { backgroundColor: C.primary }]} />)}
                </View>
              )}
            </Pressable>
          ))}
          {Array.from({ length: 4 - row.length }, (_, i) => <View key={`pad${i}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  );
}

// ---------- Ring: a dial of the cycle's days ----------

const polar = (cx: number, cy: number, r: number, deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

export function RingDial({ plan, today, size, children }: { plan: Plan; today: string; size: number; children?: React.ReactNode }) {
  const n = cycleLength(plan);
  const wear = plan.pillsPerPack;
  const { packStart, index } = slot(plan, today);
  const c = size / 2;
  const r = c - 16;
  const step = 360 / n;
  const gap = n > 30 ? 1.2 : 2.6;
  const at = (i: number) => -90 + i * step;
  const markers = [0, ...(plan.breakDays > 0 ? [wear] : [])].map((i) => ({ i, state: actionState(plan, addDays(packStart, i), today) }));
  return (
    <View style={{ width: size, height: size, alignSelf: "center", marginTop: 16, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        {Array.from({ length: n }, (_, i) => {
          const inWear = i < wear;
          const color = !inWear ? C.placeboStroke : i <= index ? C.primary : C.primarySoft;
          return (
            <Path key={i} d={arc(c, c, r, at(i) + gap / 2, at(i + 1) - gap / 2)} stroke={color} fill="none" strokeLinecap="round"
              strokeWidth={i === index ? 18 : inWear ? 12 : 6} strokeDasharray={inWear ? undefined : "2 4"} opacity={inWear && i > index ? 0.9 : 1} />
          );
        })}
        {(() => {
          const [x, y] = polar(c, c, r, at(index + 0.5));
          return <Circle cx={x} cy={y} r={5} fill={C.white} stroke={C.primary} strokeWidth={2.5} />;
        })()}
        {markers.map(({ i, state }) => {
          const [x, y] = polar(c, c, r + 13, at(i) + 1);
          return <Circle key={i} cx={x} cy={y} r={5} fill={state === "future" ? C.card : stateColor(state)} stroke={stateColor(state)} strokeWidth={2} />;
        })}
      </Svg>
      {children}
    </View>
  );
}

// ---------- Injection: the window between earliest and latest ----------

export function InjectionWindow({ plan, today }: { plan: Plan; today: string }) {
  const { t, lang } = useI18n();
  const cycle = cycleLength(plan);
  const open = openActionDay(plan, today);
  const last = open ? addDays(open, -cycle) : slot(plan, today).packStart;
  const elapsed = diffDays(last, today);
  // familienplanung.de: the 3-month injection usually after 12 weeks, at the earliest after 10, at the latest after 14.
  const earliest = cycle === 84 ? 70 : null;
  const latest = cycle >= 84 ? 98 : null;
  const span = Math.max(15 * 7, cycle + 21);
  const x = (d: number) => `${Math.min(100, Math.max(0, (d / span) * 100))}%` as const;
  const zones = [
    { from: 0, to: earliest ?? cycle, color: C.successSoft },
    ...(earliest ? [{ from: earliest, to: cycle, color: C.success }] : []),
    { from: cycle, to: latest ?? cycle + 7, color: C.warning },
    { from: latest ?? cycle + 7, to: span, color: C.danger },
  ];
  const labels = [
    ...(earliest ? [{ d: earliest, text: t.injectionEarliest }] : []),
    { d: cycle, text: t.injectionDue },
    ...(latest ? [{ d: latest, text: t.injectionLatest }] : []),
  ];
  return (
    <View style={{ marginTop: 20 }}>
      <View style={st.bar}>
        {zones.map((z, i) => <View key={i} style={{ position: "absolute", top: 0, bottom: 0, left: x(z.from), width: `${((z.to - z.from) / span) * 100}%`, backgroundColor: z.color }} />)}
      </View>
      <View style={[st.todayPin, { left: x(elapsed) }]} accessibilityLabel={`${elapsed}`}>
        <View style={st.todayStem} />
        <View style={st.todayDot} />
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 14 }}>
        {labels.map((l) => (
          <View key={l.d} style={{ alignItems: "center", flex: 1 }}>
            <Text style={[s.eyebrow, { fontSize: 10 }]}>{l.text}</Text>
            <Text style={[s.small, F.bold, { color: C.text }]}>{formatDay(addDays(last, l.d), lang)}</Text>
          </View>
        ))}
      </View>
      <Text style={[s.small, { textAlign: "center", marginTop: 12 }]}>{t.injectionLast({ day: formatDay(last, lang) })}</Text>
    </View>
  );
}

const st = themedStyles(() => ({
  tile: { flex: 1, alignItems: "center" as const, gap: 6, paddingVertical: 10, paddingHorizontal: 4, borderRadius: R.md, backgroundColor: C.calendarOpen, borderWidth: 2, borderColor: "transparent" },
  tileCurrent: { borderColor: C.primary, backgroundColor: C.primaryTint },
  patchArea: { width: 48, height: 48, alignItems: "center" as const, justifyContent: "center" as const },
  patch: { width: 44, height: 44, borderRadius: 12, alignItems: "center" as const, justifyContent: "center" as const, transform: [{ rotate: "-8deg" }] },
  patchInner: { width: 26, height: 26, borderRadius: 7, borderWidth: 1.5, borderColor: "rgba(255,255,255,0.75)", borderStyle: "dashed" as const },
  patchFree: { width: 40, height: 40, borderRadius: 11, borderWidth: 2, borderColor: C.placeboStroke, borderStyle: "dashed" as const },
  badge: { width: 18, height: 18, borderRadius: 9, alignItems: "center" as const, justifyContent: "center" as const, borderWidth: 2, borderColor: C.card },
  badgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.white },
  dots: { flexDirection: "row" as const, gap: 3 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.border },
  bar: { height: 14, borderRadius: 7, overflow: "hidden" as const, backgroundColor: C.border },
  todayPin: { position: "absolute" as const, top: -8, marginLeft: -7, alignItems: "center" as const },
  todayStem: { width: 3, height: 26, borderRadius: 2, backgroundColor: C.text },
  todayDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.text, borderWidth: 3, borderColor: C.card, marginTop: -4 },
}));
