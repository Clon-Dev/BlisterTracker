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

/** The service worker shows the button itself (title comes with the push). */
export async function registerTakenAction(_buttonTitle: string) {}

/**
 * Calls `cb(pid, day)` when the "Taken" button was pressed: the service worker either messages an open
 * window or opens the app with ?taken=<day>&pid=<pid>. (iPhone home-screen apps show no buttons.)
 */
export function onTakenAction(cb: (pid: string, day: string) => void) {
  const params = new URLSearchParams(window.location.search);
  const day = params.get("taken");
  const pid = params.get("pid");
  if (day && pid) {
    window.history.replaceState(null, "", window.location.pathname);
    cb(pid, day);
  }
  const onMessage = (e: MessageEvent) => {
    if (e.data?.type === "taken") cb(e.data.pid, e.data.day);
  };
  navigator.serviceWorker?.addEventListener("message", onMessage);
  return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
}
