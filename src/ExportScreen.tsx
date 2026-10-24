// Export screen: period, columns, then a PDF (table with title) or CSV of the own daily data.
import { useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CalendarRange, Columns3, FileSpreadsheet, FileText } from "lucide-react-native";
import { addDays, dayKey, methodOf } from "../shared/schedule";
import { appointmentNoteOf, deviceTz, type Note, type Schedule } from "./data";
import { DatePicker } from "./DatePicker";
import { errorText } from "./errors";
import { buildRows, COLUMNS, dmy, exportFileName, landscape, PLAN_COLUMNS, toCsv, toHtml, type ColumnKey } from "./export";
import { saveCsv, savePdf } from "./exportFile";
import { useI18n } from "./i18n";
import { alert } from "./sheets";
import { C, F } from "./theme";
import { Button, Card, ChipGroup, Header, s, Toggle } from "./ui";

const PRESETS = [7, 30, 90, 365] as const;
const STORE_KEY = "exportColumns";

export function ExportScreen({ schedule, notes, name, onBack }: {
  schedule: Schedule | null; notes: Record<string, Note>; /** Username, shown under the PDF title. */ name: string; onBack: () => void;
}) {
  const { t, lang } = useI18n();
  const today = dayKey(Date.now(), schedule?.tz ?? deviceTz());
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | "custom">(30);
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const available = COLUMNS.filter((c) => c !== "date" && (schedule || !PLAN_COLUMNS.includes(c)));
  const [chosen, setChosen] = useState<ColumnKey[]>(available);
  const [busy, setBusy] = useState<"pdf" | "csv" | null>(null);

  // The column choice is remembered on this device.
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then((v) => {
      const saved = v ? (JSON.parse(v) as ColumnKey[]) : null;
      if (saved) setChosen(available.filter((c) => saved.includes(c)));
    }).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (c: ColumnKey, on: boolean) => {
    const next = available.filter((x) => (x === c ? on : chosen.includes(x)));
    setChosen(next);
    AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => undefined);
  };
  const pickPreset = (p: typeof preset) => {
    setPreset(p);
    if (p !== "custom") { setFrom(addDays(today, -(p - 1))); setTo(today); }
  };

  const start = from <= to ? from : to;
  const end = from <= to ? to : from;
  const columns: ColumnKey[] = ["date", ...chosen];
  const rows = useMemo(() => buildRows({
    from: start, to: end, today, t, lang, notes, plan: schedule, appointmentNote: schedule ? appointmentNoteOf(schedule) ?? "" : "",
  }), [start, end, today, t, lang, notes, schedule]);

  const subtitle = [
    name,
    schedule && `${t.methods[methodOf(schedule)].name}${schedule.name ? ` (${schedule.name})` : ""} · ${t.exportReminder({ time: schedule.time })}`,
  ].filter(Boolean).join(" · ");

  const run = async (kind: "pdf" | "csv") => {
    if (busy) return;
    setBusy(kind);
    try {
      if (kind === "csv") await saveCsv(toCsv(rows, columns, t, lang), exportFileName(start, end, "csv"), t.exportTitle);
      else await savePdf(toHtml(rows, columns, { from: start, to: end, today, subtitle }, t, lang), exportFileName(start, end, "pdf"), t.exportTitle, landscape(columns));
    } catch (e) {
      alert(t.errorTitle, errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View>
      <Header title={t.exportTitle} subtitle={t.exportHint} onBack={onBack} />
      <Card>
        <Title icon={CalendarRange} text={t.exportPeriod} />
        <ChipGroup options={[...PRESETS.map((n) => ({ label: t.exportLastDays({ n }), value: n as typeof preset })), { label: t.exportCustom, value: "custom" as const }]}
          value={preset} onChange={pickPreset} />
        {preset === "custom" && <>
          <Text style={[s.label, { marginTop: 16, marginBottom: 0 }]}>{t.exportFrom} · {dmy(from)}</Text>
          <DatePicker value={from} min="2020-01-01" onChange={(d) => setFrom(d > today ? today : d)} />
          <Text style={[s.label, { marginTop: 16, marginBottom: 0 }]}>{t.exportTo} · {dmy(to)}</Text>
          <DatePicker value={to} min={from} onChange={(d) => setTo(d > today ? today : d)} />
        </>}
        <Text style={[s.small, F.semibold, { marginTop: 14, color: C.primaryDeep }]}>
          {dmy(start)} – {dmy(end < today ? end : today)} · {t.exportRowCount({ n: rows.length })}
        </Text>
      </Card>
      <Card>
        <Title icon={Columns3} text={t.exportColumnsTitle} />
        <Text style={[s.small, { marginTop: 6 }]}>{t.exportColumnsHint}</Text>
        {available.map((c) => <Toggle key={c} label={t.exportColumns[c]} value={chosen.includes(c)} onChange={(on) => toggle(c, on)} />)}
      </Card>
      <Button title={t.exportPdf} icon={FileText} onPress={() => run("pdf")} busy={busy === "pdf"} disabled={!!busy} style={{ marginTop: 22 }} />
      <Button title={t.exportCsv} icon={FileSpreadsheet} kind="secondary" onPress={() => run("csv")} busy={busy === "csv"} disabled={!!busy} style={{ marginTop: 10 }} />
      <Text style={[s.small, { textAlign: "center", marginTop: 14 }]}>{t.exportPrivacy}</Text>
    </View>
  );
}

function Title({ icon: Icon, text }: { icon: typeof CalendarRange; text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <Icon size={19} color={C.primaryDeep} strokeWidth={2.3} />
      <Text style={[s.body, F.bold]}>{text}</Text>
    </View>
  );
}
