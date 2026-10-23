// Blister Buddy notifier: a cron-only Cloudflare Worker (no HTTP endpoint).
// Every minute it
//   1. sends due reminders (users/{pid}.nextReminderAt <= now): the owner gets the reminder and its
//      repeats (with a "Taken" button), followers the first one,
//   2. tells followers when a pill (patch change, ring, injection) is still not done (nextLateAt <= now),
//   3. tells followers when today's pill (or action) was marked done (takenPending == true),
//   4. sends the owner's refill, appointment and upcoming-injection notices (nextNoticeAt <= now).
// Patch, ring and injection actions stay open until done, so their reminders come back daily.
// The app computes nextReminderAt/nextLateAt on every change with the same shared/schedule.ts;
// the worker advances them after each send. Pushes go out as data-only FCM messages, which the
// Android app (expo-notifications) and the web service worker turn into notifications.

import {
  actionKey, actionOn, addDays, dayKey, diffDays, doneOn, lateTime, METHODS, methodOf, nextLateAt, nextNoticeAt, nextReminderAt, noticesAt,
  openActionDay, reminderTimes, type ActionKey, type Method, type Plan,
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
  const method = str(d, "method") as Method;
  return {
    ...(METHODS.includes(method) ? { method } : {}),
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
type Key = ActionKey;
const EMOJI: Record<Key, string> = { pill: "💊", apply: "🩹", change: "🩹", removePatch: "🩹", insert: "⭕", removeRing: "⭕", inject: "💉" };
/** `at` is " at 09:12" / " um 09:12", or empty when the time isn't known. */
const TEXT = {
  en: {
    ownerReminder: (k: Key, daysLate: number): Text => (daysLate > 0
      ? { title: `${EMOJI[k]} ${EN_SHORT[k]} overdue`, body: `${daysLate === 1 ? "1 day" : `${daysLate} days`} late – open the app to see what applies now.` }
      : {
        pill: { title: "💊 Pill time", body: "Time to take today’s pill." },
        apply: { title: "🩹 New patch today", body: "Time to put on a new patch." },
        change: { title: "🩹 Patch change today", body: "Time to change your patch." },
        removePatch: { title: "🩹 Patch off today", body: "Time to take off your patch – the patch-free week starts." },
        insert: { title: "⭕ New ring today", body: "Time to insert a new ring." },
        removeRing: { title: "⭕ Ring out today", body: "Time to take out your ring – the ring-free week starts." },
        inject: { title: "💉 Injection due", body: "Your injection is due today." },
      }[k]),
    ownerRepeat: (k: Key): Text => (k === "pill"
      ? { title: "💊 Still not taken", body: "Don’t forget today’s pill." }
      : { title: `${EMOJI[k]} Still open`, body: `Don’t forget: ${EN_WHAT[k]}.` }),
    subscriberReminder: (name: string, k: Key): Text => ({ title: `${EMOJI[k]} ${k === "pill" ? "Pill time" : `${EN_SHORT[k]} today`}`, body: {
      pill: `${name} should take today’s pill now.`,
      apply: `${name} should put on a new patch today.`,
      change: `${name} should change the patch today.`,
      removePatch: `${name} should take off the patch today.`,
      insert: `${name} should insert a new ring today.`,
      removeRing: `${name} should take out the ring today.`,
      inject: `${name}’s injection is due today.`,
    }[k] }),
    late: (name: string, k: Key): Text => (k === "pill"
      ? { title: "⏰ Not taken yet", body: `${name} hasn’t marked today’s pill as taken yet.` }
      : { title: "⏰ Not done yet", body: `${name} hasn’t marked ${EN_WHAT[k]} as done yet (${k === "inject" ? "a week" : "a day"} late).` }),
    taken: (name: string, k: Key, at: string): Text => ({
      title: { pill: "✅ Pill taken", apply: "✅ New patch on", change: "✅ Patch changed", removePatch: "✅ Patch off", insert: "✅ New ring in", removeRing: "✅ Ring out", inject: "✅ Injection done" }[k],
      body: {
        pill: `${name} took today’s pill${at}.`,
        apply: `${name} put on a new patch${at}.`,
        change: `${name} changed the patch${at}.`,
        removePatch: `${name} took off the patch${at}.`,
        insert: `${name} inserted a new ring${at}.`,
        removeRing: `${name} took out the ring${at}.`,
        inject: `${name} got the injection${at}.`,
      }[k],
    }),
    at: (time: string) => (time ? ` at ${time}` : ""),
    refill: (m: Method): Text => (m === "patch" ? { title: "📦 Last patches started", body: "Time to get more patches." }
      : m === "ring" ? { title: "📦 Last ring in use", body: "Time to get new rings." }
        : { title: "📦 Last pack started", body: "Time to get a refill of your pill." }),
    appointment: (): Text => ({ title: "🩺 Doctor’s appointment tomorrow", body: "Don’t forget your appointment tomorrow." }),
    injection: (): Text => ({ title: "💉 Injection in 7 days", body: "Time to book your appointment." }),
    takenButton: "Taken ✓",
    doneButton: "Done ✓",
    seenButton: "Mark as seen",
  },
  de: {
    ownerReminder: (k: Key, daysLate: number): Text => (daysLate > 0
      ? { title: `${EMOJI[k]} ${DE_SHORT[k]} überfällig`, body: `${daysLate === 1 ? "1 Tag" : `${daysLate} Tage`} zu spät – in der App siehst du, was jetzt gilt.` }
      : {
        pill: { title: "💊 Pillenzeit", body: "Zeit für die heutige Pille." },
        apply: { title: "🩹 Heute neues Pflaster", body: "Zeit, ein neues Pflaster aufzukleben." },
        change: { title: "🩹 Heute Pflasterwechsel", body: "Zeit, dein Pflaster zu wechseln." },
        removePatch: { title: "🩹 Heute Pflaster ab", body: "Zeit, das Pflaster abzunehmen – die pflasterfreie Woche beginnt." },
        insert: { title: "⭕ Heute neuer Ring", body: "Zeit, einen neuen Ring einzusetzen." },
        removeRing: { title: "⭕ Heute Ring raus", body: "Zeit, den Ring herauszunehmen – die ringfreie Woche beginnt." },
        inject: { title: "💉 Spritze fällig", body: "Deine Spritze ist heute fällig." },
      }[k]),
    ownerRepeat: (k: Key): Text => (k === "pill"
      ? { title: "💊 Noch nicht genommen", body: "Vergiss die heutige Pille nicht." }
      : { title: `${EMOJI[k]} Noch offen`, body: `Nicht vergessen: ${DE_SHORT[k]}.` }),
    subscriberReminder: (name: string, k: Key): Text => ({ title: `${EMOJI[k]} ${k === "pill" ? "Pillenzeit" : `Heute: ${DE_SHORT[k]}`}`, body: {
      pill: `${name} sollte jetzt die heutige Pille nehmen.`,
      apply: `${name} sollte heute ein neues Pflaster aufkleben.`,
      change: `${name} sollte heute das Pflaster wechseln.`,
      removePatch: `${name} sollte heute das Pflaster abnehmen.`,
      insert: `${name} sollte heute einen neuen Ring einsetzen.`,
      removeRing: `${name} sollte heute den Ring herausnehmen.`,
      inject: `Die Spritze von ${name} ist heute fällig.`,
    }[k] }),
    late: (name: string, k: Key): Text => (k === "pill"
      ? { title: "⏰ Noch nicht genommen", body: `${name} hat die heutige Pille noch nicht als genommen markiert.` }
      : { title: "⏰ Noch nicht erledigt", body: `${name} hat ${DE_WHAT[k]} noch nicht als erledigt markiert (${k === "inject" ? "eine Woche" : "einen Tag"} zu spät).` }),
    taken: (name: string, k: Key, at: string): Text => ({
      title: { pill: "✅ Pille genommen", apply: "✅ Neues Pflaster drauf", change: "✅ Pflaster gewechselt", removePatch: "✅ Pflaster ab", insert: "✅ Neuer Ring drin", removeRing: "✅ Ring raus", inject: "✅ Spritze erledigt" }[k],
      body: {
        pill: `${name} hat die heutige Pille${at} genommen.`,
        apply: `${name} hat${at} ein neues Pflaster aufgeklebt.`,
        change: `${name} hat das Pflaster${at} gewechselt.`,
        removePatch: `${name} hat das Pflaster${at} abgenommen.`,
        insert: `${name} hat${at} einen neuen Ring eingesetzt.`,
        removeRing: `${name} hat den Ring${at} herausgenommen.`,
        inject: `${name} hat${at} die Spritze bekommen.`,
      }[k],
    }),
    at: (time: string) => (time ? ` um ${time}` : ""),
    refill: (m: Method): Text => (m === "patch" ? { title: "📦 Letzte Pflaster angebrochen", body: "Zeit, Pflaster nachzukaufen." }
      : m === "ring" ? { title: "📦 Letzter Ring in Gebrauch", body: "Zeit, neue Ringe zu besorgen." }
        : { title: "📦 Letzter Blister angebrochen", body: "Zeit, die Pille nachzukaufen." }),
    appointment: (): Text => ({ title: "🩺 Arzttermin morgen", body: "Denk an deinen Termin morgen." }),
    injection: (): Text => ({ title: "💉 Spritze in 7 Tagen", body: "Zeit, einen Termin zu vereinbaren." }),
    takenButton: "Genommen ✓",
    doneButton: "Erledigt ✓",
    seenButton: "Als gesehen markieren",
  },
} satisfies Record<Lang, unknown>;
const EN_SHORT: Record<Key, string> = { pill: "Pill", apply: "New patch", change: "Patch change", removePatch: "Patch off", insert: "New ring", removeRing: "Ring out", inject: "Injection" };
const EN_WHAT: Record<Key, string> = {
  pill: "today’s pill", apply: "the new patch", change: "the patch change", removePatch: "the patch removal", insert: "the new ring", removeRing: "the ring removal", inject: "the injection",
};
const DE_SHORT: Record<Key, string> = { pill: "Pille", apply: "Neues Pflaster", change: "Pflasterwechsel", removePatch: "Pflaster ab", insert: "Neuer Ring", removeRing: "Ring raus", inject: "Spritze" };
const DE_WHAT: Record<Key, string> = {
  pill: "die heutige Pille", apply: "das neue Pflaster", change: "den Pflasterwechsel", removePatch: "das Abnehmen des Pflasters", insert: "den neuen Ring", removeRing: "das Herausnehmen des Rings", inject: "die Spritze",
};
/** What's due on `day` (pill days: "pill"). */
const keyOn = (p: Plan, day: string): Key => actionKey(p, actionOn(p, day) ?? "pill");
type Texts = (typeof TEXT)["en"];

/**
 * With `action`, the notification gets a button for the pill of `day`: "taken" (the owner's reminder) marks it,
 * "seen" (the followers' "taken" notice) confirms the follower has seen it.
 */
type Push = { text: (t: Texts) => Text; tag: string; action?: { kind: "taken" | "seen"; pid: string; day: string; method?: Method } };

/** Sends to every device of the given accounts, each in its account's language. Returns the number delivered. */
async function sendAll(env: Env, fs: Firestore, uids: string[], push: Push) {
  const targets = await fs.devices(uids);
  let sent = 0;
  await Promise.all(targets.map(async ({ uid, token, lang }) => {
    const { title, body } = push.text(TEXT[lang]);
    // Data-only: expo-notifications (Android) and the web service worker build the notification from these keys.
    const { action } = push;
    const data: Record<string, string> = { title, message: body, tag: push.tag, channelId: "default", body: JSON.stringify(action ? { pid: action.pid, day: action.day } : {}) };
    if (action?.kind === "taken") {
      const pill = (action.method ?? "pill") === "pill";
      Object.assign(data, { categoryId: pill ? "reminder" : "action", actionTitle: pill ? TEXT[lang].takenButton : TEXT[lang].doneButton });
    }
    if (action?.kind === "seen") Object.assign(data, { categoryId: "seen", actionTitle: TEXT[lang].seenButton });
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

    const name = str(doc, "name") || str(doc, "username") || pid;
    // Patch / ring / injection: the open action may be carried over from an earlier day.
    const method = methodOf(plan);
    const open = method === "pill" ? day : openActionDay(plan, day) ?? day;
    const key = keyOn(plan, open);
    const daysLate = diffDays(open, day);
    // The owner may replace the reminder wording (e.g. something discreet); it then becomes the title.
    const custom = str(doc, "reminderText");
    const owner = sendAll(env, fs, [str(doc, "ownerUid")], {
      text: (t) => (custom ? { title: custom, body: "" } : index === 0 ? t.ownerReminder(key, daysLate) : t.ownerRepeat(key)),
      tag: `reminder-${pid}`, action: { kind: "taken", pid, day, method },
    });
    // Followers only get the first reminder, and only on the day it's scheduled (late alerts cover the days after).
    const followers = index === 0 && daysLate === 0
      ? sendAll(env, fs, await fs.subscriberUids(pid), { text: (t) => t.subscriberReminder(name, key), tag: `reminder-${pid}` })
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
    const name = str(doc, "name") || str(doc, "username") || pid;
    const open = methodOf(plan) === "pill" ? null : openActionDay(plan, today);
    const key = open ? keyOn(plan, open) : "pill";
    const sent = await sendAll(env, fs, await fs.subscriberUids(pid), { text: (t) => t.late(name, key), tag: `late-${pid}` });
    console.log(`late ${pid}: ${sent} notifications`);
  });
}

async function sendTakenUpdates(env: Env, fs: Firestore, now: number) {
  const pending = await fs.query("takenPending", "EQUAL", { booleanValue: true });
  await forEachDoc("taken", pending, async (doc, pid) => {
    if (!(await fs.patchIfUnchanged(doc, { takenPending: { booleanValue: false } }))) return;
    const plan = planOf(doc);
    const day = dayKey(now, plan.tz);
    // Pill: today's pill. Patch / ring / injection: the action done today, whatever day it was scheduled for.
    const done = methodOf(plan) === "pill" ? (plan.takenDays[day] ? { scheduled: day, time: plan.takenDays[day] } : null) : doneOn(plan, day);
    if (!done) return; // unmarked again before we got to it
    const key = keyOn(plan, done.scheduled);
    const name = str(doc, "name") || str(doc, "username") || pid;
    const sent = await sendAll(env, fs, await fs.subscriberUids(pid), {
      text: (t) => t.taken(name, key, t.at(done.time)), tag: `taken-${pid}`, action: { kind: "seen", pid, day },
    });
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
    // The appointment note is end-to-end encrypted, so the push stays generic.
    for (const kind of noticesAt(plan, dueAt)) {
      const sent = await sendAll(env, fs, [str(doc, "ownerUid")], {
        text: (t) => (kind === "refill" ? t.refill(methodOf(plan)) : kind === "injection" ? t.injection() : t.appointment()), tag: `${kind}-${pid}`,
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
