// Live security-rules test against the real Firebase project.
// Creates throwaway email users (…@example.com), exercises every rule, then deletes everything it made.
// Usage: node --env-file=.env scripts/test-rules.mjs
import { createHash } from "node:crypto";
import { initializeApp, deleteApp } from "firebase/app";
import { getAuth, deleteUser, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, deleteField, collection, getDocs, serverTimestamp, Timestamp, terminate, writeBatch } from "firebase/firestore";

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
  takenDays: { "2026-10-15": "20:01" }, nextReminderAt: Timestamp.fromMillis(Date.now() + 864e5), nextLateAt: null, takenPending: false, shareKeyWrap: "salt|v1:abc",
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
  await expect("bob hides the setup card (only follows)", true, () => updateDoc(doc(bob.db, "accounts", bob.user.uid), { followerOnly: true }));
  await expect("followerOnly must be a boolean", false, () => updateDoc(doc(bob.db, "accounts", bob.user.uid), { followerOnly: "yes" }));
  await expect("alice stores her encryption keyring", true, () => updateDoc(doc(alice.db, "accounts", alice.user.uid), { keyring: { v: 1, pwSalt: "s", pw: "v1:x", rcSalt: "r", rc: "v1:y" } }));
  await expect("alice adds a share-key wrap before having a schedule", true, () => updateDoc(doc(alice.db, "users", A), { shareKeyWrap: "salt|v1:abc" }));
  await expect("alice cannot add other fields to a schedule-less profile", false, () => updateDoc(doc(alice.db, "users", A), { evil: true }));
  await expect("bob cannot read alice's account", false, () => getDoc(doc(bob.db, "accounts", alice.user.uid)));
  await expect("alice saves a valid schedule", true, () => setDoc(doc(alice.db, "users", A), schedule));
  // Usernames: unique (case-insensitive), changeable, only for the own profile.
  // As usernameKey in src/data.ts: lowercased letter by letter.
  const ukey = (u) => [...u].map((c) => { const l = c.toLowerCase(); return [...l].length === 1 ? l : c; }).join("").replace(/%/g, "%25").replace(/\//g, "%2F");
  const claim = (c, pid, name, previous) => {
    const batch = writeBatch(c.db);
    if (previous && ukey(previous) !== ukey(name)) batch.delete(doc(c.db, "usernames", ukey(previous)));
    batch.set(doc(c.db, "usernames", ukey(name)), { pid, ownerUid: c.user.uid, username: name });
    batch.update(doc(c.db, "users", pid), { username: name, usernameKey: ukey(name) });
    return batch.commit();
  };
  await expect("alice claims the username Alice_93", true, () => claim(alice, A, "Alice_93"));
  await expect("bob cannot take it with other capitals", false, () => claim(bob, B, "ALICE_93"));
  await expect("bob cannot point a username at alice's profile", false, () => setDoc(doc(bob.db, "usernames", "bobs-fake"), { pid: A, ownerUid: bob.user.uid, username: "bobs-fake" }));
  await expect("bob cannot show a username he doesn't hold", false, () => updateDoc(doc(bob.db, "users", B), { username: "Alice_93" }));
  await expect("bob cannot claim a 1-character username", false, () => claim(bob, B, "b"));
  await expect("bob cannot claim a 25-character username", false, () => claim(bob, B, "b".repeat(25)));
  await expect("bob cannot claim a username with emoji", false, () => claim(bob, B, "bob😺"));
  await expect("bob cannot claim “..”", false, () => claim(bob, B, ".."));
  let held; // bob's current username (each claim frees only a name he really holds)
  const bobClaims = async (name) => { await claim(bob, B, name, held); held = name; };
  for (const [name, other] of [["xy", "XY"], ["x".repeat(24), null], ["Jörg_Ünal", "JÖRG_üNAL"], ["Иван_Петров", "иван_петров"], ["さくら・サクラ", null], ["ΣΟΦΙΑ", "σοφια"], ["Łódź", "ŁÓDŹ"], ["İstanbul", null]]) {
    await expect(`bob claims “${name}”`, true, () => bobClaims(name));
    if (other && held === name) await expect(`alice can't take it as “${other}”`, false, () => claim(alice, A, other, "ALICE_93"));
  }
  await expect("bob changes to “b/o/b~!?#”", true, () => bobClaims("b/o/b~!?#"));
  await expect("bob cannot claim a username with a space", false, () => claim(bob, B, "bob smith"));
  await expect("bob cannot file a username under another key", false, () => setDoc(doc(bob.db, "usernames", "something"), { pid: B, ownerUid: bob.user.uid, username: "bob.smith" }));
  await expect("bob renames himself (the old name is freed)", true, () => claim(bob, B, "Bobby!!", "b/o/b~!?#"));
  await expect("the old name is free again", true, async () => {
    if ((await getDoc(doc(alice.db, "usernames", ukey("b/o/b~!?#")))).exists()) throw new Error("still taken");
  });
  await expect("alice changes only the capitals of her username", true, () => claim(alice, A, "ALICE_93", "Alice_93"));
  await expect("anyone signed in can look up a username", true, async () => {
    const d = await getDoc(doc(bob.db, "usernames", ukey("alice_93")));
    if (d.data()?.pid !== A) throw new Error("wrong pid");
  });
  await expect("bob cannot delete alice's username", false, () => deleteDoc(doc(bob.db, "usernames", ukey("alice_93"))));
  await expect("alice cannot remove the username from her profile", false, () => updateDoc(doc(alice.db, "users", A), { username: deleteField() }));
  await expect("alice cannot point her profile at bob's entry", false, () => updateDoc(doc(alice.db, "users", A), { username: "b/o/b~!?#", usernameKey: ukey("b/o/b~!?#") }));
  await expect("a 1.4.0-style rename (no usernameKey) still works for ASCII names", true, async () => {
    const batch = writeBatch(alice.db);
    batch.delete(doc(alice.db, "usernames", ukey("ALICE_93")));
    batch.set(doc(alice.db, "usernames", ukey("Alice_94")), { pid: A, ownerUid: alice.user.uid, username: "Alice_94" });
    batch.update(doc(alice.db, "users", A), { username: "Alice_94", usernameKey: deleteField() });
    await batch.commit();
  });
  await expect("back to ALICE_93", true, () => claim(alice, A, "ALICE_93", "Alice_94"));
  await expect("alice cannot have more placebo pills than pills", false, () => updateDoc(doc(alice.db, "users", A), { placebo: 21 }));
  await expect("alice cannot use an unsupported repeat interval", false, () => updateDoc(doc(alice.db, "users", A), { repeatMinutes: 5 }));
  await expect("alice cannot save a malformed pack start", false, () => updateDoc(doc(alice.db, "users", A), { packStart: "15.10.2026" }));
  await expect("alice switches to 24 + 4 placebo with 2 h follower alert", true, () => updateDoc(doc(alice.db, "users", A), { pillsPerPack: 28, placebo: 4, breakDays: 0, lateMinutes: 120 }));
  await expect("alice switches to the patch with a 1-day follower alert", true, () => updateDoc(doc(alice.db, "users", A), { method: "patch", pillsPerPack: 21, placebo: 0, breakDays: 7, lateMinutes: 60 }));
  await expect("alice records a patch change done a day late", true, () => updateDoc(doc(alice.db, "users", A), { "takenDays.2026-10-22": "2026-10-23T09:12" }));
  await expect("alice switches to the 13-week injection", true, () => updateDoc(doc(alice.db, "users", A), { method: "injection", pillsPerPack: 91, breakDays: 0 }));
  await expect("alice cannot use an unknown method", false, () => updateDoc(doc(alice.db, "users", A), { method: "implant" }));
  await expect("alice cannot use a longer injection interval", false, () => updateDoc(doc(alice.db, "users", A), { pillsPerPack: 120 }));
  await expect("alice switches back to the pill (24 + 4)", true, () => updateDoc(doc(alice.db, "users", A), { method: "pill", pillsPerPack: 28, placebo: 4, breakDays: 0, "takenDays.2026-10-22": deleteField() }));
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
  await expect("alice stores her (encrypted) sharing password for herself", true, () => setDoc(doc(alice.db, "users", A, "private", "auth"), { key: key(A, "secret1"), password: "v1:" + "A".repeat(80) }));
  await expect("alice can read her stored password", true, async () => {
    if (!(await getDoc(doc(alice.db, "users", A, "private", "auth"))).data().password.startsWith("v1:")) throw new Error("not stored");
  });
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
  await expect("bob (follower) can read alice's share-key wrap", true, async () => {
    if (!(await getDoc(doc(bob.db, "users", A))).data().shareKeyWrap) throw new Error("missing");
  });
  await expect("bob cannot read alice's private notes", false, () => getDoc(doc(bob.db, "users", A, "notes", "private")));
  await expect("bob cannot write alice's notes", false, () => setDoc(doc(bob.db, "users", A, "notes", "shared"), { days: {} }));
  await expect("bob cannot modify alice's schedule", false, () => updateDoc(doc(bob.db, "users", A), { "takenDays.2026-10-20": "08:00" }));
  await expect("bob cannot list alice's subscribers", false, () => getDocs(collection(bob.db, "users", A, "subscribers")));
  await expect("alice can list her subscribers", true, () => getDocs(collection(alice.db, "users", A, "subscribers")));
  // "Seen" confirmations: followers confirm they saw that the pill was taken.
  const seenBob = () => doc(bob.db, "users", A, "seen", bob.user.uid);
  await expect("bob (follower) confirms he has seen today's pill", true, () => setDoc(seenBob(), { day: "2026-10-19", at: serverTimestamp(), name: "Bob" }));
  await expect("bob confirms without a name", true, () => setDoc(seenBob(), { day: "2026-10-19", at: serverTimestamp() }));
  await expect("bob cannot confirm for someone else", false, () => setDoc(doc(bob.db, "users", A, "seen", "someone-else"), { day: "2026-10-19", at: serverTimestamp() }));
  await expect("bob cannot backdate a confirmation", false, () => setDoc(seenBob(), { day: "2026-10-19", at: Timestamp.fromMillis(0) }));
  await expect("bob cannot add other fields to a confirmation", false, () => setDoc(seenBob(), { day: "2026-10-19", at: serverTimestamp(), evil: true }));
  await expect("bob cannot use a malformed day", false, () => setDoc(seenBob(), { day: "19.10.2026", at: serverTimestamp() }));
  await expect("alice reads her followers' confirmations", true, async () => {
    const s = await getDocs(collection(alice.db, "users", A, "seen"));
    if (s.size !== 1) throw new Error(`expected 1 confirmation, got ${s.size}`);
  });
  await expect("alice cannot confirm her own pill (she isn't a follower)", false, () => setDoc(doc(alice.db, "users", A, "seen", alice.user.uid), { day: "2026-10-19", at: serverTimestamp() }));
  await expect("bob cannot list other followers' confirmations", false, () => getDocs(collection(bob.db, "users", A, "seen")));
  await expect("alice cannot subscribe to herself", false, async () => {
    await setDoc(doc(bob.db, "users", B, "private", "auth"), { key: key(B, "pw1234") }).catch(() => {});
    await setDoc(doc(alice.db, "users", A, "subscribers", alice.user.uid), { key: key(A, "secret1") });
  });
  await expect("bob unsubscribes", true, () => deleteDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid)));
  await expect("bob loses access after unsubscribing", false, () => getDoc(doc(bob.db, "users", A)));
  await expect("bob cannot confirm after unfollowing", false, () => setDoc(seenBob(), { day: "2026-10-20", at: serverTimestamp() }));
  await expect("bob deletes his confirmation when unfollowing", true, () => deleteDoc(seenBob()));
  await expect("bob re-follows alice", true, () => setDoc(doc(bob.db, "users", A, "subscribers", bob.user.uid), { key: key(A, "secret1") }));
  await expect("bob confirms again after re-following", true, () => setDoc(seenBob(), { day: "2026-10-21", at: serverTimestamp() }));
  await expect("alice deletes all her data in one batch (account deletion)", true, async () => {
    const batch = writeBatch(alice.db);
    (await getDocs(collection(alice.db, "users", A, "subscribers"))).forEach((d) => batch.delete(d.ref));
    (await getDocs(collection(alice.db, "users", A, "seen"))).forEach((d) => batch.delete(d.ref));
    batch.delete(doc(alice.db, "usernames", ukey("alice_93")));
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
  await deleteDoc(doc(bob.db, "users", A, "seen", bob.user.uid)).catch(() => {});
  // Free every name the test may hold (also after a failure), so no orphaned usernames remain.
  const ukeyAll = (u) => [...u].map((c) => { const l = c.toLowerCase(); return [...l].length === 1 ? l : c; }).join("").replace(/%/g, "%25").replace(/\//g, "%2F");
  const testNames = ["Alice_93", "Alice_94", "Bobby!!", "b/o/b~!?#", "xy", "x".repeat(24), "Jörg_Ünal", "Иван_Петров", "さくら・サクラ", "ΣΟΦΙΑ", "Łódź", "İstanbul", "JÖRG_üNAL", "иван_петров", "σοφια", "ŁÓDŹ", "XY"];
  for (const c of [alice, bob]) for (const n of testNames) await deleteDoc(doc(c.db, "usernames", ukeyAll(n))).catch(() => {});
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
