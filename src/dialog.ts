import { Alert } from "react-native";
import { strings } from "./i18n";

export const notify = (title: string, message?: string) => Alert.alert(title, message);

export const confirm = (title: string, message: string, ok = "OK") => new Promise<boolean>((resolve) =>
  Alert.alert(title, message, [
    { text: strings().cancel, style: "cancel", onPress: () => resolve(false) },
    { text: ok, onPress: () => resolve(true) },
  ], { cancelable: true, onDismiss: () => resolve(false) }));
