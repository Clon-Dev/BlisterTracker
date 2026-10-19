// Native (Android) push via expo-notifications. getDevicePushTokenAsync returns the
// raw FCM registration token, which the worker sends to with the FCM HTTP v1 API.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";

export type PushStatus = "granted" | "default" | "denied" | "unsupported" | "needs-install";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function pushStatus(): Promise<PushStatus> {
  if (Platform.OS !== "android") return "unsupported";
  const { status } = await Notifications.getPermissionsAsync();
  return status === "granted" ? "granted" : status === "denied" ? "denied" : "default";
}

/** Call only when pushStatus() is "granted" or "default". Asks for permission if needed and returns the FCM token, or null. */
export async function enablePush(): Promise<string | null> {
  await Notifications.setNotificationChannelAsync("default", {
    name: "Pill reminders", importance: Notifications.AndroidImportance.HIGH,
  });
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return String(token.data);
}
