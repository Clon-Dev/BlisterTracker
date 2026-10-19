// Minimal push service worker. FCM delivers web pushes as
// { notification: { title, body }, data, ... }; we always show a notification
// (iOS revokes push permission for silent pushes).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* non-JSON payload */ }
  const n = payload.notification || {};
  event.waitUntil(self.registration.showNotification(n.title || "Blister Buddy", {
    body: n.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: (payload.data && payload.data.tag) || undefined,
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const w of windows) if ("focus" in w) return w.focus();
    return self.clients.openWindow("/");
  }));
});
