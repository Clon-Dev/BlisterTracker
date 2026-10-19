import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import messaging from "@react-native-firebase/messaging";

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false }) });

export async function setupPush(registerToken: (token: string) => Promise<unknown>) {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Pill reminders", importance: Notifications.AndroidImportance.HIGH });
  }
  await messaging().registerDeviceForRemoteMessages();
  const permission = await messaging().requestPermission();
  if (permission === messaging.AuthorizationStatus.DENIED) return;
  await registerToken(await messaging().getToken());
}

export function listenForPush() {
  return messaging().onMessage(async (message) => {
    await Notifications.scheduleNotificationAsync({ content: {
      title: message.notification?.title ?? "Pill reminder",
      body: message.notification?.body ?? "You have a new pill update.",
    }, trigger: null });
  });
}
