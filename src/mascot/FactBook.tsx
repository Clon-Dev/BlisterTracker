// Nyxi's fact book: what Nyxi has told on this device (facts, "Myth or fact?", herstory), each with its source, and the
// wardrobe of outfits worn so far.
import { Linking, Pressable, Text, View } from "react-native";
import { ExternalLink } from "lucide-react-native";
import { useI18n, type Strings } from "../i18n";
import { C, F, R, themedStyles } from "../theme";
import { Badge, Card, Header, s } from "../ui";
import { OUTFITS } from "./art";
import { FACTS } from "./facts";
import { HERSTORY } from "./herstory";
import { Kitten } from "./Kitten";
import { MYTHS } from "./myths";
import { useMascotMemory } from "./store";

const OUTFIT_IDS = Object.keys(OUTFITS) as (keyof typeof OUTFITS)[];

export function FactBook({ onBack }: { onBack: () => void }) {
  const { t, lang } = useI18n();
  const m = useMascotMemory();
  const facts = (m.found ?? []).map((i) => FACTS[i]).filter(Boolean);
  const myths = MYTHS.filter((x) => m.mythsFound?.includes(x.tag));
  const milestones = HERSTORY.filter((x) => m.milestonesFound?.includes(x.tag));
  const worn = new Set(m.outfits ?? []);
  const factOf = (tag: string) => FACTS.find((f) => f.tag === tag)!;

  return (
    <View>
      <Header title={t.factBookTitle} subtitle={t.factBookHint} onBack={onBack} />

      <Card>
        <Text style={s.h2}>{t.factBookWardrobe({ n: OUTFIT_IDS.filter((id) => worn.has(id)).length, total: OUTFIT_IDS.length })}</Text>
        <View style={st.wardrobe}>
          {OUTFIT_IDS.map((id) => (
            <View key={id} style={[st.outfit, !worn.has(id) && { opacity: 0.35 }]} accessibilityLabel={`${t.outfitNames[id]}${worn.has(id) ? "" : ` – ${t.factBookLocked}`}`}>
              <Kitten size={52} mode="sit" facing={0} expression="normal" talking={false} hearts={0} active={false} reduceMotion label={t.outfitNames[id]} outfit={OUTFITS[id]} />
              <Text style={[s.small, { fontSize: 11, textAlign: "center", marginTop: 4 }]} numberOfLines={2}>{worn.has(id) ? t.outfitNames[id] : t.factBookLocked}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Section title={t.factBookMyths({ n: myths.length, total: MYTHS.length })} empty={!myths.length} t={t}>
        {(m.quizBest ?? 0) > 0 && <View style={{ marginTop: 8 }}><Badge tone="primary" label={t.factBookQuizBest({ n: m.quizBest ?? 0 })} /></View>}
        {myths.map((x) => {
          const fact = factOf(x.tag);
          return (
            <Entry key={x.tag} title={`${x.answer === "myth" ? t.mascotMyth : t.mascotFact}: ${x[lang]}`} text={fact[lang]} source={fact.source} url={fact.url} />
          );
        })}
      </Section>

      <Section title={t.factBookHerstory({ n: milestones.length, total: HERSTORY.length })} empty={!milestones.length} t={t}>
        {milestones.map((x) => (
          <Entry key={x.tag} title={String(x.year)} text={x[lang]} source={x.source} url={x.url} />
        ))}
      </Section>

      <Section title={t.factBookFacts({ n: facts.length, total: FACTS.length })} empty={!facts.length} t={t}>
        {facts.map((f) => <Entry key={f.tag + f.en.slice(0, 12)} text={f[lang]} source={f.source} url={f.url} />)}
      </Section>
    </View>
  );
}

function Section({ title, empty, t, children }: { title: string; empty: boolean; t: Strings; children: React.ReactNode }) {
  return (
    <Card>
      <Text style={s.h2}>{title}</Text>
      {empty ? <Text style={[s.muted, { marginTop: 6 }]}>{t.factBookEmpty}</Text> : children}
    </Card>
  );
}

function Entry({ title, text, source, url }: { title?: string; text: string; source: string; url: string }) {
  return (
    <View style={st.entry}>
      {title && <Text style={[s.small, F.bold, { color: C.primaryDeep }]}>{title}</Text>}
      <Text style={[s.body, { marginTop: title ? 2 : 0 }]}>{text}</Text>
      <Pressable onPress={() => Linking.openURL(url)} accessibilityRole="link" hitSlop={6} style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
        <Text style={[s.small, F.semibold]}>{source}</Text>
        <ExternalLink size={12} color={C.muted} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}

const st = themedStyles(() => ({
  wardrobe: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginTop: 12 },
  outfit: { width: "31%" as const, alignItems: "center" as const, paddingVertical: 8, paddingHorizontal: 4, borderRadius: R.md, backgroundColor: C.segment },
  entry: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, marginTop: 8 },
}));
