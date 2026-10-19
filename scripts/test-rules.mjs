// Live security-rules test against the real Firebase project.
// Creates throwaway email users (…@example.com), exercises every rule, then deletes everything it made.
// Usage: node --env-file=.env scripts/test-rules.mjs
import { createHash } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, deleteUser, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, deleteField, collection, getDocs, Timestamp, terminate, writeBatch } from "firebase/firestore";

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};
const key = (pid, pw) => createHash("sha256").update(`${pid}:${pw}`).digest("hex");
const randomPid = () => Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

const testEmail = () => `bb-rules-test-${Math.random().toString(36).slice(2, 10)}@example.com`;
async function client(name) {
  const app = initializeApp(config, name);
  const auth = getAuth(app);
  const { user } = await createUserWithEmailAndPassword(auth, testEmail(), "testpass123");
  return { app, auth, user, db: getFirestore(app) };
}

let failures = 0;
async function expect(label, shouldSucceed, fn) {
  let ok = true, err = "";
  try { await fn(); } catch (e) { ok = false; err = e.code ?? e.message; }
  const pass = ok === shouldSucceed;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass ? `  (got ${ok ? "success" : err})` : ""}`);
}

const alice = await client("alice");
const bob = await client("bob");
const A = randomPid(), B = randomPid();
const schedule = {
  ownerUid: alice.user.uid, name: "Test", pillsPerPack: 21, placebo: 0, breakDays: 7, packStart: "2026-10-15",
  trackingSince: "2026-10-15", time: "20:00", tz: "Europe/Berlin", repeatMinutes: 30, lateMinutes: 60,
  takenDays: { "2026-10-15": "20:01" }, nextReminderAt: Timestamp.fromMillis(Date.now() + 864e5), nextLateAt: null, takenPending: false,
};

try {
  await expect("alice claims a personal ID", true, () => setDoc(doc(alice.db, "users", A), { ownerUid: alice.user.uid }));
  await expect("alice creates her account", true, () => setDoc(doc(alice.db, "accounts", alice.user.uid), { pid: A, subs: [], tokens: [] }));
  await expect("bob cannot steal alice's ID", false, () => setDoc(doc(bob.db, "users", A), { ownerUid: bob.user.uid }));
  await expect("bob cannot claim an ID with invalid characters", false, () => setDoc(doc(bob.db, "users", "AAAA0O"), { ownerUid: bob.user.uid }));
  await expect("bob claims his own ID", true, () => setDoc(doc(bob.db, "users", B), { ownerUid: bob.user.uid }));
  await expect("bob creates his account", true, () => setDoc(doc(bob.db, "accounts", bob.user.uid), { pid: B, subs: [], tokens: [] }));
  await expect("bob sets his notification language", true, () => updateDoc(doc(bob.db, "accounts", bob.user.uid), { lang: "de" }));
  await expect("bob cannot set an unknown language", false, () => updateDoc(doc(bob.db, "accounts", bob.user.uid), { lang: "xx" }));
  await expect("bob cannot read alice's account", false, () => getDoc(doc(bob.db, "accounts", alice.user.uid)));
  await expect("alice saves a valid schedule", true, () => setDoc(doc(alice.db, "users", A), schedule));
  await expect("alice cannot have more placebo pills than pills", false, () => updateDoc(doc(alice.db, "users", A), { placebo: 21 }));
  await expect("alice cannot use an unsupported repeat interval", false, () => updateDoc(doc(alice.db, "users", A), { repeatMinutes: 5 }));
  await expect("alice cannot save a malformed pack start", false, () => updateDoc(doc(alice.db, "users", A), { packStart: "15.10.2026" }));
  await expect("alice switches to 24 + 4 placebo with 2 h follower alert", true, () => updateDoc(doc(alice.db, "users", A), { pillsPerPack: 28, placebo: 4, breakDays: 0, lateMinutes: 120 }));
  await expect("alice cannot save a bad time", false, () => updateDoc(doc(alice.db, "users", A), { time: "25:00" }));
  await expect("alice cannot add unknown fields", false, () => updateDoc(doc(alice.db, "users", A), { evil: true }));
  await expect("alice saves supply, appointment, early start and reminder text", true, () => updateDoc(doc(alice.db, "users", A), {
    supplyPacks: 3, supplyFrom: "2026-10-15", appointmentDay: "2026-11-03", appointmentNote: "Dr. Weber 9:30",
    earlierPackStarts: ["2026-09-17"], reminderText: "🌸 Little reminder ✨", nextNoticeAt: Timestamp.fromMillis(Date.now() + 864e5),
  }));
  await expect("alice cannot track more than 24 packs", false, () => updateDoc(doc(alice.db, "users", A), { supplyPacks: 30 }));
  await expect("alice cannot save an overlong reminder text", false, () => updateDoc(doc(alice.db, "users", A), { reminderText: "x".repeat(300) }));
  await expect("alice writes a shared note", true, () => setDoc(doc(alice.db, "users", A, "notes", "shared"), { days: { "2026-10-19": { text: "fine", mood: "🙂" } } }));
  await expect("alice writes a private note", true, () => setDoc(doc(alice.db, "users", A, "notes", "private"), { days: { "2026-10-18": { text: "cramps", mood: "😣" } } }));
  await expect("bob cannot read alice's shared notes before following", false, () => getDoc(doc(bob.db, "users", A, "notes", "shared")));
  await expect("alice marks a pill taken", true, () => updateDoc(doc(alice.db, "users", A), { "takenDays.2026-10-19": "20:41", takenPending: true }));
  await expect("alice corrects (unmarks) an earlier day", true, () => updateDoc(doc(alice.db, "users", A), { "takenDays.2026-10-15": deleteField() }));
  await expect("bob cannot read alice's schedule before subscribing", false, () => getDoc(doc(bob.db, "users", A)));
  await expect("bob cannot subscribe before a password is set", false, () => setDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid), { key: key(A, "secret1") }));
  await expect("alice sets her password", true, () => setDoc(doc(alice.db, "users", A, "private", "auth"), { key: key(A, "secret1") }));
  await expect("bob cannot read alice's password hash", false, () => getDoc(doc(bob.db, "users", A, "private", "auth")));
  await expect("bob cannot subscribe with the wrong password", false, () => setDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid), { key: key(A, "wrong!!") }));
  await expect("bob cannot subscribe someone else", false, () => setDoc(doc(bob.db, "users", A, "subscribers", "someone-else"), { key: key(A, "secret1") }));
  await expect("bob subscribes with ID + password", true, () => setDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid), { key: key(A, "secret1") }));
  await expect("bob can now read alice's schedule", true, async () => {
    const s = await getDoc(doc(bob.db, "users", A));
    if (s.data().takenDays["2026-10-19"] !== "20:41") throw new Error("unexpected data");
  });
  await expect("bob (follower) reads alice's shared notes", true, async () => {
    const n = await getDoc(doc(bob.db, "users", A, "notes", "shared"));
    if (n.data().days["2026-10-19"].text !== "fine") throw new Error("unexpected");
  });
  await expect("bob cannot read alice's private notes", false, () => getDoc(doc(bob.db, "users", A, "notes", "private")));
  await expect("bob cannot write alice's notes", false, () => setDoc(doc(bob.db, "users", A, "notes", "shared"), { days: {} }));
  await expect("bob cannot modify alice's schedule", false, () => updateDoc(doc(bob.db, "users", A), { "takenDays.2026-10-20": "08:00" }));
  await expect("bob cannot list alice's subscribers", false, () => getDocs(collection(bob.db, "users", A, "subscribers")));
  await expect("alice can list her subscribers", true, () => getDocs(collection(alice.db, "users", A, "subscribers")));
  await expect("alice cannot subscribe to herself", false, async () => {
    await setDoc(doc(bob.db, "users", B, "private", "auth"), { key: key(B, "pw1234") }).catch(() => {});
    await setDoc(doc(alice.db, "users", A, "subscribers", alice.user.uid), { key: key(A, "secret1") });
  });
  await expect("bob unsubscribes", true, () => deleteDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid)));
  await expect("bob loses access after unsubscribing", false, () => getDoc(doc(bob.db, "users", A)));
  await expect("bob re-follows alice", true, () => setDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid), { key: key(A, "secret1") }));
  await expect("alice deletes all her data in one batch (account deletion)", true, async () => {
    const batch = writeBatch(alice.db);
    (await getDocs(collection(alice.db, "users", A, "subscribers"))).forEach((d) => batch.delete(d.ref));
    batch.delete(doc(alice.db, "users", A, "private", "auth"));
    batch.delete(doc(alice.db, "users", A, "notes", "shared"));
    batch.delete(doc(alice.db, "users", A, "notes", "private"));
    batch.delete(doc(alice.db, "users", A));
    batch.delete(doc(alice.db, "accounts", alice.user.uid));
    await batch.commit();
  });
  await expect("after deletion bob's follow is gone too", false, async () => {
    const s = await getDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid));
    if (!s.exists()) throw new Error("gone");
  });
} finally {
  // Cleanup: subcollections first, then profiles, accounts and the test logins.
  await deleteDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid)).catch(() => {});
  await deleteDoc(doc(alice.db, "users", A, "private", "auth")).catch(() => {});
  await deleteDoc(doc(bob.db, "users", B, "private", "auth")).catch(() => {});
  await deleteDoc(doc(alice.db, "users", A)).catch((e) => console.log("cleanup A", e.code));
  await deleteDoc(doc(bob.db, "users", B)).catch((e) => console.log("cleanup B", e.code));
  await deleteDoc(doc(alice.db, "accounts", alice.user.uid)).catch(() => {});
  await deleteDoc(doc(bob.db, "accounts", bob.user.uid)).catch(() => {});
  for (const c of [alice, bob]) { await deleteUser(c.user).catch(() => {}); await terminate(c.db); await deleteApp(c.app); }
}
console.log(failures ? `\n${failures} FAILED` : "\nAll rules tests passed.");
process.exit(failures ? 1 : 0);
