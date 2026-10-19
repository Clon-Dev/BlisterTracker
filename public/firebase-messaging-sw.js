// Push service worker. The worker sends data-only FCM messages (same payload as for Android):
// { data: { title, message, tag, categoryId?, actionTitle?, body: JSON {pid, day} } }.
// A notification is always shown (iOS revokes push permission for silent pushes).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = (event.data && event.data.json().data) || {}; } catch { /* not JSON */ }
  let info = {};
  try { info = JSON.parse(data.body || "{}"); } catch { /* no extra data */ }
  const options = { body: data.message || "", icon: "/icon-192.png", badge: "/icon-192.png", tag: data.tag, data: info };
  // The owner's reminder gets a "Taken" button (where the browser supports buttons).
  if (data.categoryId === "reminder") options.actions = [{ action: "taken", title: data.actionTitle || "Taken" }];
  event.waitUntil(self.registration.showNotification(data.title || "Blister Buddy", options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { pid, day } = event.notification.data || {};
  const taken = event.action === "taken" && pid && day;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const open = windows.find((w) => "focus" in w);
    if (open) {
      if (taken) open.postMessage({ type: "taken", pid, day });
      return open.focus();
    }
    return self.clients.openWindow(taken ? `/?taken=${day}&pid=${pid}` : "/");
  }));
});
