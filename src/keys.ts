// The account's keyring and the unlocked keys in memory.
//
// accounts/{uid}.keyring = {
//   v: 1,
//   pwSalt, pw:  data key wrapped with PBKDF2(account password)
//   rcSalt, rc:  data key wrapped with PBKDF2(recovery code)
//   share?:      own schedule's share key, wrapped with the data key
//   shareKeys?:  { [pid]: followed schedule's share key, wrapped with the data key }
// }
// The data key encrypts private content; a schedule's share key encrypts its shared notes and is
// handed to followers through users/{pid}.shareKeyWrap (wrapped with the sharing password).
import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import { doc, updateDoc } from "firebase/firestore";
import {
  deriveKey, fromB64, newRecoveryCode, newSalt, normalizeRecoveryCode, randomKey, setRandomSource, toB64, unwrapKey, wrapKey, type Key,
} from "./crypto";
import { deviceGet, deviceRemove, deviceSet } from "./deviceStore";
import { db } from "./firebase";

setRandomSource((n) => Crypto.getRandomBytes(n));

export type Keyring = { v: 1; pwSalt: string; pw: string; rcSalt: string; rc: string; share?: string; shareKeys?: Record<string, string> };

let dataKey: Key | null = null;
/** Latest keyring: updated right after our own writes and from the account listener, so writes never use a stale copy. */
let ring: Keyring | undefined;
export const syncKeyring = (keyring: Keyring | undefined) => { ring = keyring; };
export const currentKeyring = () => ring;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getKey = () => dataKey;

/** The unlocked data key (null while locked); re-renders on change. */
export const useDataKey = () => useSyncExternalStore(subscribe, getKey, getKey);
export const currentDataKey = () => dataKey;

const cacheName = (uid: string) => `bb_dk_${uid}`;
const accountRef = (uid: string) => doc(db, "accounts", uid);
function saveKeyring(uid: string, keyring: Keyring) {
  ring = keyring;
  return updateDoc(accountRef(uid), { keyring });
}

async function setUnlocked(uid: string, key: Key) {
  dataKey = key;
  await deviceSet(cacheName(uid), toB64(key));
  emit();
}

/** Restores the key cached on this device; true if found. */
export async function loadCachedKey(uid: string) {
  const cached = await deviceGet(cacheName(uid));
  if (cached) { dataKey = fromB64(cached); emit(); }
  return !!cached;
}

/** Forgets the key on this device (logout, account deletion). */
export async function forgetKey(uid: string) {
  dataKey = null;
  await deviceRemove(cacheName(uid));
  emit();
}

/** New keyring for an account; returns the recovery code to show once. Replaces any old keyring. */
export async function createKeyring(uid: string, password: string) {
  const key = randomKey();
  const code = newRecoveryCode();
  const pwSalt = newSalt();
  const rcSalt = newSalt();
  const keyring: Keyring = {
    v: 1, pwSalt, rcSalt,
    pw: wrapKey(await deriveKey(password, pwSalt), key),
    rc: wrapKey(await deriveKey(normalizeRecoveryCode(code), rcSalt), key),
  };
  await saveKeyring(uid, keyring);
  await setUnlocked(uid, key);
  return code;
}

/** Throws if the password doesn't open the keyring (wrong, or changed via "forgot password"). */
export async function unlockWithPassword(uid: string, password: string) {
  await setUnlocked(uid, unwrapKey(await deriveKey(password, ring!.pwSalt), ring!.pw));
}

/** After a password reset: opens the keyring with the recovery code and re-wraps it for the current password. */
export async function unlockWithRecovery(uid: string, code: string, currentPassword: string) {
  const key = unwrapKey(await deriveKey(normalizeRecoveryCode(code), ring!.rcSalt), ring!.rc);
  const pwSalt = newSalt();
  await saveKeyring(uid, { ...ring!, pwSalt, pw: wrapKey(await deriveKey(currentPassword, pwSalt), key) });
  await setUnlocked(uid, key);
}

/** After changing the account password (key unlocked). */
export async function rewrapForPassword(uid: string, newPassword: string) {
  const pwSalt = newSalt();
  await saveKeyring(uid, { ...ring!, pwSalt, pw: wrapKey(await deriveKey(newPassword, pwSalt), dataKey!) });
}

/** A new recovery code (the old one stops working). */
export async function regenerateRecoveryCode(uid: string) {
  const code = newRecoveryCode();
  const rcSalt = newSalt();
  await saveKeyring(uid, { ...ring!, rcSalt, rc: wrapKey(await deriveKey(normalizeRecoveryCode(code), rcSalt), dataKey!) });
  return code;
}

// ---------- Share keys ----------

const tryUnwrap = (wrapped: string | undefined) => {
  if (!wrapped || !dataKey) return null;
  try { return unwrapKey(dataKey, wrapped); } catch { return null; }
};

export const ownShareKey = (keyring: Keyring | undefined = ring) => tryUnwrap(keyring?.share);
export const followedShareKey = (pid: string, keyring: Keyring | undefined = ring) => tryUnwrap(keyring?.shareKeys?.[pid]);

/** The own schedule's share key, created on first use. */
export async function ensureOwnShareKey(uid: string) {
  const existing = ownShareKey();
  if (existing) return existing;
  const key = randomKey();
  await saveKeyring(uid, { ...ring!, share: wrapKey(dataKey!, key) });
  return key;
}

export const addFollowedShareKey = (uid: string, pid: string, key: Key) =>
  saveKeyring(uid, { ...ring!, shareKeys: { ...ring!.shareKeys, [pid]: wrapKey(dataKey!, key) } });

export async function removeFollowedShareKey(uid: string, pid: string) {
  if (!ring?.shareKeys?.[pid]) return;
  const rest = { ...ring.shareKeys };
  delete rest[pid];
  await saveKeyring(uid, { ...ring, shareKeys: rest });
}

/** users/{pid}.shareKeyWrap: "<salt>|<share key wrapped with PBKDF2(sharing password, salt)>". */
export async function wrapShareKeyForPassword(shareKey: Key, sharingPassword: string) {
  const salt = newSalt();
  return `${salt}|${wrapKey(await deriveKey(sharingPassword, salt), shareKey)}`;
}
export async function unwrapShareKeyWithPassword(shareKeyWrap: string, sharingPassword: string) {
  const [salt, wrapped] = shareKeyWrap.split("|");
  return unwrapKey(await deriveKey(sharingPassword, salt), wrapped);
}
