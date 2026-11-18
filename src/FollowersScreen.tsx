// The owner's followers: remove someone (they can follow again with the username and sharing password) or block them
// (the security rules reject their follow attempts until they're unblocked), and the list of blocked accounts.
import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ban, ShieldCheck, UserMinus } from "lucide-react-native";
import { blockFollower, removeFollower, unblockFollower, type Follower } from "./data";
import { queued } from "./errors";
import { useI18n, type Lang, type Strings } from "./i18n";
import { confirm, toast } from "./sheets";
import { C, F, G, themedStyles } from "./theme";
import { Card, Header, LinkButton, s, SectionTitle } from "./ui";

const longDate = (ms: number, lang: Lang) =>
  new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(ms));

export function FollowersScreen({ pid, followers, blocked, onBack }: { pid: string; followers: Follower[]; blocked: Follower[]; onBack: () => void }) {
  const { t, lang } = useI18n();
  const nameOf = (f: Follower) => f.name ?? t.thisFollower;

  const remove = async (f: Follower) => {
    if (!(await confirm({ title: t.removeFollowerTitle({ name: nameOf(f) }), message: t.removeFollowerBody, confirmLabel: t.removeFollower, destructive: true, icon: UserMinus }))) return;
    queued(removeFollower(pid, f.uid));
    toast(t.followerRemoved({ name: f.name ?? t.followerUnnamed }));
  };
  const block = async (f: Follower) => {
    if (!(await confirm({ title: t.blockFollowerTitle({ name: nameOf(f) }), message: t.blockFollowerBody, confirmLabel: t.blockFollower, destructive: true, icon: Ban }))) return;
    queued(blockFollower(pid, f));
    toast(t.followerBlockedToast({ name: f.name ?? t.followerUnnamed }));
  };
  const unblock = async (f: Follower) => {
    if (!(await confirm({ title: t.unblockTitle({ name: nameOf(f) }), message: t.unblockBody, confirmLabel: t.unblock, icon: ShieldCheck }))) return;
    queued(unblockFollower(pid, f.uid));
    toast(t.unblocked({ name: f.name ?? t.followerUnnamed }));
  };

  return (
    <View>
      <Header title={t.followersTitle} subtitle={t.followersCount({ n: followers.length })} onBack={onBack} />
      <Text style={[s.small, { marginTop: 4 }]}>{t.followersHint}</Text>

      {followers.map((f) => (
        <Card key={f.uid}>
          <Person f={f} t={t} sub={f.name ? (f.since ? t.followerSince({ date: longDate(f.since, lang) }) : null) : t.followerUnnamedHint} />
          <View style={st.divider} />
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <LinkButton title={t.removeFollower} icon={UserMinus} color={C.textSoft} onPress={() => remove(f)} />
            <LinkButton title={t.blockFollower} icon={Ban} color={C.danger} onPress={() => block(f)} />
          </View>
        </Card>
      ))}

      {blocked.length > 0 && <>
        <SectionTitle title={t.blockedTitle} />
        <Text style={[s.small, { marginBottom: 2 }]}>{t.blockedHint}</Text>
        {blocked.map((f) => (
          <Card key={f.uid}>
            <Person f={f} t={t} muted sub={f.since ? t.blockedSince({ date: longDate(f.since, lang) }) : null} />
            <View style={st.divider} />
            <LinkButton title={t.unblock} icon={ShieldCheck} onPress={() => unblock(f)} />
          </Card>
        ))}
      </>}
    </View>
  );
}

/** Avatar (first letter), name and a line below it. */
function Person({ f, t, sub, muted }: { f: Follower; t: Strings; sub: string | null; muted?: boolean }) {
  const name = f.name ?? t.followerUnnamed;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }} accessibilityLabel={sub ? `${name}, ${sub}` : name}>
      <LinearGradient colors={muted ? [C.border, C.muted] : G.avatar} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={st.avatar}>
        <Text style={[F.extrabold, { color: C.white, fontSize: 18 }]}>{f.name ? f.name.slice(0, 1).toUpperCase() : "?"}</Text>
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <Text style={[s.h2, muted && { color: C.textSoft }]} numberOfLines={1}>{name}</Text>
        {sub && <Text style={[s.small, { marginTop: 2 }]}>{sub}</Text>}
      </View>
    </View>
  );
}

const st = themedStyles(() => ({
  avatar: { width: 46, height: 46, borderRadius: 23, alignItems: "center" as const, justifyContent: "center" as const },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 14 },
}));
