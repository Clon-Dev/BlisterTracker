// Legacy Firebase Functions backend. Deploying this requires Blaze; the active
// no-Firebase-billing backend is worker/src/index.ts.
import { createHash } from "node:crypto";
import * as bcrypt from "bcryptjs";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();
const db = getFirestore();
const region = "europe-west1";
const schedules = db.collection("schedules");
const dayKey = (date: Date, zone: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
}).format(date);
const clockKey = (date: Date, zone: string) => new Intl.DateTimeFormat("en-GB", {
  timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(date);

function uidOf(request: CallableRequest<unknown>) {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to continue.");
  return request.auth.uid;
}
function failUnless(ok: unknown, message: string): asserts ok {
  if (!ok) throw new HttpsError("invalid-argument", message);
}
function personalId(uid: string) {
  return createHash("sha256").update(uid).digest("hex").slice(0, 10).toUpperCase();
}

export const ensureProfile = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const ref = db.collection("users").doc(uid);
  await ref.set({ personalId: personalId(uid), createdAt: FieldValue.serverTimestamp() }, { merge: true });
  const data = (await ref.get()).data()!;
  return { personalId: data.personalId, hasSchedule: data.hasSchedule === true };
});

export const setSchedulePassword = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const password = String(request.data?.password ?? "");
  failUnless(password.length >= 6 && password.length <= 72, "Use a password from 6 to 72 characters.");
  const hash = await bcrypt.hash(password, 10);
  await db.collection("users").doc(uid).set({ passwordHash: hash }, { merge: true });
  return { ok: true };
});

export const createSchedule = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const pills = Number(request.data?.pillsPerPack);
  const taken = Number(request.data?.pillsTaken);
  const reminderTime = String(request.data?.reminderTime ?? "");
  const timezone = String(request.data?.timezone ?? "UTC");
  failUnless(Number.isInteger(pills) && pills >= 1 && pills <= 42, "Choose between 1 and 42 pills per pack.");
  failUnless(Number.isInteger(taken) && taken >= 0 && taken <= pills, "Taken pills must fit in the pack.");
  failUnless(/^([01]\d|2[0-3]):[0-5]\d$/.test(reminderTime), "Choose a valid reminder time.");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
  catch { throw new HttpsError("invalid-argument", "Choose a valid time zone."); }
  const user = db.collection("users").doc(uid);
  const data = (await user.get()).data();
  if (!data?.passwordHash) throw new HttpsError("failed-precondition", "Set a subscriber password first.");
  await schedules.doc(uid).set({
    ownerUid: uid, pillsPerPack: pills, pillsTaken: taken, reminderTime, timezone,
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await user.set({ hasSchedule: true }, { merge: true });
  return { ok: true };
});

export const subscribeToSchedule = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const targetId = String(request.data?.personalId ?? "").trim().toUpperCase();
  const password = String(request.data?.password ?? "");
  failUnless(/^[A-F0-9]{10}$/.test(targetId) && password.length >= 6, "Enter a valid personal ID and password.");
  const userQuery = await db.collection("users").where("personalId", "==", targetId).limit(1).get();
  if (userQuery.empty) throw new HttpsError("not-found", "That personal ID was not found.");
  const target = userQuery.docs[0];
  if (target.id === uid) throw new HttpsError("failed-precondition", "You cannot subscribe to your own schedule.");
  const hash = target.data().passwordHash;
  if (!hash || !(await bcrypt.compare(password, hash))) throw new HttpsError("permission-denied", "The ID or password is incorrect.");
  if (!(await schedules.doc(target.id).get()).exists) throw new HttpsError("not-found", "This user has not created a schedule yet.");
  await db.collection("subscriptions").doc(uid).collection("items").doc(target.id).set({
    ownerUid: target.id, personalId: targetId, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

export const getDashboard = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const user = (await db.collection("users").doc(uid).get()).data() ?? {};
  const ownSnap = await schedules.doc(uid).get();
  const subscriptions = await db.collection("subscriptions").doc(uid).collection("items").get();
  const subscribed = await Promise.all(subscriptions.docs.map(async (sub) => {
    const schedule = await schedules.doc(sub.id).get();
    const owner = await db.collection("users").doc(sub.id).get();
    if (!schedule.exists) return null;
    const s = schedule.data()!;
    return { ownerUid: sub.id, personalId: owner.data()?.personalId ?? sub.data().personalId,
      pillsPerPack: s.pillsPerPack, pillsTaken: s.pillsTaken, reminderTime: s.reminderTime,
      takenToday: s.lastTakenDate === dayKey(new Date(), s.timezone ?? "UTC") };
  }));
  let own = null;
  if (ownSnap.exists) {
    const s = ownSnap.data()!;
    own = { pillsPerPack: s.pillsPerPack, pillsTaken: s.pillsTaken, reminderTime: s.reminderTime,
      takenToday: s.lastTakenDate === dayKey(new Date(), s.timezone ?? "UTC") };
  }
  return { personalId: user.personalId ?? personalId(uid), hasPassword: Boolean(user.passwordHash), own, subscribed: subscribed.filter(Boolean) };
});

export const registerDevice = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const token = String(request.data?.token ?? "");
  failUnless(token.length >= 20 && token.length < 5000, "Invalid push notification token.");
  const id = createHash("sha256").update(token).digest("hex");
  await db.collection("users").doc(uid).collection("devices").doc(id).set({ token, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

async function tokensForUsers(uids: string[]) {
  const snapshots = await Promise.all([...new Set(uids)].map((uid) => db.collection("users").doc(uid).collection("devices").get()));
  return snapshots.flatMap((snap) => snap.docs.map((d) => ({ ref: d.ref, token: String(d.data().token) })));
}
async function notify(uids: string[], title: string, body: string, data: Record<string, string> = {}) {
  const devices = await tokensForUsers(uids);
  for (let i = 0; i < devices.length; i += 500) {
    const batch = devices.slice(i, i + 500);
    if (!batch.length) continue;
    const result = await getMessaging().sendEachForMulticast({
      tokens: batch.map((d) => d.token), notification: { title, body }, data,
    });
    const stale = batch.filter((_, index) => {
      const code = result.responses[index].error?.code;
      return code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token";
    });
    await Promise.all(stale.map((d) => d.ref.delete()));
  }
}

export const markPillTaken = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const ref = schedules.doc(uid);
  const today = new Date();
  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "Create a schedule first.");
    const schedule = snap.data()!;
    const date = dayKey(today, schedule.timezone ?? "UTC");
    if (schedule.lastTakenDate === date) throw new HttpsError("already-exists", "Today’s pill is already marked as taken.");
    const next = Math.min(Number(schedule.pillsTaken) + 1, Number(schedule.pillsPerPack));
    transaction.update(ref, { lastTakenDate: date, pillsTaken: next, updatedAt: FieldValue.serverTimestamp() });
    return { next, pillsPerPack: Number(schedule.pillsPerPack) };
  });
  const subs = await db.collection("subscriptions").doc(uid).collection("items").get();
  await notify(subs.docs.map((d) => d.id), "Pill taken", "Today’s pill has been marked as taken.", { type: "taken", ownerId: uid });
  return { ok: true, pillsTaken: result.next, pillsPerPack: result.pillsPerPack };
});

export const resetPack = onCall({ region }, async (request) => {
  const uid = uidOf(request);
  const taken = Number(request.data?.pillsTaken);
  const ref = schedules.doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Create a schedule first.");
  failUnless(Number.isInteger(taken) && taken >= 0 && taken <= Number(snap.data()!.pillsPerPack), "Choose a valid pill count.");
  await ref.update({ pillsTaken: taken, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

export const sendDailyReminders = onSchedule({ schedule: "every 1 minutes", timeZone: "UTC", region }, async () => {
  const now = new Date();
  const scheduleSnapshot = await schedules.get();
  const due: string[] = [];
  for (const doc of scheduleSnapshot.docs) {
    const s = doc.data();
    const zone = String(s.timezone ?? "UTC");
    const today = dayKey(now, zone);
    if (clockKey(now, zone) === s.reminderTime && s.lastReminderDate !== today && s.lastTakenDate !== today) {
      due.push(doc.id);
      await doc.ref.update({ lastReminderDate: today });
    }
  }
  for (const uid of due) {
    const subscribers = await db.collection("subscriptions").doc(uid).collection("items").get();
    await notify([uid], "Pill reminder", "It’s time for today’s pill.", { type: "reminder", ownerId: uid });
    await notify(subscribers.docs.map((d) => d.id), "Pill reminder", "A pill is due now.", { type: "reminder", ownerId: uid });
  }
});
