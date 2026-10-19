interface Env {
  DB: D1Database;
  FIREBASE_PROJECT_ID: string;
  FIREBASE_API_KEY: string;
  FCM_SERVICE_ACCOUNT_JSON: string;
  PASSWORD_PEPPER: string;
}

interface ScheduleRow {
  owner_uid: string;
  pills_per_pack: number;
  pills_taken: number;
  reminder_time: string;
  timezone: string;
  last_taken_date: string | null;
  last_reminder_date: string | null;
}
interface UserRow { uid: string; personal_id: string; password_salt: string | null; password_hash: string | null }
interface ServiceAccount { client_email: string; private_key: string }

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};
const encoder = new TextEncoder();
let cachedGoogleToken: { token: string; expiresAt: number } | undefined;

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}
function localParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}
function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToBase64Url(bytes);
}
function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64Url(value: string) { return bytesToBase64Url(encoder.encode(value)); }

async function passwordHash(password: string, salt: string, pepper: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(`${salt}:${password}`));
  return bytesToBase64Url(new Uint8Array(digest));
}
async function personalId(uid: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(uid));
  return Array.from(new Uint8Array(digest)).slice(0, 5).map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
}

async function authenticatedUid(request: Request, env: Env) {
  const match = request.headers.get("Authorization")?.match(/^Bearer (.+)$/);
  if (!match) throw new ApiError(401, "Sign in to continue.");
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(env.FIREBASE_API_KEY)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken: match[1] }),
  });
  if (!response.ok) throw new ApiError(401, "Your sign-in expired. Please reopen the app.");
  const result = await response.json() as { users?: Array<{ localId?: string }> };
  const uid = result.users?.[0]?.localId;
  if (!uid) throw new ApiError(401, "Your sign-in could not be verified.");
  return uid;
}

async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* handled below */ }
  throw new ApiError(400, "Send a JSON request body.");
}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ApiError(400, message);
}

async function ensureProfile(uid: string, env: Env) {
  const id = await personalId(uid);
  await env.DB.prepare("INSERT OR IGNORE INTO users (uid, personal_id, created_at) VALUES (?, ?, ?)")
    .bind(uid, id, new Date().toISOString()).run();
  const user = await env.DB.prepare("SELECT * FROM users WHERE uid = ?").bind(uid).first<UserRow>();
  if (!user) throw new Error("Could not create the user profile.");
  return user;
}

async function googleAccessToken(env: Env) {
  if (cachedGoogleToken && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.token;
  let service: ServiceAccount;
  try { service = JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON) as ServiceAccount; }
  catch { throw new Error("FCM service account secret is not valid JSON."); }
  const issued = Math.floor(Date.now() / 1000);
  const assertionHeader = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const assertionPayload = base64Url(JSON.stringify({
    iss: service.client_email, sub: service.client_email,
    aud: "https://oauth2.googleapis.com/token", iat: issued, exp: issued + 3600,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  }));
  const unsigned = `${assertionHeader}.${assertionPayload}`;
  const pem = service.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(pem);
  const der = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const assertion = `${unsigned}.${bytesToBase64Url(new Uint8Array(signature))}`;
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!tokenResponse.ok) throw new Error("Google rejected the FCM service account credentials.");
  const token = await tokenResponse.json() as { access_token: string; expires_in: number };
  cachedGoogleToken = { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  return token.access_token;
}

async function notify(env: Env, uids: string[], title: string, messageBody: string, data: Record<string, string>) {
  const distinct = [...new Set(uids)];
  if (!distinct.length) return;
  const placeholders = distinct.map(() => "?").join(",");
  const query = await env.DB.prepare(`SELECT token_hash, token FROM devices WHERE uid IN (${placeholders})`).bind(...distinct).all<{token_hash: string; token: string}>();
  const devices = query.results ?? [];
  if (!devices.length) return;
  const accessToken = await googleAccessToken(env);
  await Promise.all(devices.map(async (device) => {
    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token: device.token, notification: { title, body: messageBody }, data } }),
    });
    if (!response.ok) {
      const details = await response.json().catch(() => null) as { error?: { details?: Array<{ errorCode?: string }> } } | null;
      const code = details?.error?.details?.[0]?.errorCode;
      if (code === "UNREGISTERED" || response.status === 404) {
        await env.DB.prepare("DELETE FROM devices WHERE token_hash = ?").bind(device.token_hash).run();
      } else {
        console.error("FCM send failed", response.status, code ?? "unknown");
      }
    }
  }));
}

async function subscribeToSchedule(uid: string, data: Record<string, unknown>, env: Env) {
  const targetId = String(data.personalId ?? "").trim().toUpperCase();
  const password = String(data.password ?? "");
  assert(/^[A-F0-9]{10}$/.test(targetId) && password.length >= 6 && password.length <= 72, "Enter a valid personal ID and password.");
  const target = await env.DB.prepare("SELECT * FROM users WHERE personal_id = ?").bind(targetId).first<UserRow>();
  if (!target) throw new ApiError(404, "That personal ID was not found.");
  if (target.uid === uid) throw new ApiError(400, "You cannot subscribe to your own schedule.");
  if (!target.password_hash || !target.password_salt) throw new ApiError(403, "The ID or password is incorrect.");
  const match = await passwordHash(password, target.password_salt, env.PASSWORD_PEPPER);
  if (match !== target.password_hash) throw new ApiError(403, "The ID or password is incorrect.");
  const schedule = await env.DB.prepare("SELECT owner_uid FROM schedules WHERE owner_uid = ?").bind(target.uid).first();
  if (!schedule) throw new ApiError(404, "This user has not created a schedule yet.");
  await env.DB.prepare("INSERT OR IGNORE INTO subscriptions (subscriber_uid, owner_uid, created_at) VALUES (?, ?, ?)")
    .bind(uid, target.uid, new Date().toISOString()).run();
  return { ok: true };
}

async function dashboard(uid: string, env: Env) {
  const user = await ensureProfile(uid, env);
  const own = await env.DB.prepare("SELECT * FROM schedules WHERE owner_uid = ?").bind(uid).first<ScheduleRow>();
  const following = await env.DB.prepare(`
    SELECT s.*, u.personal_id FROM subscriptions sub
    JOIN schedules s ON s.owner_uid = sub.owner_uid
    JOIN users u ON u.uid = s.owner_uid
    WHERE sub.subscriber_uid = ? ORDER BY sub.created_at
  `).bind(uid).all<ScheduleRow & {personal_id: string}>();
  const today = new Date();
  const ownResult = own ? { pillsPerPack: own.pills_per_pack, pillsTaken: own.pills_taken,
    reminderTime: own.reminder_time, takenToday: own.last_taken_date === localParts(today, own.timezone).date } : null;
  const subscribed = (following.results ?? []).map((item) => ({ ownerUid: item.owner_uid, personalId: item.personal_id,
    pillsPerPack: item.pills_per_pack, pillsTaken: item.pills_taken, reminderTime: item.reminder_time,
    takenToday: item.last_taken_date === localParts(today, item.timezone).date }));
  return { personalId: user.personal_id, hasPassword: Boolean(user.password_hash), own: ownResult, subscribed };
}

async function route(name: string, uid: string, data: Record<string, unknown>, env: Env): Promise<unknown> {
  if (name === "ensureProfile") {
    const user = await ensureProfile(uid, env);
    return { personalId: user.personal_id, hasSchedule: Boolean(await env.DB.prepare("SELECT 1 FROM schedules WHERE owner_uid = ?").bind(uid).first()) };
  }
  if (name === "setSchedulePassword") {
    const password = String(data.password ?? "");
    assert(password.length >= 6 && password.length <= 72, "Use a password from 6 to 72 characters.");
    const salt = randomSalt();
    const hash = await passwordHash(password, salt, env.PASSWORD_PEPPER);
    await env.DB.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE uid = ?").bind(salt, hash, uid).run();
    return { ok: true };
  }
  if (name === "createSchedule") {
    const pills = Number(data.pillsPerPack);
    const taken = Number(data.pillsTaken);
    const time = String(data.reminderTime ?? "");
    const timezone = String(data.timezone ?? "UTC");
    assert(Number.isInteger(pills) && pills >= 1 && pills <= 42, "Choose between 1 and 42 pills per pack.");
    assert(Number.isInteger(taken) && taken >= 0 && taken <= pills, "Taken pills must fit in the pack.");
    assert(/^([01]\d|2[0-3]):[0-5]\d$/.test(time), "Choose a valid reminder time.");
    try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
    catch { throw new ApiError(400, "Choose a valid time zone."); }
    const user = await env.DB.prepare("SELECT password_hash FROM users WHERE uid = ?").bind(uid).first<{password_hash: string | null}>();
    if (!user?.password_hash) throw new ApiError(412, "Set a subscriber password first.");
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO schedules (owner_uid, pills_per_pack, pills_taken, reminder_time, timezone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(owner_uid) DO UPDATE SET pills_per_pack=excluded.pills_per_pack,
        pills_taken=excluded.pills_taken, reminder_time=excluded.reminder_time,
        timezone=excluded.timezone, updated_at=excluded.updated_at
    `).bind(uid, pills, taken, time, timezone, now, now).run();
    return { ok: true };
  }
  if (name === "subscribeToSchedule") return subscribeToSchedule(uid, data, env);
  if (name === "getDashboard") return dashboard(uid, env);
  if (name === "registerDevice") {
    const token = String(data.token ?? "");
    assert(token.length >= 20 && token.length < 5000, "Invalid push notification token.");
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
    const tokenHash = bytesToBase64Url(new Uint8Array(digest));
    await env.DB.prepare(`INSERT INTO devices (token_hash, uid, token, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(token_hash) DO UPDATE SET uid=excluded.uid, token=excluded.token, updated_at=excluded.updated_at`)
      .bind(tokenHash, uid, token, new Date().toISOString()).run();
    return { ok: true };
  }
  if (name === "markPillTaken") {
    const now = new Date();
    const schedule = await env.DB.prepare("SELECT timezone FROM schedules WHERE owner_uid = ?").bind(uid).first<{timezone: string}>();
    if (!schedule) throw new ApiError(404, "Create a schedule first.");
    const today = localParts(now, schedule.timezone).date;
    const existing = await env.DB.prepare(`UPDATE schedules SET
      last_taken_date=?, pills_taken=MIN(pills_taken+1, pills_per_pack), updated_at=?
      WHERE owner_uid=? AND COALESCE(last_taken_date, '')<>? RETURNING pills_taken, pills_per_pack`)
      .bind(today, now.toISOString(), uid, today)
      .first<{pills_taken: number; pills_per_pack: number}>();
    if (!existing) {
      const current = await env.DB.prepare("SELECT last_taken_date FROM schedules WHERE owner_uid = ?").bind(uid).first<{last_taken_date: string | null}>();
      if (current?.last_taken_date === today) throw new ApiError(409, "Today’s pill is already marked as taken.");
      throw new Error("Could not mark today's pill as taken.");
    }
    const subs = await env.DB.prepare("SELECT subscriber_uid FROM subscriptions WHERE owner_uid = ?").bind(uid).all<{subscriber_uid: string}>();
    await notify(env, (subs.results ?? []).map((row) => row.subscriber_uid), "Pill taken", "Today’s pill has been marked as taken.", { type: "taken", ownerId: uid });
    return { ok: true, pillsTaken: existing.pills_taken, pillsPerPack: existing.pills_per_pack };
  }
  throw new ApiError(404, "Unknown app action.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "Use POST for app requests." }, 405);
    try {
      const name = new URL(request.url).pathname.split("/").filter(Boolean).at(-1) ?? "";
      const uid = await authenticatedUid(request, env);
      const data = await bodyOf(request);
      return json(await route(name, uid, data, env));
    } catch (error) {
      if (error instanceof ApiError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "The server could not complete that request." }, 500);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, _context: ExecutionContext) {
    const rows = await env.DB.prepare("SELECT * FROM schedules").all<ScheduleRow>();
    const now = new Date();
    for (const schedule of rows.results ?? []) {
      const local = localParts(now, schedule.timezone);
      if (local.time !== schedule.reminder_time || schedule.last_reminder_date === local.date || schedule.last_taken_date === local.date) continue;
      const claimed = await env.DB.prepare(`UPDATE schedules SET last_reminder_date=?
        WHERE owner_uid=? AND reminder_time=? AND COALESCE(last_reminder_date, '')<>?
        AND COALESCE(last_taken_date, '')<>? RETURNING owner_uid`)
        .bind(local.date, schedule.owner_uid, local.time, local.date, local.date).first();
      if (!claimed) continue;
      const subscribers = await env.DB.prepare("SELECT subscriber_uid FROM subscriptions WHERE owner_uid = ?")
        .bind(schedule.owner_uid).all<{subscriber_uid: string}>();
      await notify(env, [schedule.owner_uid], "Pill reminder", "It’s time for today’s pill.", { type: "reminder", ownerId: schedule.owner_uid });
      await notify(env, (subscribers.results ?? []).map((row) => row.subscriber_uid), "Pill reminder", "A pill is due now.", { type: "reminder", ownerId: schedule.owner_uid });
    }
  },
};
