import * as Crypto from "expo-crypto";
import {
  arrayRemove, arrayUnion, collection, doc, getDoc, getDocs, onSnapshot, setDoc, Timestamp, updateDoc, writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import { strings, type Lang } from "./i18n";

export type Account = { pid: string; subs: string[]; tokens: string[]; lang?: Lang };
export type Schedule = {
  ownerUid: string;
  name: string;
  pillsPerPack: number;
  taken: number;
  time: string; // "HH:MM", local to tz
  tz: string;
  lastTakenDay: string | null; // "YYYY-MM-DD" in tz
  nextReminderAt: Timestamp | null;
  takenPending: boolean;
};
export type Profile = { ownerUid: string } & Partial<Schedule>;
type ScheduleInput = { name: string; pillsPerPack: number; taken: number; time: string };

// No 0/O, 1/I/L: IDs get read out loud and typed on phones.
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newPersonalId = () => Array.from(Crypto.getRandomBytes(6), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
export const normalizeId = (id: string) => id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const accessKey = (pid: string, password: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${pid}:${password}`);

export const hasSchedule = (p: Profile | null | undefined): p is Schedule => typeof p?.pillsPerPack === "number";

/** "YYYY-MM-DD" in tz, built from parts so it matches the worker regardless of locale formatting. */
export function dayKey(date: Date, tz?: string) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export const takenToday = (s: Schedule) => s.lastTakenDay === dayKey(new Date(), s.tz);
export const packFinished = (s: Schedule) => s.taken >= s.pillsPerPack;

/** Next local occurrence of "HH:MM"; skips today when today's pill is already handled. */
function nextReminder(time: string, skipToday: boolean) {
  const [h, m] = time.split(":").map(Number);
  const now = new Date();
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (skipToday || at <= now) at.setDate(at.getDate() + 1);
  return Timestamp.fromDate(at);
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
function resilient(listen: (onError: () => void) => Unsubscribe, onError?: () => void): Unsubscribe {
  let unsub: Unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let stopped = false;
  const start = () => {
    unsub = listen(() => {
      if (stopped) return;
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
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const prev = hasSchedule(previous) ? previous : null;
  const lastTakenDay = prev?.lastTakenDay ?? null;
  const schedule: Schedule = {
    ownerUid: uid,
    name: input.name.trim(),
    pillsPerPack: input.pillsPerPack,
    taken: input.taken,
    time: input.time,
    tz,
    lastTakenDay,
    nextReminderAt: input.taken >= input.pillsPerPack ? null : nextReminder(input.time, lastTakenDay === dayKey(new Date(), tz)),
    takenPending: prev?.takenPending ?? false, // don't swallow a "taken" notification the worker hasn't sent yet
  };
  await setDoc(userRef(pid), schedule);
}

export function markTaken(pid: string, s: Schedule) {
  const taken = Math.min(s.taken + 1, s.pillsPerPack);
  return updateDoc(userRef(pid), {
    taken,
    lastTakenDay: dayKey(new Date(), s.tz),
    takenPending: true, // the worker notifies subscribers and clears this
    nextReminderAt: taken >= s.pillsPerPack ? null : nextReminder(s.time, true),
  });
}

export const startNewPack = (pid: string, s: Schedule) =>
  updateDoc(userRef(pid), { taken: 0, nextReminderAt: nextReminder(s.time, takenToday(s)) });

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
  batch.delete(userRef(account.pid));
  batch.delete(accountRef(uid));
  await batch.commit();
}
