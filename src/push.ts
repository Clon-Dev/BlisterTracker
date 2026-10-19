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

/** The "Taken" button on the owner's reminder (category "reminder" in the worker's messages). */
export async function registerTakenAction(buttonTitle: string) {
  await Notifications.setNotificationCategoryAsync("reminder", [
    { identifier: "taken", buttonTitle, options: { opensAppToForeground: true } },
  ]);
}

/** Calls `cb(pid, day)` when the "Taken" button was pressed, including when it launched the app. */
export function onTakenAction(cb: (pid: string, day: string) => void) {
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (response?.actionIdentifier !== "taken") return;
    Notifications.clearLastNotificationResponse(); // don't re-apply it on the next launch
    Notifications.dismissNotificationAsync(response.notification.request.identifier);
    const { pid, day } = response.notification.request.content.data as { pid: string; day: string };
    cb(pid, day);
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
