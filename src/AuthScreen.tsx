import { useState } from "react";
import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { AlertCircle, ArrowRight, Lock, Mail, Pill, Send } from "lucide-react-native";
import { authErrorText, login, register, resetPassword } from "./auth";
import { useI18n } from "./i18n";
import { alert } from "./sheets";
import { C, F, G, R, shadow, themedStyles } from "./theme";
import { Button, Card, ChipGroup, Field, Header, LanguageSwitch, LinkButton, s } from "./ui";

type Mode = "login" | "register" | "reset";

/** First screen when not logged in. */
export function AuthScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = mode === "reset" ? validEmail
    : mode === "login" ? validEmail && password.length > 0
    : validEmail && password.length >= 6 && password === repeat;

  const switchTo = (m: Mode) => { setMode(m); setError(null); };
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") await login(email, password);
      else if (mode === "register") await register(email, password);
      else {
        await resetPassword(email);
        alert(t.resetSent, t.resetSentBody({ email: email.trim() }));
        switchTo("login");
      }
      // On success the auth listener in App switches to the main screen.
    } catch (e) {
      setError(authErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error && (
    <View style={st.error}>
      <AlertCircle size={18} color={C.danger} strokeWidth={2.4} />
      <Text style={[s.small, F.semibold, { color: C.danger, flex: 1 }]}>{error}</Text>
    </View>
  );

  if (mode === "reset") return (
    <View>
      <Header title={t.resetTitle} subtitle={t.resetIntro} onBack={() => switchTo("login")} />
      <Card>
        <Field label={t.email} icon={Mail} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" onSubmitEditing={submit} />
        {errorBox}
        <Button title={t.resetSend} icon={Send} onPress={submit} disabled={!valid} busy={busy} style={{ marginTop: 22 }} />
      </Card>
    </View>
  );

  const isLogin = mode === "login";
  return (
    <View>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 4 }}><LanguageSwitch /></View>
      <LinearGradient colors={G.hero} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[st.hero, shadow(3)]}>
        <View style={st.bubble} />
        <View style={st.logo}><Pill size={30} color={C.white} strokeWidth={2.2} /></View>
        <Text style={[s.title, { color: C.white, marginTop: 16 }]}>Blister Buddy</Text>
        <Text style={[s.body, { color: "rgba(255,255,255,0.9)", marginTop: 6 }]}>{isLogin ? t.authLoginIntro : t.authRegisterIntro}</Text>
      </LinearGradient>

      <Card style={{ marginTop: -26, marginHorizontal: 8 }}>
        <ChipGroup options={[{ label: t.register, value: "register" as Mode }, { label: t.login, value: "login" as Mode }]} value={mode} onChange={switchTo} />
        <Field label={t.email} icon={Mail} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label={isLogin ? t.accountPassword : t.passwordLabel} icon={Lock} value={password} onChangeText={setPassword} secureTextEntry
          autoCapitalize="none" autoComplete={isLogin ? "current-password" : "new-password"} onSubmitEditing={isLogin ? submit : undefined} />
        {!isLogin && (
          <Field label={t.passwordRepeat} icon={Lock} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password"
            onSubmitEditing={submit} error={repeat.length > 0 && password !== repeat ? t.passwordMismatch : null} />
        )}
        {errorBox}
        <Button title={isLogin ? t.login : t.register} icon={ArrowRight} onPress={submit} disabled={!valid} busy={busy} style={{ marginTop: 22 }} />
        {isLogin && <LinkButton title={t.forgotPassword} onPress={() => switchTo("reset")} />}
      </Card>
    </View>
  );
}

const st = themedStyles(() => ({
  hero: { borderRadius: R.xl, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 52, marginTop: 14, overflow: "hidden" },
  bubble: { position: "absolute", width: 220, height: 220, borderRadius: 110, backgroundColor: C.white, opacity: 0.1, right: -70, top: -80 },
  logo: { width: 62, height: 62, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  error: { flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: C.dangerSoft, borderRadius: R.md, padding: 12, marginTop: 16 },
}));
