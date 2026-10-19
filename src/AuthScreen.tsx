import { useState } from "react";
import { Text, View } from "react-native";
import { authErrorText, login, register, resetPassword } from "./auth";
import { notify } from "./dialog";
import { useI18n } from "./i18n";
import { Button, Card, Field, Header, LanguageSwitch, LinkButton, s } from "./ui";

type Mode = "login" | "register" | "reset";

/** First screen when not logged in. */
export function AuthScreen() {
  const { t } = useI18n();
  const [mode, setMode] = useState<Mode>("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);

  const validEmail = /^\S+@\S+\.\S+$/.test(email.trim());
  const valid = mode === "reset" ? validEmail
    : mode === "login" ? validEmail && password.length > 0
    : validEmail && password.length >= 6 && password === repeat;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else if (mode === "register") await register(email, password);
      else {
        await resetPassword(email);
        notify(t.resetSent, t.resetSentBody({ email: email.trim() }));
        setMode("login");
      }
      // On success the auth listener in App switches to the main screen.
    } catch (e) {
      notify(t.errorTitle, authErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (mode === "reset") return (
    <View>
      <Header title={t.resetTitle} onBack={() => setMode("login")} />
      <Text style={s.muted}>{t.resetIntro}</Text>
      <Card>
        <Field label={t.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" onSubmitEditing={submit} />
        <Button title={t.resetSend} onPress={submit} disabled={!valid} busy={busy} style={{ marginTop: 18 }} />
      </Card>
    </View>
  );

  const isLogin = mode === "login";
  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
        <Text style={s.title}>Blister Buddy</Text>
        <LanguageSwitch />
      </View>
      <Text style={[s.muted, { marginTop: 8 }]}>{isLogin ? t.authLoginIntro : t.authRegisterIntro}</Text>
      <Card>
        <Field label={t.email} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" />
        <Field label={isLogin ? t.accountPassword : t.passwordLabel} value={password} onChangeText={setPassword} secureTextEntry
          autoCapitalize="none" autoComplete={isLogin ? "current-password" : "new-password"} onSubmitEditing={isLogin ? submit : undefined} />
        {!isLogin && <Field label={t.passwordRepeat} value={repeat} onChangeText={setRepeat} secureTextEntry autoCapitalize="none" autoComplete="new-password" onSubmitEditing={submit} />}
        {!isLogin && repeat.length > 0 && password !== repeat && <Text style={[s.muted, { marginTop: 8 }]}>{t.passwordMismatch}</Text>}
        <Button title={isLogin ? t.login : t.register} onPress={submit} disabled={!valid} busy={busy} style={{ marginTop: 18 }} />
        {isLogin && <LinkButton title={t.forgotPassword} onPress={() => setMode("reset")} />}
      </Card>
      <LinkButton title={isLogin ? t.toRegister : t.toLogin} onPress={() => setMode(isLogin ? "register" : "login")} />
    </View>
  );
}
