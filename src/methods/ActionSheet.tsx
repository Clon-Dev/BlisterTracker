// Recording a patch / ring / injection action: just now, or on an earlier day and time; changing or undoing it.
import { useState } from "react";
import { Text, View } from "react-native";
import { Check, Clock3, History, Undo2 } from "lucide-react-native";
import { actionOn, addDays, diffDays, doneAt, methodOf, type Plan } from "../../shared/schedule";
import { DatePicker } from "../DatePicker";
import { formatDay, useI18n } from "../i18n";
import { openSheet, SheetIcon } from "../sheets";
import { defaultEarlier, EarlierPicker, nowIn } from "../TakenTime";
import { C } from "../theme";
import { Badge, Button, ChipGroup, s } from "../ui";
import { actionKey, doneLine } from "./status";

export type ActionChoice = { day: string; time: string } | { undo: true };

/** Sheet for the action scheduled on `scheduled`. Resolves with the choice, or undefined when dismissed. */
export function openActionSheet(plan: Plan, scheduled: string) {
  return openSheet<ActionChoice>((done) => <ActionSheet plan={plan} scheduled={scheduled} done={done} />);
}

function ActionSheet({ plan, scheduled, done }: { plan: Plan; scheduled: string; done: (c?: ActionChoice) => void }) {
  const { t, lang } = useI18n();
  const now = nowIn(plan.tz);
  const key = actionKey(plan, actionOn(plan, scheduled)!);
  const recorded = doneAt(plan, scheduled);
  const injection = methodOf(plan) === "injection";
  const [mode, setMode] = useState<"status" | "pick">("status");
  // Patch / ring: from the scheduled day (or today's, if it lies ahead) up to today; an injection on any past date.
  const firstDay = scheduled < now.day ? scheduled : now.day;
  const dayOptions = Array.from({ length: diffDays(firstDay, now.day) + 1 }, (_, i) => addDays(firstDay, i)).reverse();
  const [day, setDay] = useState(recorded?.day ?? now.day);
  const [time, setTime] = useState(recorded?.time || defaultEarlier(plan, now.day));
  const future = day > now.day;
  const pickedTime = day === now.day && time > now.time ? now.time : time;

  return (
    <View>
      <SheetIcon icon={recorded ? Check : Clock3} tone={recorded ? "success" : "primary"} />
      <Text style={s.h1}>{scheduled === now.day ? t.actionTodo[key] : t.actionName[key]}</Text>
      <Text style={[s.muted, { marginTop: 4 }]}>{formatDay(scheduled, lang)}</Text>
      {recorded && mode === "status" && <>
        <View style={{ marginTop: 12 }}><Badge tone="success" icon={Check} label={doneLine(plan, scheduled, t) ?? ""} /></View>
        <Button title={t.changeTime} kind="secondary" icon={Clock3} onPress={() => setMode("pick")} style={{ marginTop: 22 }} />
        <Button title={t.markNotDone} kind="ghost" icon={Undo2} onPress={() => done({ undo: true })} style={{ marginTop: 4 }} />
      </>}
      {!recorded && mode === "status" && <>
        <Text style={[s.muted, { marginTop: 10 }]}>{t.actionWhenTitle}</Text>
        <Button title={t.takenNow({ time: now.time })} icon={Check} onPress={() => done({ day: now.day, time: now.time })} style={{ marginTop: 18 }} />
        <Button title={t.takenEarlier} kind="secondary" icon={History} onPress={() => setMode("pick")} style={{ marginTop: 10 }} />
      </>}
      {mode === "pick" && <>
        <Text style={[s.label, { marginTop: 16 }]}>{t.actionEarlierDay}</Text>
        {injection
          ? <DatePicker value={day} min={addDays(now.day, -200)} onChange={setDay} />
          : <ChipGroup options={dayOptions.map((d) => ({ label: d === now.day ? t.today : formatDay(d, lang), value: d }))} value={day} onChange={setDay} />}
        <EarlierPicker plan={plan} day={day} value={pickedTime} onChange={setTime} />
        {future && <Text style={[s.small, { color: C.danger, textAlign: "center", marginTop: 10 }]}>{t.futureNotAllowed}</Text>}
        <Button title={pickedTime ? t.saveTime({ time: pickedTime }) : t.saveTimeUnknown} icon={Check} disabled={future}
          onPress={() => done({ day, time: pickedTime })} style={{ marginTop: 18 }} />
      </>}
    </View>
  );
}
