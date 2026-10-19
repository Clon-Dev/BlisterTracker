import { memo, useMemo } from "react";
import { Platform, Pressable, View } from "react-native";
import { useI18n } from "./i18n";
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

type Props = {
  count: number;
  taken: number;
  width: number;
  /** Highlight the next pill to take. */
  showNext?: boolean;
  /** Tap pill i (0-based): used in setup to mark pills 0..i as taken. */
  onPressPill?: (index: number) => void;
  /** Weekday (0 = Monday) of the first pill in the pack; shows day labels above the columns. */
  startWeekday?: number;
};

// Deterministic pseudo-random in [0, 1) so every blister looks the same on every render/device.
const rand = (a: number, b: number) => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Torn foil outline around (cx, cy): a jagged polygon whose spikes vary per pill. */
function tornPath(cx: number, cy: number, r: number, seed: number) {
  const points = 18;
  let d = "";
  for (let k = 0; k < points; k++) {
    const angle = (k / points) * Math.PI * 2 + rand(seed, k) * 0.2;
    const radius = r * (k % 2 ? 0.78 + rand(seed, k + 40) * 0.12 : 0.95 + rand(seed, k + 80) * 0.15);
    d += `${k ? "L" : "M"}${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  }
  return d + "Z";
}

/** Weekday (0 = Monday) of pill 0, given that pill `taken` is due today (or tomorrow if today's is done). */
export function packStartWeekday(taken: number, doneToday: boolean) {
  const todayMon0 = (new Date().getDay() + 6) % 7;
  const nextPillDay = todayMon0 + (doneToday ? 1 : 0);
  return (((nextPillDay - taken) % 7) + 7) % 7;
}

export const Blister = memo(function Blister({ count, taken, width, showNext = true, onPressPill, startWeekday }: Props) {
  const { t } = useI18n();
  const cols = count <= 7 ? count : 7;
  const rows = Math.ceil(count / cols);
  const pad = width * 0.06;
  const cell = (width - pad * 2) / cols;
  const labelBand = cols === 7 && startWeekday !== undefined ? cell * 0.42 : 0;
  const height = pad * 2 + labelBand + rows * cell;
  const r = cell * 0.34;

  const pills = useMemo(() => Array.from({ length: count }, (_, i) => {
    const row = Math.floor(i / cols);
    const inRow = Math.min(cols, count - row * cols);
    // Center a partial last row.
    const offset = ((cols - inRow) * cell) / 2;
    return { i, cx: pad + offset + (i % cols) * cell + cell / 2, cy: pad + labelBand + row * cell + cell / 2 };
  }), [count, cols, cell, pad, labelBand]);

  const svg = (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Defs>
        <LinearGradient id="foil" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#EEF0F4" />
          <Stop offset="0.45" stopColor="#D5D9E1" />
          <Stop offset="0.55" stopColor="#E4E7EC" />
          <Stop offset="1" stopColor="#C6CBD4" />
        </LinearGradient>
        <RadialGradient id="dome" cx="0.38" cy="0.32" r="0.75">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.55" stopColor="#F9D7E2" />
          <Stop offset="1" stopColor="#E7A5BC" />
        </RadialGradient>
        <RadialGradient id="hole" cx="0.5" cy="0.5" r="0.6">
          <Stop offset="0" stopColor="#9EA5B2" />
          <Stop offset="1" stopColor="#7A8291" />
        </RadialGradient>
      </Defs>

      <Rect x={1} y={1} width={width - 2} height={height - 2} rx={width * 0.05} fill="url(#foil)" stroke="#B3B9C4" strokeWidth={1.5} />
      {/* Perforation lines between rows. */}
      {Array.from({ length: rows - 1 }, (_, row) => (
        <Path key={`perf${row}`} d={`M${pad} ${pad + labelBand + (row + 1) * cell}H${width - pad}`}
          stroke="#AEB4BF" strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {labelBand > 0 && t.weekdays.map((_, c) => (
        <SvgText key={c} x={pad + c * cell + cell / 2} y={pad + labelBand * 0.7} fontSize={cell * 0.24}
          fontWeight="700" fill="#7D8594" fontFamily={Platform.OS === "web" ? "system-ui, sans-serif" : undefined} textAnchor="middle">{t.weekdays[(startWeekday! + c) % 7]}</SvgText>
      ))}

      {pills.map(({ i, cx, cy }) => {
        const isTaken = i < taken;
        const isNext = showNext && i === taken;
        return (
          <G key={i}>
            {isTaken ? (
              <>
                <Path d={tornPath(cx, cy, r * 1.08, i + 1)} fill="#F4F5F8" stroke="#A7AEBA" strokeWidth={1} />
                <Circle cx={cx} cy={cy} r={r * 0.78} fill="url(#hole)" />
                <Path d={tornPath(cx, cy, r * 0.8, i + 99)} fill="none" stroke="#C5CAD3" strokeWidth={1.2} />
              </>
            ) : (
              <>
                <Circle cx={cx + r * 0.08} cy={cy + r * 0.12} r={r * 1.04} fill="#9AA1AE" opacity={0.35} />
                <Circle cx={cx} cy={cy} r={r} fill="url(#dome)" stroke={isNext ? "#C2577A" : "#D7A3B6"} strokeWidth={isNext ? 3 : 1} />
                <Circle cx={cx - r * 0.35} cy={cy - r * 0.38} r={r * 0.2} fill="#FFFFFF" opacity={0.85} />
              </>
            )}
            {isNext && <Circle cx={cx} cy={cy} r={r * 1.32} fill="none" stroke="#C2577A" strokeWidth={1.5} strokeDasharray="3 3" />}
          </G>
        );
      })}
    </Svg>
  );
  if (!onPressPill) return svg;
  // Transparent tap targets over each pill (more reliable across platforms than SVG press handlers).
  return (
    <View style={{ width, height }}>
      {svg}
      {pills.map(({ i, cx, cy }) => (
        <Pressable key={i} onPress={() => onPressPill(i)} accessibilityRole="button" accessibilityLabel={t.pill({ n: i + 1 })}
          style={{ position: "absolute", left: cx - cell / 2, top: cy - cell / 2, width: cell, height: cell }} />
      ))}
    </View>
  );
});
