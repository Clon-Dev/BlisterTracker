// Blister Buddy notifier: a cron-only Cloudflare Worker (no HTTP endpoint).
// Every minute it
//   1. sends due reminders (users/{pid}.nextReminderAt <= now): the owner gets the reminder and its
//      repeats (with a "Taken" button), followers the first one,
//   2. tells followers when a pill is still not taken (nextLateAt <= now),
//   3. tells followers when today's pill was marked taken (takenPending == true),
//   4. sends the owner's refill and appointment notices (nextNoticeAt <= now).
// The app computes nextReminderAt/nextLateAt on every change with the same shared/schedule.ts;
// the worker advances them after each send. Pushes go out as data-only FCM messages, which the
// Android app (expo-notifications) and the web service worker turn into notifications.

import {
  addDays, dayKey, lateTime, nextLateAt, nextNoticeAt, nextReminderAt, noticesAt, reminderTimes, type Plan,
} from "../../shared/schedule";

export interface Env {
  FIREBASE_PROJECT_ID: string;
  SERVICE_ACCOUNT_JSON: string;
}

type Value = {
  stringValue?: string; integerValue?: string; booleanValue?: boolean; timestampValue?: string;
  nullValue?: null; arrayValue?: { values?: Value[] }; mapValue?: { fields?: Record<string, Value> };
};
type Doc = { name: string; fields?: Record<string, Value>; updateTime: string };

const MAX_LATE_MS = 6 * 60 * 60 * 1000; // after an outage, skip reminders older than this

// ---------- Google auth (service account → OAuth access token) ----------

let cachedToken: { token: string; expires: number } | null = null;

const b64url = (data: ArrayBuffer | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function accessToken(env: Env) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const sa = JSON.parse(env.SERVICE_ACCOUNT_JSON) as { client_email: string; private_key: string };
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`OAuth token request failed: ${res.status} ${await res.text()}`);
  const json = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return cachedToken.token;
}

// ---------- Firestore REST ----------

class Firestore {
  private env: Env;
  readonly token: string;
  constructor(env: Env, token: string) { this.env = env; this.token = token; }
  get root() { return `projects/${this.env.FIREBASE_PROJECT_ID}/databases/(default)/documents`; }

  async call<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T }> {
    const res = await fetch(`https://firestore.googleapis.com/v1/${path}`, {
      ...init, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
    });
    return { ok: res.ok, status: res.status, body: await res.json() as T };
  }

  async query(field: string, op: string, value: Value): Promise<Doc[]> {
    const r = await this.call<{ document?: Doc }[]>(`${this.root}:runQuery`, {
      method: "POST",
      body: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: "users" }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value } },
        limit: 100,
      } }),
    });
    if (!r.ok) throw new Error(`runQuery ${field} failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.flatMap((x) => (x.document ? [x.document] : []));
  }

  async subscriberUids(pid: string): Promise<string[]> {
    const r = await this.call<{ documents?: Doc[] }>(`${this.root}/users/${pid}/subscribers?pageSize=100`);
    return (r.body.documents ?? []).map(pidOf);
  }

  /** Push targets (FCM token + notification language) of the given accounts. */
  async devices(uids: string[]): Promise<{ uid: string; token: string; lang: Lang }[]> {
    if (!uids.length) return [];
    const r = await this.call<{ found?: Doc }[]>(`${this.root}:batchGet`, {
      method: "POST", body: JSON.stringify({ documents: uids.map((u) => `${this.root}/accounts/${u}`) }),
    });
    return r.body.flatMap((x) => {
      if (!x.found) return [];
      const uid = pidOf(x.found);
      const lang: Lang = str(x.found, "lang") === "de" ? "de" : "en";
      return (x.found.fields?.tokens?.arrayValue?.values ?? []).map((v) => ({ uid, token: v.stringValue!, lang }));
    });
  }

  /** Updates fields only if the doc hasn't changed since we read it; false if the owner edited it meanwhile. */
  async patchIfUnchanged(doc: Doc, fields: Record<string, Value>) {
    const params = new URLSearchParams({ "currentDocument.updateTime": doc.updateTime });
    for (const f of Object.keys(fields)) params.append("updateMask.fieldPaths", f);
    const r = await this.call(`${doc.name}?${params}`, { method: "PATCH", body: JSON.stringify({ fields }) });
    return r.ok;
  }

  async removeToken(uid: string, token: string) {
    await this.call(`${this.root}:commit`, {
      method: "POST",
      body: JSON.stringify({ writes: [{ transform: {
        document: `${this.root}/accounts/${uid}`,
        fieldTransforms: [{ fieldPath: "tokens", removeAllFromArray: { values: [{ stringValue: token }] } }],
      } }] }),
    });
  }
}

const str = (d: Doc, f: string) => d.fields?.[f]?.stringValue ?? "";
const int = (d: Doc, f: string) => Number(d.fields?.[f]?.integerValue ?? 0);
const millis = (d: Doc, f: string) => Date.parse(d.fields![f].timestampValue!);
/** Last path segment of a doc name: the pid for users/{pid}, the uid for accounts/{uid}. */
const pidOf = (d: Doc) => d.name.split("/").pop()!;
const ts = (ms: number | null): Value => (ms === null ? { nullValue: null } : { timestampValue: new Date(ms).toISOString() });

function planOf(d: Doc): Plan {
  const taken = d.fields?.takenDays?.mapValue?.fields ?? {};
  return {
    pillsPerPack: int(d, "pillsPerPack"), placebo: int(d, "placebo"), breakDays: int(d, "breakDays"),
    packStart: str(d, "packStart"), trackingSince: str(d, "trackingSince"), time: str(d, "time"), tz: str(d, "tz"),
    repeatMinutes: int(d, "repeatMinutes"), lateMinutes: int(d, "lateMinutes"),
    takenDays: Object.fromEntries(Object.entries(taken).map(([day, v]) => [day, v.stringValue ?? ""])),
    earlierPackStarts: (d.fields?.earlierPackStarts?.arrayValue?.values ?? []).map((v) => v.stringValue!),
    supplyPacks: int(d, "supplyPacks"), supplyFrom: str(d, "supplyFrom") || undefined,
    appointmentDay: str(d, "appointmentDay") || null,
  };
}

// ---------- FCM ----------

type Lang = "en" | "de";
type Text = { title: string; body: string };
const TEXT = {
  en: {
    ownerReminder: (): Text => ({ title: "💊 Pill time", body: "Time to take today’s pill." }),
    ownerRepeat: (): Text => ({ title: "💊 Still not taken", body: "Don’t forget today’s pill." }),
    subscriberReminder: (name: string): Text => ({ title: "💊 Pill time", body: `${name} should take today’s pill now.` }),
    late: (name: string): Text => ({ title: "⏰ Not taken yet", body: `${name} hasn’t marked today’s pill as taken yet.` }),
    taken: (name: string, time: string): Text => ({ title: "✅ Pill taken", body: `${name} took today’s pill at ${time}.` }),
    refill: (): Text => ({ title: "📦 Last pack started", body: "Time to get a refill of your pill." }),
    appointment: (note: string): Text => ({ title: "🩺 Doctor’s appointment tomorrow", body: note || "Don’t forget your appointment tomorrow." }),
    takenButton: "Taken ✓",
  },
  de: {
    ownerReminder: (): Text => ({ title: "💊 Pillenzeit", body: "Zeit für die heutige Pille." }),
    ownerRepeat: (): Text => ({ title: "💊 Noch nicht genommen", body: "Vergiss die heutige Pille nicht." }),
    subscriberReminder: (name: string): Text => ({ title: "💊 Pillenzeit", body: `${name} sollte jetzt die heutige Pille nehmen.` }),
    late: (name: string): Text => ({ title: "⏰ Noch nicht genommen", body: `${name} hat die heutige Pille noch nicht als genommen markiert.` }),
    taken: (name: string, time: string): Text => ({ title: "✅ Pille genommen", body: `${name} hat die heutige Pille um ${time} genommen.` }),
    refill: (): Text => ({ title: "📦 Letzter Blister angebrochen", body: "Zeit, die Pille nachzukaufen." }),
    appointment: (note: string): Text => ({ title: "🩺 Arzttermin morgen", body: note || "Denk an deinen Termin morgen." }),
    takenButton: "Genommen ✓",
  },
} satisfies Record<Lang, unknown>;
type Texts = (typeof TEXT)["en"];

/** With `takenAction`, the notification gets a "Taken" button that marks the pill of `day`. */
type Push = { text: (t: Texts) => Text; tag: string; takenAction?: { pid: string; day: string } };

/** Sends to every device of the given accounts, each in its account's language. Returns the number delivered. */
async function sendAll(env: Env, fs: Firestore, uids: string[], push: Push) {
  const targets = await fs.devices(uids);
  let sent = 0;
  await Promise.all(targets.map(async ({ uid, token, lang }) => {
    const { title, body } = push.text(TEXT[lang]);
    // Data-only: expo-notifications (Android) and the web service worker build the notification from these keys.
    const data: Record<string, string> = { title, message: body, tag: push.tag, channelId: "default", body: JSON.stringify(push.takenAction ?? {}) };
    if (push.takenAction) Object.assign(data, { categoryId: "reminder", actionTitle: TEXT[lang].takenButton });
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${fs.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data, android: { priority: "HIGH" }, webpush: { headers: { Urgency: "high" } } } }),
    });
    if (res.ok) { sent++; return; }
    const text = await res.text();
    if (res.status === 404 || text.includes("UNREGISTERED") || text.includes("registration token is not a valid")) {
      await fs.removeToken(uid, token); // app uninstalled or token rotated
    } else {
      console.error(`FCM send failed (${res.status}): ${text}`);
    }
  }));
  return sent;
}

// ---------- Jobs ----------

/** Processes docs one by one; a failure is logged and doesn't stop the others. */
async function forEachDoc(job: string, docs: Doc[], fn: (doc: Doc, pid: string) => Promise<void>) {
  for (const doc of docs) {
    const pid = pidOf(doc);
    try { await fn(doc, pid); } catch (e) { console.error(`${job} ${pid} failed:`, e); }
  }
}

async function sendReminders(env: Env, fs: Firestore, now: number) {
  const due = await fs.query("nextReminderAt", "LESS_THAN_OR_EQUAL", ts(now));
  await forEachDoc("reminder", due, async (doc, pid) => {
    const plan = planOf(doc);
    const dueAt = millis(doc, "nextReminderAt");
    const day = dayKey(dueAt, plan.tz);
    // Claim it first so a failure can never cause duplicate notifications.
    if (!(await fs.patchIfUnchanged(doc, { nextReminderAt: ts(nextReminderAt(plan, now)) }))) return;
    // Not one of today's reminder moments any more (taken meanwhile) or too old after an outage.
    const index = reminderTimes(plan, day).indexOf(dueAt);
    if (index < 0 || now - dueAt > MAX_LATE_MS) return;

    const name = str(doc, "name") || pid;
    // The owner may replace the reminder wording (e.g. something discreet); it then becomes the title.
    const custom = str(doc, "reminderText");
    const owner = sendAll(env, fs, [str(doc, "ownerUid")], {
      text: (t) => (custom ? { title: custom, body: "" } : index === 0 ? t.ownerReminder() : t.ownerRepeat()),
      tag: `reminder-${pid}`, takenAction: { pid, day },
    });
    // Followers only get the first reminder; repeats are for the owner.
    const followers = index === 0
      ? sendAll(env, fs, await fs.subscriberUids(pid), { text: (t) => t.subscriberReminder(name), tag: `reminder-${pid}` })
      : 0;
    console.log(`reminder ${pid} #${index}: ${(await owner) + (await followers)} notifications`);
  });
}

async function sendLateAlerts(env: Env, fs: Firestore, now: number) {
  const due = await fs.query("nextLateAt", "LESS_THAN_OR_EQUAL", ts(now));
  await forEachDoc("late", due, async (doc, pid) => {
    const plan = planOf(doc);
    const dueAt = millis(doc, "nextLateAt");
    if (!(await fs.patchIfUnchanged(doc, { nextLateAt: ts(nextLateAt(plan, now)) }))) return;
    // The alert belongs to the pill day it falls on or (late evening + delay) the day before.
    const today = dayKey(dueAt, plan.tz);
    const still = [today, addDays(today, -1)].some((d) => lateTime(plan, d) === dueAt);
    if (!still || now - dueAt > MAX_LATE_MS) return;
    const name = str(doc, "name") || pid;
    const sent = await sendAll(env, fs, await fs.subscriberUids(pid), { text: (t) => t.late(name), tag: `late-${pid}` });
    console.log(`late ${pid}: ${sent} notifications`);
  });
}

async function sendTakenUpdates(env: Env, fs: Firestore, now: number) {
  const pending = await fs.query("takenPending", "EQUAL", { booleanValue: true });
  await forEachDoc("taken", pending, async (doc, pid) => {
    if (!(await fs.patchIfUnchanged(doc, { takenPending: { booleanValue: false } }))) return;
    const plan = planOf(doc);
    const time = plan.takenDays[dayKey(now, plan.tz)];
    if (!time) return; // unmarked again before we got to it
    const name = str(doc, "name") || pid;
    const sent = await sendAll(env, fs, await fs.subscriberUids(pid), { text: (t) => t.taken(name, time), tag: `taken-${pid}` });
    console.log(`taken ${pid}: ${sent} notifications`);
  });
}

async function sendNotices(env: Env, fs: Firestore, now: number) {
  const due = await fs.query("nextNoticeAt", "LESS_THAN_OR_EQUAL", ts(now));
  await forEachDoc("notice", due, async (doc, pid) => {
    const plan = planOf(doc);
    const dueAt = millis(doc, "nextNoticeAt");
    if (!(await fs.patchIfUnchanged(doc, { nextNoticeAt: ts(nextNoticeAt(plan, now)) }))) return;
    if (now - dueAt > MAX_LATE_MS) return;
    const note = str(doc, "appointmentNote");
    for (const kind of noticesAt(plan, dueAt)) {
      const sent = await sendAll(env, fs, [str(doc, "ownerUid")], {
        text: (t) => (kind === "refill" ? t.refill() : t.appointment(note)), tag: `${kind}-${pid}`,
      });
      console.log(`${kind} ${pid}: ${sent} notifications`);
    }
  });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const fs = new Firestore(env, await accessToken(env));
    const now = Date.now();
    // Sequential: the jobs may patch the same doc with an updateTime precondition.
    ctx.waitUntil(sendTakenUpdates(env, fs, now)
      .then(() => sendReminders(env, fs, now))
      .then(() => sendLateAlerts(env, fs, now))
      .then(() => sendNotices(env, fs, now)));
  },
} satisfies ExportedHandler<Env>;
