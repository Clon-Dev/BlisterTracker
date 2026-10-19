// Web / iOS home-screen push via FCM web push and our own service worker.
import { getMessaging, getToken, isSupported } from "firebase/messaging";
import { app } from "./firebase";
import { vapidKey } from "./config";

export type PushStatus = "granted" | "default" | "denied" | "unsupported" | "needs-install";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export async function pushStatus(): Promise<PushStatus> {
  if (isIos() && !isStandalone()) return "needs-install";
  if (!vapidKey || !("Notification" in window) || !(await isSupported())) return "unsupported";
  const p = Notification.permission;
  return p === "granted" ? "granted" : p === "denied" ? "denied" : "default";
}

/** Call only when pushStatus() is "granted" or "default" (and from a user gesture on iOS). Returns the FCM token, or null. */
export async function enablePush(): Promise<string | null> {
  if ((await Notification.requestPermission()) !== "granted") return null;
  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { vapidKey, serviceWorkerRegistration: registration });
}
