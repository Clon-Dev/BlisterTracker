// The owner's home view for patch, ring and injection: hero with the next action, late rules, and the cycle view.
import { Linking, Pressable, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AlertTriangle, CalendarDays, Check, Clock3, ExternalLink, Pencil, SlidersHorizontal, Syringe } from "lucide-react-native";
import { anchors, diffDays, methodOf, type Method, type Plan } from "../../shared/schedule";
import type { Schedule } from "../data";
import type { Lang, Strings } from "../i18n";
import { MascotSpot } from "../mascot/world";
import { C, F, G, R, shadow, themedStyles } from "../theme";
import { Button, Card, IconButton, ProgressRing, s } from "../ui";
import { InjectionWindow, PatchStrip, RingDial } from "./MethodViews";
import { methodStatus } from "./status";

/** Where the rules for each method come from (familienplanung.de, the German federal family-planning portal). */
export const METHOD_SOURCE: Record<Exclude<Method, "pill">, string> = {
  patch: "https://www.familienplanung.de/verhuetung/verhuetungsmethoden/verhuetungspflaster/",
  ring: "https://www.familienplanung.de/verhuetung/verhuetungsmethoden/der-verhuetungsring/",
  injection: "https://www.familienplanung.de/verhuetung/verhuetungsmethoden/die-verhuetungsspritze/",
};

export function MethodSchedule({ schedule, today, width, t, lang, onAction, onHistory, onEdit, onRename, heroFooter, extra, after }: {
  schedule: Schedule; today: string; width: number; t: Strings; lang: Lang;
  /** Opens the action sheet for the action scheduled on that day (open, done, or an early injection). */
  onAction: (scheduledDay: string) => void;
  onHistory: () => void; onEdit: () => void; onRename: () => void;
  /** Under the headline (the followers' "seen" line). */
  heroFooter?: React.ReactNode;
  extra: React.ReactNode; after: React.ReactNode;
}) {
  const method = methodOf(schedule) as Exclude<Method, "pill">;
  const status = methodStatus(schedule, today, Date.now(), t, lang);
  // The injection may be given from two weeks before it's due (familienplanung.de: after 10 weeks at the earliest).
  const early = !status.open && status.next?.key === "inject" && diffDays(today, status.next.day) <= 14 ? status.next : null;
  const longUse = method === "injection" && diffDays(firstDay(schedule), today) >= 700;

  return (
    <>
      <MascotSpot id="hero">
        <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, shadow(3)]}>
          <View style={st.heroBubble} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 18 }}>
            <ProgressRing progress={status.progress} size={92} stroke={8} light>
              <Text style={[F.extrabold, { fontSize: 28, color: C.white, letterSpacing: -1 }]}>{status.center}</Text>
              <Text style={[s.small, F.bold, { color: "rgba(255,255,255,0.8)", marginTop: -2 }]}>{status.centerSub}</Text>
            </ProgressRing>
            <View style={{ flex: 1 }}>
              <Text style={[s.eyebrow, { color: "rgba(255,255,255,0.75)" }]}>{t.methods[method].name}</Text>
              <Text style={[s.h1, { color: C.white, marginTop: 4 }]}>{status.headline}</Text>
              {!!status.sub && <Text style={[s.small, { color: "rgba(255,255,255,0.85)", marginTop: 4 }]}>{status.sub}</Text>}
              {heroFooter}
            </View>
          </View>
          {status.open
            ? <Button title={t.actionCta[status.open.key]} kind="light" icon={Check} onPress={() => onAction(status.open!.day)} style={{ marginTop: 18 }} />
            : early
              ? <Button title={t.actionCta.inject} kind="light" icon={Syringe} compact onPress={() => onAction(early.day)} style={{ marginTop: 18 }} />
              : status.doneToday
                ? <Button title={t.changeTime} kind="light" icon={Clock3} compact onPress={() => onAction(status.doneToday!.day)} style={{ marginTop: 18 }} />
                : null}
        </LinearGradient>
      </MascotSpot>

      {status.open?.rule && <RuleCard text={t.lateRules[status.open.rule]} url={METHOD_SOURCE[method]} t={t} danger={/over|start-late/.test(status.open.rule)} />}
      {longUse && <RuleCard text={t.injectionLong} url={METHOD_SOURCE.injection} t={t} />}

      {extra}

      <MascotSpot id="pack">
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable style={{ flex: 1 }} onPress={onRename} accessibilityRole="button" accessibilityLabel={t.renameTitle}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={[s.h2, { flexShrink: 1 }]} numberOfLines={1}>{schedule.name || t.methods[method].name}</Text>
                <Pencil size={14} color={C.muted} strokeWidth={2.4} />
              </View>
              <Text style={[s.small, { marginTop: 2 }]}>{status.position}</Text>
            </Pressable>
            <IconButton icon={CalendarDays} label={t.history} onPress={onHistory} />
            <IconButton icon={SlidersHorizontal} label={t.editSchedule} onPress={onEdit} />
          </View>
          <MethodVisual plan={schedule} today={today} width={width} onPressDay={onAction} t={t} lang={lang} />
        </Card>
      </MascotSpot>
      {after}
    </>
  );
}

/** The cycle view of a method (also shown, read-only, on a followed schedule). */
export function MethodVisual({ plan, today, width, onPressDay, t, lang }: {
  plan: Plan; today: string; width: number; onPressDay?: (day: string) => void; t: Strings; lang: Lang;
}) {
  const method = methodOf(plan);
  if (method === "patch") return <PatchStrip plan={plan} today={today} onPressDay={onPressDay} />;
  if (method === "injection") return <InjectionWindow plan={plan} today={today} />;
  const status = methodStatus(plan, today, Date.now(), t, lang);
  return (
    <RingDial plan={plan} today={today} size={Math.min(width - 90, 240)}>
      <Text style={[F.extrabold, { fontSize: 40, color: C.text, letterSpacing: -1 }]}>{status.center}</Text>
      <Text style={[s.small, F.bold]}>{status.centerSub}</Text>
      <Text style={[s.small, { marginTop: 6, textAlign: "center", maxWidth: 140 }]} numberOfLines={2}>{status.next ? t.actionNext[status.next.key] : ""}</Text>
    </RingDial>
  );
}

function RuleCard({ text, url, t, danger }: { text: string; url: string; t: Strings; danger?: boolean }) {
  const [bg, fg] = danger ? [C.dangerSoft, C.danger] : [C.warningSoft, C.warning];
  return (
    <View style={[st.rule, { backgroundColor: bg }]}>
      <AlertTriangle size={18} color={fg} strokeWidth={2.4} />
      <View style={{ flex: 1 }}>
        <Text style={[s.small, F.semibold, { color: C.text, lineHeight: 19 }]}>{text}</Text>
        <Pressable onPress={() => Linking.openURL(url)} accessibilityRole="link" hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 }}>
          <Text style={[s.small, F.extrabold, { color: fg }]}>{t.mascotSource}: {t.methodSourceName}</Text>
          <ExternalLink size={13} color={fg} strokeWidth={2.4} />
        </Pressable>
        <Text style={[s.small, { fontSize: 11, marginTop: 4 }]}>{t.ruleDisclaimer}</Text>
      </View>
    </View>
  );
}

/** Earliest known day of the method: the first cycle start or the start of tracking. */
const firstDay = (p: Plan) => [...anchors(p), p.trackingSince].sort()[0];

const st = themedStyles(() => ({
  hero: { borderRadius: R.xl, padding: 22, marginTop: 16, overflow: "hidden" as const },
  heroBubble: { position: "absolute" as const, width: 180, height: 180, borderRadius: 90, backgroundColor: C.white, opacity: 0.1, right: -50, top: -70 },
  rule: { flexDirection: "row" as const, gap: 12, alignItems: "flex-start" as const, borderRadius: R.lg, padding: 14, marginTop: 14 },
}));
