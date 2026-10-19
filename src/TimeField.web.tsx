import React from "react";
import { useI18n } from "./i18n";

export function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return React.createElement("input", {
    type: "time",
    value,
    "aria-label": t.reminderTime,
    onChange: (e: { target: { value: string } }) => e.target.value && onChange(e.target.value.slice(0, 5)),
    style: {
      alignSelf: "center", fontSize: 40, fontWeight: 700, color: "#3B2A33", padding: "8px 20px",
      borderRadius: 16, border: "1px solid #EAD9E1", background: "#FFFFFF", fontFamily: "inherit",
    },
  });
}
