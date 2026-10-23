import * as Crypto from "expo-crypto";
import {
  arrayRemove, arrayUnion, collection, deleteField, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, Timestamp, updateDoc, writeBatch,
  type DocumentData, type Unsubscribe,
} from "firebase/firestore";
import { addDays, dayKey, methodOf, nextLateAt, nextNoticeAt, nextReminderAt, slot, trackFromPackStart, withAction, type Method, type Plan } from "../shared/schedule";
import { accessKeyFor, decrypt, encrypt, isEncrypted, type Key } from "./crypto";
import { db } from "./firebase";
import {
  addFollowedShareKey, currentDataKey, ensureOwnShareKey, removeFollowedShareKey, unwrapShareKeyWithPassword, wrapShareKeyForPassword,
  type Keyring,
} from "./keys";
import { strings, type Lang } from "./i18n";

export type Account = { pid: string; subs: string[]; tokens: string[]; lang?: Lang; keyring?: Keyring };
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
  /** The schedule's share key, wrapped with the sharing password (followers unwrap it once). */
  shareKeyWrap?: string;
  /** The owner's username (see usernames below) and its document key; may exist before the first schedule. */
  username?: string;
  usernameKey?: string;
};
export const REMINDER_TEXT_MAX = 64;
export const textLength = (text: string) => [...text].length; // code points, so an emoji counts once

export const MOODS = ["😄", "🙂", "😐", "😕", "😣"] as const;
export type Note = { text: string; mood: string | null; /** Encrypted with a key this device doesn't have. */ locked?: boolean };
export type Notes = Record<string, Note>;
/** As stored: encrypted ({enc}) or, from before encryption, plain. */
type StoredNote = { enc: string } | Note;
export type StoredNotes = Record<string, StoredNote>;
export type Profile = { ownerUid: string } & Partial<Schedule>;
export type ScheduleInput = Pick<Schedule, "name" | "pillsPerPack" | "placebo" | "breakDays" | "time" | "repeatMinutes" | "lateMinutes"> & {
  method: Method;
  reminderText: string;
  /** Position of today's day in the cycle (pill index, or a break day after the pills). */
  todayIndex: number;
  /** Start of the current cycle instead of `todayIndex` (the injection: day of the last one). */
  start?: string;
  /** "HH:MM" today's pill / patch / ring action was done, or null if not yet. */
  takenTodayAt: string | null;
};

// No 0/O, 1/I/L: IDs get read out loud and typed on phones.
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newPersonalId = () => Array.from(Crypto.getRandomBytes(6), (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");

/** Access key from before encryption (fast SHA-256); only tried when an owner hasn't upgraded yet. */
const legacyAccessKey = (pid: string, password: string) =>
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

// ---------- "Seen" confirmations ----------
// A follower confirms they've seen that a day's pill was taken (like a read receipt):
// users/{pid}/seen/{followerUid} = { day, at, name? }, written by the follower, read by the owner.

export type Seen = { day: string; at: number; name: string | null };
const seenRef = (pid: string, uid: string) => doc(db, "users", pid, "seen", uid);
const toSeen = (d: DocumentData): Seen => ({ day: d.day, at: (d.at as Timestamp | null)?.toMillis() ?? Date.now(), name: d.name ?? null });

/** The followers' confirmations for the owner's schedule. */
export const watchSeen = (pid: string, cb: (seen: Seen[]) => void) => resilient((onError) =>
  onSnapshot(collection(db, "users", pid, "seen"), (s) => cb(s.docs.map((d) => toSeen(d.data({ serverTimestamps: "estimate" })))), onError));

/** This follower's own confirmation for a followed schedule. */
export const watchOwnSeen = (pid: string, uid: string, cb: (seen: Seen | null) => void) => resilient((onError) =>
  onSnapshot(seenRef(pid, uid), (d) => cb(d.exists() ? toSeen(d.data({ serverTimestamps: "estimate" })) : null), onError));

/** `name`: the follower's own schedule name, if they have one (the owner sees "Seen by …"). */
export const markSeen = (uid: string, pid: string, day: string, name?: string) =>
  setDoc(seenRef(pid, uid), { day, at: serverTimestamp(), ...(name ? { name: name.slice(0, 30) } : {}) });

/** Opens a value encrypted with `key`; plain values from before encryption pass through, unreadable ones give null. */
function open<T>(value: unknown, key: Key | null): T | null {
  if (!isEncrypted(value)) return (value as T) ?? null;
  if (!key) return null;
  try { return decrypt<T>(key, value); } catch { return null; }
}

/** Whether a sharing password is set, and the password itself if stored (encrypted with the data key). */
export type Sharing = { set: boolean; password: string | null };
export async function fetchSharing(pid: string): Promise<Sharing> {
  const snap = await getDoc(authRef(pid));
  return { set: snap.exists(), password: open<string>(snap.data()?.password, currentDataKey()) };
}

/**
 * Prepares the sharing password: the slow access key followers must present, the password encrypted for the
 * owner, and the schedule's share key wrapped with it (users/{pid}.shareKeyWrap) so new followers can read the
 * shared notes. Existing followers already hold the share key, so they keep reading.
 * The key derivation takes a moment (seconds on a phone), so this resolves once it is done, with the write to
 * run next: not awaited by the caller, so it also works offline.
 */
export async function prepareSharingPassword(uid: string, pid: string, password: string) {
  const shareKey = await ensureOwnShareKey(uid);
  const access = { key: await accessKeyFor(pid, password), password: encrypt(currentDataKey()!, password) };
  const shareKeyWrap = await wrapShareKeyForPassword(shareKey, password);
  return () => {
    const batch = writeBatch(db);
    batch.set(authRef(pid), access);
    batch.update(userRef(pid), { shareKeyWrap });
    return batch.commit();
  };
}

export const renameSchedule = (pid: string, name: string) => updateDoc(userRef(pid), { name: name.trim() });

/** Language for this account's push notifications (read by the worker). */
export const setAccountLang = (uid: string, lang: Lang) => updateDoc(accountRef(uid), { lang });

export async function saveSchedule(uid: string, pid: string, input: ScheduleInput, previous: Profile | null) {
  const prev = hasSchedule(previous) ? previous : null;
  const tz = deviceTz();
  const today = dayKey(Date.now(), tz);
  // Another method starts fresh: its days before today count as done, and the old pack starts don't apply.
  const sameMethod = !!prev && methodOf(prev) === input.method;
  const takenDays: Record<string, string> = {};
  for (const [day, v] of Object.entries(prev?.takenDays ?? {})) {
    // Another method's marks from today on (or done today) would count as this method's actions; older ones are history.
    if (sameMethod || (day < today && !(v.length > 5 && v.slice(0, 10) >= today))) takenDays[day] = v;
  }
  if (input.takenTodayAt !== null) takenDays[today] = input.takenTodayAt;
  else if (input.start !== today) delete takenDays[today];
  const packStart = input.start ?? addDays(today, -input.todayIndex);
  // Days before the setup count as done, except after the last injection: an injection due since then is still open.
  const tracking = (sameMethod && prev?.trackingSince) || today;
  const trackingSince = input.start && input.start < tracking ? input.start : tracking;
  // The last injection (given as the cycle start) was done; its time isn't known unless it was recorded before.
  if (input.start && (!sameMethod || !(input.start in takenDays))) takenDays[input.start] = "";
  const plan: Plan = {
    method: input.method,
    pillsPerPack: input.pillsPerPack,
    placebo: input.placebo,
    breakDays: input.breakDays,
    packStart,
    // A correction of today's position drops early starts it overrides; earlier ones keep past days in place.
    earlierPackStarts: sameMethod ? (prev?.earlierPackStarts ?? []).filter((a) => a < packStart) : [],
    supplyPacks: prev?.supplyPacks ?? 0,
    supplyFrom: prev?.supplyFrom ?? packStart,
    appointmentDay: prev?.appointmentDay ?? null,
    trackingSince,
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
    // The doc is rewritten in full: keep the share-key wrap and the username (both may exist before the first schedule).
    ...(previous?.shareKeyWrap ? { shareKeyWrap: previous.shareKeyWrap } : {}),
    ...(previous?.username ? { username: previous.username } : {}),
    ...(previous?.usernameKey ? { usernameKey: previous.usernameKey } : {}),
    // Keep a pending "taken" notification; a fresh "taken today" from the wizard also notifies followers.
    takenPending: (prev?.takenPending ?? false) || (input.takenTodayAt !== null && !(today in (prev?.takenDays ?? {}))),
  };
  await setDoc(userRef(pid), schedule);
}

/**
 * Marks the pill of `day` as taken at `time` ("HH:MM", or "" when unknown), or unmarks it (null).
 * Marking today's pill notifies followers. The UI never offers future days or times.
 * A day from before the setup (the pills the setup declared taken) first turns those pills into real
 * marks, so it can be changed like any other day.
 */
export function setTaken(pid: string, s: Schedule, day: string, time: string | null) {
  const isToday = day === todayOf(s);
  const taken = time !== null;
  const tracked = day < s.trackingSince ? trackFromPackStart(s) : s; // only a pre-setup day needs the conversion
  const takenDays = { ...tracked.takenDays };
  if (taken) takenDays[day] = time;
  else delete takenDays[day];
  const newMarks = Object.keys(tracked.takenDays).filter((d) => !(d in s.takenDays) && d !== day);
  return updateDoc(userRef(pid), {
    ...(tracked !== s ? { trackingSince: tracked.trackingSince } : {}),
    ...Object.fromEntries(newMarks.map((d) => [`takenDays.${d}`, ""])),
    [`takenDays.${day}`]: taken ? time : deleteField(),
    takenPending: taken && isToday ? true : s.takenPending && !(isToday && !taken),
    ...notificationTimes({ ...tracked, takenDays }),
  });
}

/**
 * Records the patch / ring / injection action scheduled for `scheduled` as done (see withAction in shared/schedule.ts),
 * or undoes it (null), writing only what changed. Done today notifies followers. Pills use setTaken.
 */
export function recordAction(pid: string, s: Schedule, scheduled: string, done: { day: string; time: string } | null) {
  const plan = withAction(s, scheduled, done);
  const updates: Record<string, unknown> = {};
  for (const day of new Set([...Object.keys(s.takenDays), ...Object.keys(plan.takenDays)])) {
    if (s.takenDays[day] !== plan.takenDays[day]) updates[`takenDays.${day}`] = plan.takenDays[day] ?? deleteField();
  }
  if (plan.packStart !== s.packStart) Object.assign(updates, { packStart: plan.packStart, earlierPackStarts: plan.earlierPackStarts ?? [] });
  const doneToday = done !== null && done.day === todayOf(s);
  return updateDoc(userRef(pid), { ...updates, takenPending: doneToday || (s.takenPending && done !== null), ...notificationTimes(plan) });
}

/**
 * Subscriber doc + the account's list in one atomic batch, so a subscription can never be half done.
 * Throws if the ID/password combination is wrong (the security rules reject the whole batch).
 */
// ---------- Usernames ----------
// The personal ID (pid) stays the internal key: schedule doc, follows, access keys, share keys. On top of it every
// account has a unique username it can change: usernames/{usernameKey(name)} = { pid, ownerUid, username }, and the
// profile carries users/{pid}.username for display. Accounts from before usernames claim their personal ID as username.

export const USERNAME_MIN = 2;
export const USERNAME_MAX = 24;
// ASCII 33–126 (no spaces), accented Latin (Latin-1, Extended-A/B, Extended Additional), Greek, Cyrillic, Hiragana, Katakana.
// The same character class is in firestore.rules.
const USERNAME_RE = /^[!-~\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0370-\u03FF\u0400-\u052F\u1E00-\u1EFF\u3040-\u30FF]{2,24}$/u;
/** As typed, without surrounding spaces, and with composed characters ("o" + "¨" → "ö"). */
export const cleanUsername = (input: string) => input.trim().normalize("NFC");
/** 2 to 24 allowed characters; "__…__" and dot-only names are reserved by Firestore. */
export const validUsername = (name: string) => USERNAME_RE.test(name) && !/^__.*__$/.test(name) && !/^\.+$/.test(name);
/**
 * Document ID of a username: case-insensitive, with "%" and "/" (not allowed in IDs) escaped. Lowercased letter by
 * letter (no context rules like the Greek final sigma), the same way as lower() in firestore.rules.
 */
export const usernameKey = (name: string) => [...name].map((c) => { const l = c.toLowerCase(); return [...l].length === 1 ? l : c; }).join("")
  .replace(/%/g, "%25").replace(/\//g, "%2F");
const usernameRef = (name: string) => doc(db, "usernames", usernameKey(name));

/** The personal ID behind a username (or a personal ID typed directly, from before usernames), or null. */
export async function resolveUsername(input: string): Promise<string | null> {
  const name = cleanUsername(input);
  if (validUsername(name)) {
    const snap = await getDoc(usernameRef(name));
    if (snap.exists()) return snap.data().pid as string;
  }
  const legacy = name.toUpperCase();
  return /^[A-HJKMNP-Z2-9]{6}$/.test(legacy) ? legacy : null;
}

/** Whether `name` is free (or already this account's). */
export async function usernameAvailable(name: string, pid: string) {
  const snap = await getDoc(usernameRef(name));
  return !snap.exists() || snap.data().pid === pid;
}

/** Claims `name` for the own profile and frees the previous one, in one batch (the rules reject a taken name). */
export async function setUsername(uid: string, pid: string, name: string, previous?: string) {
  const batch = writeBatch(db);
  if (previous && usernameKey(previous) !== usernameKey(name)) batch.delete(usernameRef(previous));
  batch.set(usernameRef(name), { pid, ownerUid: uid, username: name });
  batch.update(userRef(pid), { username: name, usernameKey: usernameKey(name) });
  await batch.commit();
}

/** Accounts from before usernames (or just created): claim the personal ID as username, or a variant if it's taken. */
export async function ensureUsername(uid: string, pid: string, profile: Profile) {
  if (profile.username) return;
  for (const name of [pid, `${pid}_${newPersonalId().slice(0, 3)}`, `${pid}_${newPersonalId().slice(0, 3)}`]) {
    try { return await setUsername(uid, pid, name); } catch { /* taken: try the next one */ }
  }
}

export async function subscribe(uid: string, pid: string, password: string) {
  const follow = async (key: string) => {
    const batch = writeBatch(db);
    batch.set(subscriberRef(pid, uid), { key });
    batch.update(accountRef(uid), { subs: arrayUnion(pid) });
    await batch.commit();
  };
  try {
    await follow(await accessKeyFor(pid, password));
  } catch {
    // The owner may not have opened the new version yet (their key is still the old format).
    try { await follow(await legacyAccessKey(pid, password)); } catch { throw new Error(strings().invalidCredentials); }
  }
  await unlockFollowedNotes(uid, pid, password).catch(() => undefined); // not possible until the owner has upgraded
}

/** Picks up a followed schedule's share key with its sharing password (throws if wrong or not available yet). */
export async function unlockFollowedNotes(uid: string, pid: string, password: string) {
  const wrap = (await getDoc(userRef(pid))).data()?.shareKeyWrap as string | undefined;
  if (!wrap) throw new Error(strings().notesNotReady);
  let key: Key;
  try { key = await unwrapShareKeyWithPassword(wrap, password); } catch { throw new Error(strings().invalidSharingPassword); }
  await addFollowedShareKey(uid, pid, key);
}

export async function unsubscribe(uid: string, pid: string) {
  const batch = writeBatch(db);
  batch.delete(subscriberRef(pid, uid));
  batch.delete(seenRef(pid, uid));
  batch.update(accountRef(uid), { subs: arrayRemove(pid) });
  await batch.commit();
  await removeFollowedShareKey(uid, pid);
}

export async function registerToken(uid: string, account: Account, token: string) {
  if (account.tokens[0] === token) return;
  await updateDoc(accountRef(uid), { tokens: [token, ...account.tokens.filter((t) => t !== token)].slice(0, 5) });
}

export const removeToken = (uid: string, token: string) => updateDoc(accountRef(uid), { tokens: arrayRemove(token) });

/** Deletes everything the account owns in one batch: own schedule with its followers and password, follows, the account. */
export async function deleteAccountData(uid: string, account: Account) {
  const [followers, seen] = await Promise.all(["subscribers", "seen"].map((c) => getDocs(collection(db, "users", account.pid, c))));
  const username = (await getDoc(userRef(account.pid))).data()?.username as string | undefined;
  const batch = writeBatch(db);
  if (username) batch.delete(usernameRef(username));
  followers.forEach((d) => batch.delete(d.ref));
  seen.forEach((d) => batch.delete(d.ref));
  account.subs.forEach((pid) => { batch.delete(subscriberRef(pid, uid)); batch.delete(seenRef(pid, uid)); });
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

/** The note is encrypted (only the owner can read it; the reminder push stays generic). */
export const setAppointment = (pid: string, s: Schedule, day: string | null, note: string) =>
  updatePlan(pid, s, { appointmentDay: day, appointmentNote: note.trim() ? encrypt(currentDataKey()!, note.trim()) : "" });

/** The appointment note, decrypted (null if this device can't open it). */
export const appointmentNoteOf = (s: Schedule) => (s.appointmentNote ? open<string>(s.appointmentNote, currentDataKey()) : "");

/** Reminders follow `tz` from now on (e.g. after moving or for a longer trip); the clock time stays. */
export const setTimezone = (pid: string, s: Schedule, tz: string) => updatePlan(pid, s, { tz });

// ---------- Daily notes ----------

const notesRef = (pid: string, which: "shared" | "private") => doc(db, "users", pid, "notes", which);

export const watchNotes = (pid: string, which: "shared" | "private", cb: (n: StoredNotes) => void, onError?: () => void) => resilient((retry) =>
  onSnapshot(notesRef(pid, which), (snap) => cb((snap.data()?.days ?? {}) as StoredNotes), retry), onError);

/** Decrypts stored notes; entries this key can't open come back as `locked`. */
export function openNotes(stored: StoredNotes, key: Key | null): Notes {
  const out: Notes = {};
  for (const [day, value] of Object.entries(stored)) {
    const note = "enc" in value ? open<Note>(value.enc, key) : value;
    out[day] = note ?? { text: "", mood: null, locked: true };
  }
  return out;
}

/**
 * Saves the note of `day` in the shared or private doc, or deletes it (note null). `wasShared` says where the
 * note lives now (null = nowhere); a note that switches between shared and private is removed from its old doc
 * in the same batch. (Only touch a doc that has the note: a merge write that only deletes would create a doc
 * without `days`, which the rules reject.)
 */
export async function setNote(uid: string, pid: string, day: string, note: Note | null, shared: boolean, wasShared: boolean | null) {
  const batch = writeBatch(db);
  const where = (isShared: boolean) => notesRef(pid, isShared ? "shared" : "private");
  if (note) {
    // Shared notes: the schedule's share key (followers have it); private: the owner's data key.
    const key = shared ? await ensureOwnShareKey(uid) : currentDataKey()!;
    batch.set(where(shared), { days: { [day]: { enc: encrypt(key, { text: note.text, mood: note.mood }) } } }, { merge: true });
  }
  if (wasShared !== null && (note === null || wasShared !== shared)) batch.update(where(wasShared), { [`days.${day}`]: deleteField() });
  await batch.commit();
}

// ---------- One-time upgrade to encryption ----------

/**
 * Encrypts what was stored in plain text before encryption existed: notes, the appointment note and the
 * stored sharing password (which also gets the slow access key and the share-key wrap for followers).
 * Idempotent; runs after every unlock and does nothing once everything is encrypted.
 * A sharing password that was only stored as a hash can't be upgraded (the owner has to set it again).
 */
export async function migrateToEncryption(uid: string, pid: string, schedule: Schedule | null) {
  const dataKey = currentDataKey()!;
  const batch = writeBatch(db);
  let writes = 0;

  const password = (await getDoc(authRef(pid))).data()?.password as string | undefined;
  if (password !== undefined && !isEncrypted(password)) {
    const shareKey = await ensureOwnShareKey(uid);
    batch.set(authRef(pid), { key: await accessKeyFor(pid, password), password: encrypt(dataKey, password) });
    batch.update(userRef(pid), { shareKeyWrap: await wrapShareKeyForPassword(shareKey, password) });
    writes += 2;
  }

  for (const which of ["private", "shared"] as const) {
    const days = ((await getDoc(notesRef(pid, which))).data()?.days ?? {}) as StoredNotes;
    const plain = Object.entries(days).filter(([, v]) => !("enc" in v));
    if (!plain.length) continue;
    const key = which === "shared" ? await ensureOwnShareKey(uid) : dataKey;
    const updated = { ...days };
    for (const [day, note] of plain) updated[day] = { enc: encrypt(key, { text: (note as Note).text, mood: (note as Note).mood }) };
    batch.set(notesRef(pid, which), { days: updated });
    writes++;
  }

  if (schedule?.appointmentNote && !isEncrypted(schedule.appointmentNote)) {
    batch.update(userRef(pid), { appointmentNote: encrypt(dataKey, schedule.appointmentNote) });
    writes++;
  }

  if (writes) await batch.commit();
}
