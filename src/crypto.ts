// End-to-end encryption primitives (pure JS: Hermes has no WebCrypto, so the same code runs everywhere).
//   AES-256-GCM for data, PBKDF2-SHA256 to turn passwords / recovery codes into keys.
// Ciphertext format: "v1:" + base64(iv[12] ‖ ciphertext ‖ tag[16]).
import { gcm } from "@noble/ciphers/aes.js";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";

export type Key = Uint8Array; // 32 bytes

/** Key-derivation cost; derivation only runs on login, unlock, follow and password changes. */
export const ITERATIONS = 150_000;

let random: (n: number) => Uint8Array = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
/** React Native lacks crypto.getRandomValues; the app passes expo-crypto's generator. */
export const setRandomSource = (fn: (n: number) => Uint8Array) => { random = fn; };

const enc = new TextEncoder();
const dec = new TextDecoder();
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function toB64(bytes: Uint8Array) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}

export function fromB64(s: string) {
  const clean = s.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0, value = 0, j = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("invalid base64");
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes[j++] = (value >> bits) & 255; }
  }
  return bytes;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export const randomKey = (): Key => random(32);
export const newSalt = () => toB64(random(16));

/** Key from a secret (password, recovery code) and a salt. */
export const deriveKey = (secret: string, salt: string, iterations = ITERATIONS): Promise<Key> =>
  pbkdf2Async(sha256, enc.encode(secret.normalize("NFC")), enc.encode(salt), { c: iterations, dkLen: 32 });

export function encryptBytes(key: Key, plain: Uint8Array) {
  const iv = random(12);
  const sealed = gcm(key, iv).encrypt(plain);
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return "v1:" + toB64(out);
}

/** Throws if the key is wrong or the ciphertext was changed (GCM authentication). */
export function decryptBytes(key: Key, text: string) {
  if (!text.startsWith("v1:")) throw new Error("not encrypted");
  const raw = fromB64(text.slice(3));
  return gcm(key, raw.subarray(0, 12)).decrypt(raw.subarray(12));
}

export const isEncrypted = (v: unknown): v is string => typeof v === "string" && v.startsWith("v1:");
export const encrypt = (key: Key, value: unknown) => encryptBytes(key, enc.encode(JSON.stringify(value)));
export const decrypt = <T>(key: Key, text: string): T => JSON.parse(dec.decode(decryptBytes(key, text))) as T;
export const wrapKey = (wrapping: Key, key: Key) => encryptBytes(wrapping, key);
export const unwrapKey = (wrapping: Key, wrapped: string): Key => decryptBytes(wrapping, wrapped);

/**
 * What a follower presents to prove they know the sharing password (compared by the security rules).
 * Slow on purpose, so a leaked value can't be brute-forced quickly.
 */
export const accessKeyFor = async (pid: string, password: string) => hex(await deriveKey(password, `blister-buddy-access:${pid}`));

// Recovery codes: 26 characters from an unambiguous alphabet (≈128 bits), shown in groups of 4.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRecoveryCode() {
  const chars = Array.from(random(26), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return chars.match(/.{1,4}/g)!.join("-");
}
/** Accepts the code with or without dashes/spaces, any case. */
export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");
