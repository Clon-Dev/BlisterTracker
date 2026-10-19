import { Pressable, Text, StyleSheet } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { useI18n } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");

export function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const open = () => {
    const [h, m] = value.split(":").map(Number);
    const date = new Date();
    date.setHours(h, m, 0, 0);
    DateTimePickerAndroid.open({
      value: date, mode: "time", is24Hour: true,
      onChange: (event, picked) => {
        if (event.type === "set" && picked) onChange(`${pad(picked.getHours())}:${pad(picked.getMinutes())}`);
      },
    });
  };
  return (
    <Pressable onPress={open} style={styles.field} accessibilityRole="button" accessibilityLabel={`${t.reminderTime} ${value}`}>
      <Text style={styles.text}>{value}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { alignSelf: "center", paddingHorizontal: 28, paddingVertical: 12, borderRadius: 16, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#EAD9E1" },
  text: { fontSize: 44, fontWeight: "700", color: "#3B2A33", fontVariant: ["tabular-nums"] },
});
