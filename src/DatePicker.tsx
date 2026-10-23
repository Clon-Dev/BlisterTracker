import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { addDays, weekday } from "../shared/schedule";
import { formatDay, formatMonth, useI18n } from "./i18n";
import { C, F, themedStyles } from "./theme";
import { IconButton, s } from "./ui";

/** Compact month calendar for picking a day; days before `min` are disabled. */
export function DatePicker({ value, onChange, min }: { value: string | null; onChange: (day: string) => void; min: string }) {
  const { t, lang } = useI18n();
  const start = value ?? min;
  const [month, setMonth] = useState({ year: +start.slice(0, 4), month: +start.slice(5, 7) - 1 });
  const first = `${month.year}-${String(month.month + 1).padStart(2, "0")}-01`;
  const days = Array.from({ length: 31 }, (_, i) => addDays(first, i)).filter((d) => d.slice(0, 7) === first.slice(0, 7));
  // Fixed weeks of 7 (wrapping 1/7-wide cells can round into 6 per row and shift the weekdays).
  const cells: (string | null)[] = [...Array(weekday(first)).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
  const shift = (n: number) => setMonth(({ year, month: m }) => {
    const d = new Date(Date.UTC(year, m + n, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
  });
  return (
    <View style={{ marginTop: 14 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <IconButton icon={ChevronLeft} label="‹" onPress={() => shift(-1)} size={36} />
        <Text style={[s.body, F.bold]}>{formatMonth(month.year, month.month, lang)}</Text>
        <IconButton icon={ChevronRight} label="›" onPress={() => shift(1)} size={36} />
      </View>
      <View style={{ flexDirection: "row", marginTop: 10 }}>
        {t.weekdays.map((w) => <Text key={w} style={[s.small, F.bold, st.col, { textAlign: "center", color: C.muted }]}>{w}</Text>)}
      </View>
      {weeks.map((week, w) => (
      <View key={w} style={{ flexDirection: "row" }}>
        {week.map((day, i) => {
          if (!day) return <View key={`pad${i}`} style={st.col} />;
          const disabled = day < min;
          const selected = day === value;
          return (
            <Pressable key={day} disabled={disabled} onPress={() => onChange(day)} accessibilityRole="button"
              accessibilityLabel={formatDay(day, lang)} accessibilityState={{ selected, disabled }} style={[st.col, { alignItems: "center", paddingVertical: 3 }]}>
              <View style={[st.day, selected && { backgroundColor: C.primary }]}>
                <Text style={[F.bold, { fontSize: 14, color: selected ? C.white : disabled ? C.placeholder : C.text }]}>{+day.slice(8)}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      ))}
    </View>
  );
}

const st = themedStyles(() => ({
  col: { flex: 1 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: "center" as const, justifyContent: "center" as const },
}));
