import { Component, type ReactNode } from "react";
import { Platform, Text, View } from "react-native";
import { strings } from "./i18n";
import { C, F, R } from "./theme";
import { Button } from "./ui";

/**
 * Without this, any error while rendering unmounts the whole app and leaves an empty page.
 * Shows the message instead, with a button to reload (web) or try again (native).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) { return { error }; }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const t = strings();
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: C.bg }}>
        <Text style={{ ...F.extrabold, fontSize: 24, color: C.text }}>{t.errorTitle}</Text>
        <Text style={{ ...F.medium, fontSize: 14, color: C.textSoft, marginTop: 8, lineHeight: 20 }} selectable>{error.message}</Text>
        <Button title={t.tryAgain} onPress={() => (Platform.OS === "web" ? window.location.reload() : this.setState({ error: null }))}
          style={{ marginTop: 20, borderRadius: R.md }} />
      </View>
    );
  }
}
