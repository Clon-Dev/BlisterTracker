// Blister Buddy notifier: a cron-only Cloudflare Worker (no HTTP endpoint).
// Every minute it
//   1. sends due daily reminders (users/{pid}.nextReminderAt <= now) to the owner and subscribers,
//   2. tells subscribers when a pill was marked taken (users/{pid}.takenPending == true).
// Data lives in Firestore (Firebase Spark plan); pushes go out via the FCM HTTP v1 API.

export interface Env {
  FIREBASE_PROJECT_ID: string;
  APP_URL: string;
  SERVICE_ACCOUNT_JSON: string;
}

type Value = {
  stringValue?: string; integerValue?: string; booleanValue?: boolean; timestampValue?: string;
  nullValue?: null; arrayValue?: { values?: Value[] };
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
/** Last path segment of a doc name: the pid for users/{pid}, the uid for accounts/{uid}. */
const pidOf = (d: Doc) => d.name.split("/").pop()!;
const ts = (ms: number | null): Value => (ms === null ? { nullValue: null } : { timestampValue: new Date(ms).toISOString() });

// ---------- Time zones (no libraries in Workers; Intl does the work) ----------

function zonedParts(at: number, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at)).map((p) => [p.type, Number(p.value)]));
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

const dayKey = (at: number, tz: string) => {
  const p = zonedParts(at, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** UTC ms for a wall-clock time in tz (day may overflow; Date.UTC normalizes it). */
function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (at: number) => {
    const p = zonedParts(at, tz);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
  };
  const first = guess - offset(guess);
  return guess - offset(first); // second pass settles DST boundaries
}

/** First occurrence of "HH:MM" in tz strictly after `after`. */
export function nextOccurrence(time: string, tz: string, after: number) {
  const [h, m] = time.split(":").map(Number);
  const p = zonedParts(after, tz);
  for (let k = 0; k < 3; k++) {
    const t = zonedToUtc(p.year, p.month, p.day + k, h, m, tz);
    if (t > after) return t;
  }
  return after + 24 * 3600 * 1000;
}

// ---------- FCM ----------

type Lang = "en" | "de";
type Text = { title: string; body: string };
const TEXT = {
  en: {
    ownerReminder: (): Text => ({ title: "💊 Pill time", body: "Time to take today’s pill." }),
    subscriberReminder: (name: string): Text => ({ title: "💊 Pill time", body: `${name} should take today’s pill now.` }),
    taken: (name: string, taken: number, total: number): Text => ({ title: "✅ Pill taken", body: `${name} took today’s pill (${taken}/${total}).` }),
  },
  de: {
    ownerReminder: (): Text => ({ title: "💊 Pillenzeit", body: "Zeit für die heutige Pille." }),
    subscriberReminder: (name: string): Text => ({ title: "💊 Pillenzeit", body: `${name} sollte jetzt die heutige Pille nehmen.` }),
    taken: (name: string, taken: number, total: number): Text => ({ title: "✅ Pille genommen", body: `${name} hat die heutige Pille genommen (${taken}/${total}).` }),
  },
} satisfies Record<Lang, unknown>;
type Texts = (typeof TEXT)["en"];

/** Sends to every device of the given accounts, each in its account's language. Returns the number delivered. */
async function sendAll(env: Env, fs: Firestore, uids: string[], text: (t: Texts) => Text, tag: string) {
  const targets = await fs.devices(uids);
  let sent = 0;
  await Promise.all(targets.map(async ({ uid, token, lang }) => {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${fs.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: {
        token,
        notification: text(TEXT[lang]),
        data: { tag },
        android: { priority: "HIGH", notification: { channel_id: "default", tag } },
        webpush: { headers: { Urgency: "high" }, fcm_options: { link: env.APP_URL } },
      } }),
    });
    if (res.ok) { sent++; return; }
    const body = await res.text();
    if (res.status === 404 || body.includes("UNREGISTERED") || body.includes("registration token is not a valid")) {
      await fs.removeToken(uid, token); // app uninstalled or token rotated
    } else {
      console.error(`FCM send failed (${res.status}): ${body}`);
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
    const tz = str(doc, "tz");
    const dueAt = Date.parse(doc.fields!.nextReminderAt.timestampValue!);
    const finished = int(doc, "taken") >= int(doc, "pillsPerPack");
    const alreadyTaken = str(doc, "lastTakenDay") === dayKey(dueAt, tz);

    // Claim the reminder first so a failure can never cause duplicate notifications.
    const next = finished ? null : nextOccurrence(str(doc, "time"), tz, now);
    if (!(await fs.patchIfUnchanged(doc, { nextReminderAt: ts(next) }))) return;
    if (finished || alreadyTaken || now - dueAt > MAX_LATE_MS) return;

    const name = str(doc, "name") || pid;
    const subs = await fs.subscriberUids(pid);
    const a = await sendAll(env, fs, [str(doc, "ownerUid")], (t) => t.ownerReminder(), `reminder-${pid}`);
    const b = await sendAll(env, fs, subs, (t) => t.subscriberReminder(name), `reminder-${pid}`);
    console.log(`reminder ${pid}: ${a + b} notifications`);
  });
}

async function sendTakenUpdates(env: Env, fs: Firestore) {
  const pending = await fs.query("takenPending", "EQUAL", { booleanValue: true });
  await forEachDoc("taken", pending, async (doc, pid) => {
    if (!(await fs.patchIfUnchanged(doc, { takenPending: { booleanValue: false } }))) return;
    const name = str(doc, "name") || pid;
    const subs = await fs.subscriberUids(pid);
    const sent = await sendAll(env, fs, subs, (t) => t.taken(name, int(doc, "taken"), int(doc, "pillsPerPack")), `taken-${pid}`);
    console.log(`taken ${pid}: ${sent} notifications`);
  });
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    const fs = new Firestore(env, await accessToken(env));
    const now = Date.now();
    // Sequential: both jobs may patch the same doc with an updateTime precondition.
    ctx.waitUntil(sendTakenUpdates(env, fs).then(() => sendReminders(env, fs, now)));
  },
} satisfies ExportedHandler<Env>;
