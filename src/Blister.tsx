import { memo, useMemo } from "react";
import { Pressable, View } from "react-native";
import { useI18n } from "./i18n";
import type { Cell } from "./pack";
import { C, F } from "./theme";
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from "react-native-svg";

type Props = {
  cells: Cell[];
  width: number;
  /** Weekday (0 = Monday) of the first cell; shows day labels above the columns. */
  startWeekday?: number;
  /** Tap on cell i (0-based). */
  onPressCell?: (index: number) => void;
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


export const Blister = memo(function Blister({ cells, width, startWeekday, onPressCell }: Props) {
  const { t } = useI18n();
  const count = cells.length;
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
          <Stop offset="0" stopColor={C.foil[0]} />
          <Stop offset="0.45" stopColor={C.foil[1]} />
          <Stop offset="0.55" stopColor={C.foil[2]} />
          <Stop offset="1" stopColor={C.foil[3]} />
        </LinearGradient>
        <RadialGradient id="dome" cx="0.38" cy="0.32" r="0.75">
          <Stop offset="0" stopColor={C.dome[0]} />
          <Stop offset="0.55" stopColor={C.dome[1]} />
          <Stop offset="1" stopColor={C.dome[2]} />
        </RadialGradient>
        <RadialGradient id="placebo" cx="0.38" cy="0.32" r="0.75">
          <Stop offset="0" stopColor={C.placebo[0]} />
          <Stop offset="0.6" stopColor={C.placebo[1]} />
          <Stop offset="1" stopColor={C.placebo[2]} />
        </RadialGradient>
        <RadialGradient id="hole" cx="0.5" cy="0.5" r="0.6">
          <Stop offset="0" stopColor={C.hole[0]} />
          <Stop offset="1" stopColor={C.hole[1]} />
        </RadialGradient>
      </Defs>

      <Rect x={1} y={1} width={width - 2} height={height - 2} rx={width * 0.05} fill="url(#foil)" stroke={C.foilStroke} strokeWidth={1.5} />
      {/* Perforation lines between rows. */}
      {Array.from({ length: rows - 1 }, (_, row) => (
        <Path key={`perf${row}`} d={`M${pad} ${pad + labelBand + (row + 1) * cell}H${width - pad}`}
          stroke={C.perforation} strokeWidth={1} strokeDasharray="3 4" />
      ))}
      {labelBand > 0 && t.weekdays.map((_, c) => (
        <SvgText key={c} x={pad + c * cell + cell / 2} y={pad + labelBand * 0.7} fontSize={cell * 0.24}
          fill={C.blisterLabel} fontFamily={F.bold.fontFamily} textAnchor="middle">{t.weekdays[(startWeekday! + c) % 7]}</SvgText>
      ))}

      {pills.map(({ i, cx, cy }) => {
        const { kind, state } = cells[i];
        const isToday = state === "today";
        return (
          <G key={i}>
            {kind === "break" ? (
              <Circle cx={cx} cy={cy} r={r * 0.8} fill="none" stroke={C.breakStroke} strokeWidth={1.2} strokeDasharray="2 3" />
            ) : state === "taken" ? (
              <>
                <Path d={tornPath(cx, cy, r * 1.08, i + 1)} fill={C.torn} stroke={C.tornStroke} strokeWidth={1} />
                <Circle cx={cx} cy={cy} r={r * 0.78} fill="url(#hole)" />
                <Path d={tornPath(cx, cy, r * 0.8, i + 99)} fill="none" stroke={C.tornInner} strokeWidth={1.2} />
              </>
            ) : (
              <>
                <Circle cx={cx + r * 0.08} cy={cy + r * 0.12} r={r * 1.04} fill={C.pillShadow} opacity={0.35} />
                <Circle cx={cx} cy={cy} r={r} fill={kind === "placebo" ? "url(#placebo)" : "url(#dome)"}
                  stroke={state === "missed" ? C.danger : isToday ? C.primary : kind === "placebo" ? C.placeboStroke : C.domeStroke}
                  strokeWidth={state === "missed" || isToday ? 3 : 1} />
                <Circle cx={cx - r * 0.35} cy={cy - r * 0.38} r={r * 0.2} fill={C.white} opacity={0.85} />
              </>
            )}
            {isToday && <Circle cx={cx} cy={cy} r={r * 1.32} fill="none" stroke={C.primary} strokeWidth={1.5} strokeDasharray="3 3" />}
          </G>
        );
      })}
    </Svg>
  );
  if (!onPressCell) return svg;
  // Transparent tap targets over each pill (more reliable across platforms than SVG press handlers).
  return (
    <View style={{ width, height }}>
      {svg}
      {pills.map(({ i, cx, cy }) => (
        <Pressable key={i} onPress={() => onPressCell(i)} accessibilityRole="button" accessibilityLabel={t.pill({ n: i + 1 })}
          style={{ position: "absolute", left: cx - cell / 2, top: cy - cell / 2, width: cell, height: cell }} />
      ))}
    </View>
  );
});
