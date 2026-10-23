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

export type NotificationAction = "taken" | "seen";
export type ActionTitles = { taken: string; done: string; seen: string };

/**
 * The notification buttons (categories in the worker's messages): "Taken" on the owner's pill reminder (category "reminder"),
 * "Done" on a patch / ring / injection reminder (category "action", same "taken" action) and "Mark as seen" on the
 * followers' "pill taken" notice (category "seen").
 */
export async function registerActions(titles: ActionTitles) {
  await Promise.all([
    Notifications.setNotificationCategoryAsync("reminder", [{ identifier: "taken", buttonTitle: titles.taken, options: { opensAppToForeground: true } }]),
    Notifications.setNotificationCategoryAsync("action", [{ identifier: "taken", buttonTitle: titles.done, options: { opensAppToForeground: true } }]),
    Notifications.setNotificationCategoryAsync("seen", [{ identifier: "seen", buttonTitle: titles.seen, options: { opensAppToForeground: true } }]),
  ]);
}

/** Calls `cb(action, pid, day)` when a notification button was pressed, including when it launched the app. */
export function onNotificationAction(cb: (action: NotificationAction, pid: string, day: string) => void) {
  const handle = (response: Notifications.NotificationResponse | null) => {
    if (!response) return;
    const action = response.actionIdentifier;
    if (action !== "taken" && action !== "seen") return;
    Notifications.clearLastNotificationResponse(); // don't re-apply it on the next launch
    Notifications.dismissNotificationAsync(response.notification.request.identifier);
    const { pid, day } = response.notification.request.content.data as { pid: string; day: string };
    cb(action, pid, day);
  };
  handle(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
