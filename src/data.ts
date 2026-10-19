import * as Crypto from "expo-crypto";
import {
  arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, onSnapshot, setDoc, Timestamp, updateDoc, writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { addDays, dayKey, nextLateAt, nextNoticeAt, nextReminderAt, slot, type Plan } from "../shared/schedule";
import { db } from "./firebase";
import { strings, type Lang } from "./i18n";

export type Account = { pid: string; subs: string[]; tokens: string[]; lang?: Lang };
/** users/{pid} with a schedule. The worker reads the same fields (see shared/schedule.ts). */
export type Schedule = Plan & {
  ownerUid: string;
  name: string;
  nextReminderAt: Timestamp;
  nextLateAt: Timestamp | null;
  /** Set when today's pill is marked; the worker notifies followers and clears it. */
  takenPending: boolean;
  /** Owner's refill/appointment notices (see shared/schedule.ts). */
  nextNoticeAt?: Timestamp | null;
  appointmentNote?: string;
  /** Replaces the wording of the owner's reminder ("" = default); at most 64 characters. */
  reminderText?: string;
};
export const REMINDER_TEXT_MAX = 64;
export const textLength = (text: string) => [...text].length; // code points, so an emoji counts once

export const MOODS = ["😄", "🙂", "😐", "😕", "😣"] as const;
export type Note = { text: string; mood: string | null };
export type Notes = Record<string, Note>;
export type Profile = { ownerUid: string } & Partial<Schedule>;
export type ScheduleInput = Pick<Schedule, "name" | "pillsPerPack" | "placebo" | "breakDays" | "time" | "repeatMinutes" | "lateMinutes"> & {
  reminderText: string;
  /** Position of today's day in the pack (pill index, or a break day after the pills). */
  todayIndex: number;
  /** "HH:MM" today's pill was taken, or null if not yet. */
  takenTodayAt: string | null;
};

// No 0/O, 1/I/L: IDs get read out loud and typed on phones.
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newPersonalId = () => Array.from(Crypto.getRandomBytes(6), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
export const normalizeId = (id: string) => id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const accessKey = (pid: string, password: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${pid}:${password}`);

export const hasSchedule = (p: Profile | null | undefined): p is Schedule => typeof p?.packStart === "string";

export const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** Today in the schedule's time zone. */
export const todayOf = (s: Plan) => dayKey(Date.now(), s.tz);

const ts = (ms: number | null) => (ms === null ? null : Timestamp.fromMillis(ms));

/** The worker's next notification moments; recomputed on every change the owner makes. */
function notificationTimes(plan: Plan) {
  const now = Date.now();
  return {
    nextReminderAt: Timestamp.fromMillis(nextReminderAt(plan, now)!), // a pack always has a pill day ahead
    nextLateAt: ts(nextLateAt(plan, now)),
    nextNoticeAt: ts(nextNoticeAt(plan, now)),
  };
}

const accountRef = (uid: string) => doc(db, "accounts", uid);
const userRef = (pid: string) => doc(db, "users", pid);
const authRef = (pid: string) => doc(db, "users", pid, "private", "auth");
const subscriberRef = (pid: string, uid: string) => doc(db, "users", pid, "subscribers", uid);

/** Loads the account for this device, claiming a fresh personal ID on first launch. */
export async function ensureAccount(uid: string, lang: Lang): Promise<Account> {
  const snap = await getDoc(accountRef(uid));
  if (snap.exists()) return snap.data() as Account;
  // 31^6 ≈ 890M IDs, so a collision is practically impossible; the rules reject it anyway
  // (create on an existing doc is denied) and the user can simply retry.
  const pid = newPersonalId();
  await setDoc(userRef(pid), { ownerUid: uid });
  const account: Account = { pid, subs: [], tokens: [], lang };
  await setDoc(accountRef(uid), account);
  return account;
}

/**
 * A Firestore listener dies on its first error and the screen keeps showing the last value. Around a
 * login the server can briefly reject a listen (new token not in use yet), so retry with backoff
 * (1 s, 3 s, 9 s) and only then report the error.
 */
function resilient(listen: (onError: (e: Error) => void) => Unsubscribe, onError?: () => void): Unsubscribe {
  let unsub: Unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;
  const start = () => {
    unsub = listen((e) => {
      if (stopped) return;
      console.warn(`Firestore listener failed (attempt ${failures + 1}):`, e.message);
      if (failures < 3) timer = setTimeout(start, 1000 * 3 ** failures++);
      else onError?.();
    });
  };
  start();
  return () => { stopped = true; clearTimeout(timer); unsub(); };
}

/**
 * Server-confirmed account snapshots only: a new entry in `subs` must not start a listener on that
 * schedule before the server has committed the matching follower doc, or the read is denied.
 */
export const watchAccount = (uid: string, cb: (a: Account) => void) => resilient((onError) =>
  onSnapshot(accountRef(uid), { includeMetadataChanges: true }, (s) => {
    if (s.exists() && !s.metadata.hasPendingWrites) cb(s.data() as Account);
  }, onError));

/** onError: access is (still) denied after retrying, e.g. the owner deleted the schedule. */
export const watchProfile = (pid: string, cb: (p: Profile | null) => void, onError?: () => void) => resilient((retry) =>
  onSnapshot(userRef(pid), (s) => cb(s.exists() ? (s.data() as Profile) : null), retry), onError);

export const watchSubscriberCount = (pid: string, cb: (n: number) => void) => resilient((onError) =>
  onSnapshot(collection(db, "users", pid, "subscribers"), (s) => cb(s.size), onError));

export const fetchHasPassword = async (pid: string) => (await getDoc(authRef(pid))).exists();

export async function setPassword(pid: string, password: string) {
  await setDoc(authRef(pid), { key: await accessKey(pid, password) });
}

/** Language for this account's push notifications (read by the worker). */
export const setAccountLang = (uid: string, lang: Lang) => updateDoc(accountRef(uid), { lang });

export async function saveSchedule(uid: string, pid: string, input: ScheduleInput, previous: Profile | null) {
  const prev = hasSchedule(previous) ? previous : null;
  const tz = deviceTz();
  const today = dayKey(Date.now(), tz);
  const takenDays = { ...prev?.takenDays };
  if (input.takenTodayAt !== null) takenDays[today] = input.takenTodayAt;
  else delete takenDays[today];
  const packStart = addDays(today, -input.todayIndex);
  const plan: Plan = {
    pillsPerPack: input.pillsPerPack,
    placebo: input.placebo,
    breakDays: input.breakDays,
    packStart,
    // A correction of today's position drops early starts it overrides; earlier ones keep past days in place.
    earlierPackStarts: (prev?.earlierPackStarts ?? []).filter((a) => a < packStart),
    supplyPacks: prev?.supplyPacks ?? 0,
    supplyFrom: prev?.supplyFrom ?? packStart,
    appointmentDay: prev?.appointmentDay ?? null,
    trackingSince: prev?.trackingSince ?? today, // pills before the first setup count as taken
    time: input.time,
    tz,
    repeatMinutes: input.repeatMinutes,
    lateMinutes: input.lateMinutes,
    takenDays,
  };
  const schedule: Schedule = {
    ...plan,
    ...notificationTimes(plan),
    ownerUid: uid,
    name: input.name.trim(),
    appointmentNote: prev?.appointmentNote ?? "",
    reminderText: input.reminderText.trim(),
    // Keep a pending "taken" notification; a fresh "taken today" from the wizard also notifies followers.
    takenPending: (prev?.takenPending ?? false) || (input.takenTodayAt !== null && !(today in (prev?.takenDays ?? {}))),
  };
  await setDoc(userRef(pid), schedule);
}

/**
 * Marks the pill of `day` as taken at `time` ("HH:MM", or "" when unknown), or unmarks it (null).
 * Marking today's pill notifies followers. The UI never offers future days or times.
 */
export function setTaken(pid: string, s: Schedule, day: string, time: string | null) {
  const isToday = day === todayOf(s);
  const taken = time !== null;
  const takenDays = { ...s.takenDays };
  if (taken) takenDays[day] = time;
  else delete takenDays[day];
  return updateDoc(userRef(pid), {
    [`takenDays.${day}`]: taken ? time : deleteField(),
    takenPending: taken && isToday ? true : s.takenPending && !(isToday && !taken),
    ...notificationTimes({ ...s, takenDays }),
  });
}

/**
 * Subscriber doc + the account's list in one atomic batch, so a subscription can never be half done.
 * Throws if the ID/password combination is wrong (the security rules reject the whole batch).
 */
export async function subscribe(uid: string, pid: string, password: string) {
  const batch = writeBatch(db);
  batch.set(subscriberRef(pid, uid), { key: await accessKey(pid, password) });
  batch.update(accountRef(uid), { subs: arrayUnion(pid) });
  try {
    await batch.commit();
  } catch {
    throw new Error(strings().invalidCredentials);
  }
}

export function unsubscribe(uid: string, pid: string) {
  const batch = writeBatch(db);
  batch.delete(subscriberRef(pid, uid));
  batch.update(accountRef(uid), { subs: arrayRemove(pid) });
  return batch.commit();
}

export async function registerToken(uid: string, account: Account, token: string) {
  if (account.tokens[0] === token) return;
  await updateDoc(accountRef(uid), { tokens: [token, ...account.tokens.filter((t) => t !== token)].slice(0, 5) });
}

export const removeToken = (uid: string, token: string) => updateDoc(accountRef(uid), { tokens: arrayRemove(token) });

/** Deletes everything the account owns in one batch: own schedule with its followers and password, follows, the account. */
export async function deleteAccountData(uid: string, account: Account) {
  const followers = await getDocs(collection(db, "users", account.pid, "subscribers"));
  const batch = writeBatch(db);
  followers.forEach((d) => batch.delete(d.ref));
  account.subs.forEach((pid) => batch.delete(subscriberRef(pid, uid)));
  batch.delete(authRef(account.pid));
  batch.delete(notesRef(account.pid, "shared"));
  batch.delete(notesRef(account.pid, "private"));
  batch.delete(userRef(account.pid));
  batch.delete(accountRef(uid));
  await batch.commit();
}

/** Writes plan changes together with the recomputed notification moments. */
const updatePlan = (pid: string, s: Schedule, changes: Partial<Schedule>) =>
  updateDoc(userRef(pid), { ...changes, ...notificationTimes({ ...s, ...changes }) });

/** Starts the next pack on `day` (today or tomorrow) instead of after the regular cycle, e.g. to delay a period. */
export const startPackEarly = (pid: string, s: Schedule, day: string) =>
  updatePlan(pid, s, { packStart: day, earlierPackStarts: [...(s.earlierPackStarts ?? []), s.packStart].slice(-100) });

/** `unopened` packs at home besides the current one (0 = stop tracking). */
export const setSupply = (pid: string, s: Schedule, unopened: number | null) =>
  updatePlan(pid, s, unopened === null
    ? { supplyPacks: 0 }
    : { supplyPacks: unopened + 1, supplyFrom: slot(s, todayOf(s)).packStart });

export const setAppointment = (pid: string, s: Schedule, day: string | null, note: string) =>
  updatePlan(pid, s, { appointmentDay: day, appointmentNote: note.trim() });

/** Reminders follow `tz` from now on (e.g. after moving or for a longer trip); the clock time stays. */
export const setTimezone = (pid: string, s: Schedule, tz: string) => updatePlan(pid, s, { tz });

// ---------- Daily notes ----------

const notesRef = (pid: string, which: "shared" | "private") => doc(db, "users", pid, "notes", which);

export const watchNotes = (pid: string, which: "shared" | "private", cb: (n: Notes) => void, onError?: () => void) => resilient((retry) =>
  onSnapshot(notesRef(pid, which), (snap) => cb((snap.data()?.days ?? {}) as Notes), retry), onError);

/**
 * Saves the note of `day` in the shared or private doc, or deletes it (note null). `wasShared` says where the
 * note lives now (null = nowhere); a note that switches between shared and private is removed from its old doc
 * in the same batch. (Only touch a doc that has the note: a merge write that only deletes would create a doc
 * without `days`, which the rules reject.)
 */
export function setNote(pid: string, day: string, note: Note | null, shared: boolean, wasShared: boolean | null) {
  const batch = writeBatch(db);
  const where = (isShared: boolean) => notesRef(pid, isShared ? "shared" : "private");
  if (note) batch.set(where(shared), { days: { [day]: note } }, { merge: true });
  if (wasShared !== null && (note === null || wasShared !== shared)) batch.update(where(wasShared), { [`days.${day}`]: deleteField() });
  return batch.commit();
}
