// Unit tests for src/crypto.ts. Usage: node scripts/test-crypto.ts
import {
  accessKeyFor, decrypt, deriveKey, encrypt, fromB64, isEncrypted, newRecoveryCode, newSalt, normalizeRecoveryCode, randomKey,
  toB64, unwrapKey, wrapKey,
} from "../src/crypto.ts";

let failures = 0;
async function check(label: string, fn: () => unknown | Promise<unknown>) {
  try { await fn(); console.log(`PASS  ${label}`); } catch (e) { failures++; console.log(`FAIL  ${label}  (${(e as Error).message})`); }
}
const assert = (cond: unknown, msg = "assertion failed") => { if (!cond) throw new Error(msg); };
const throws = (fn: () => unknown) => { try { fn(); } catch { return; } throw new Error("expected an error"); };

const key = randomKey();
const note = { text: "Kopfweh, sonst gut 🙂 – ünïcödé", mood: "😕" };

await check("base64 round trip (all lengths)", () => {
  for (let n = 0; n < 40; n++) {
    const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255);
    assert(toB64(bytes) === Buffer.from(bytes).toString("base64"), `encode n=${n}`);
    assert(Buffer.from(fromB64(toB64(bytes))).equals(Buffer.from(bytes)), `decode n=${n}`);
  }
});
await check("encrypt → decrypt round trip (emoji, umlauts)", () => {
  const c = encrypt(key, note);
  assert(isEncrypted(c) && !c.includes("Kopfweh"), "ciphertext leaks plaintext");
  assert(JSON.stringify(decrypt(key, c)) === JSON.stringify(note));
});
await check("same plaintext encrypts differently each time (random IV)", () => assert(encrypt(key, note) !== encrypt(key, note)));
await check("wrong key fails", () => throws(() => decrypt(randomKey(), encrypt(key, note))));
await check("tampered ciphertext fails", () => {
  const c = encrypt(key, note);
  const raw = fromB64(c.slice(3)); raw[20] ^= 1;
  throws(() => decrypt(key, "v1:" + toB64(raw)));
});
await check("plaintext is rejected as ciphertext", () => throws(() => decrypt(key, "hello")));
await check("password-derived key wraps and unwraps the data key", async () => {
  const salt = newSalt();
  const wrapped = wrapKey(await deriveKey("correct horse", salt), key);
  assert(Buffer.from(unwrapKey(await deriveKey("correct horse", salt), wrapped)).equals(Buffer.from(key)));
});
await check("wrong password can't unwrap", async () => {
  const salt = newSalt();
  const wrapped = wrapKey(await deriveKey("correct horse", salt), key);
  const wrong = await deriveKey("correct hors3", salt);
  throws(() => unwrapKey(wrong, wrapped));
});
await check("recovery code: format, normalization, unwrap", async () => {
  const code = newRecoveryCode();
  assert(/^([A-HJ-NP-Z2-9]{4}-){6}[A-HJ-NP-Z2-9]{2}$/.test(code), `format ${code}`);
  const salt = newSalt();
  const wrapped = wrapKey(await deriveKey(normalizeRecoveryCode(code), salt), key);
  const typed = ` ${code.toLowerCase().replace(/-/g, " ")} `;
  assert(Buffer.from(unwrapKey(await deriveKey(normalizeRecoveryCode(typed), salt), wrapped)).equals(Buffer.from(key)));
});
await check("access key is deterministic, 64 hex, per schedule", async () => {
  const a = await accessKeyFor("K7Q2XM", "share42");
  assert(/^[0-9a-f]{64}$/.test(a), a);
  assert(a === (await accessKeyFor("K7Q2XM", "share42")), "not deterministic");
  assert(a !== (await accessKeyFor("ABCDEF", "share42")), "same for other schedule");
});
await check("key derivation cost is acceptable here", async () => {
  const t = Date.now(); await deriveKey("x", "y"); const ms = Date.now() - t;
  console.log(`      (PBKDF2 150k iterations: ${ms} ms in Node)`);
});

console.log(failures ? `\n${failures} FAILED` : "\nAll crypto tests passed.");
process.exit(failures ? 1 : 0);
