// Deletes ONLY test data: auth users with an @example.com email (created by the browser tests) and the Firestore docs
// they own (accounts/{uid}, users/{pid} with its subcollections, usernames held by them). Real accounts are never
// touched. Dry run unless "--delete" is passed: always run it without the flag first and check the list.
// Usage: node scripts/cleanup-test-accounts.mjs worker/service-account.json [--delete]
import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";

const [saPath, flag] = process.argv.slice(2);
if (!saPath) { console.error("usage: node scripts/cleanup-test-accounts.mjs <service-account.json> [--delete]"); process.exit(1); }
const sa = JSON.parse(readFileSync(saPath, "utf8"));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
const jwt = `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(sa.private_key, "base64url")}`;
const { access_token } = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) })).json();
const H = { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json", "X-Goog-User-Project": sa.project_id };
const idt = `https://identitytoolkit.googleapis.com/v1/projects/${sa.project_id}`;
const fs = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;

const isTest = (u) => /@example\.com$/i.test(u.email ?? "");
const all = (await (await fetch(`${idt}/accounts:query`, { method: "POST", headers: H, body: JSON.stringify({ returnUserInfo: true, limit: "500" }) })).json()).userInfo ?? [];
const test = all.filter(isTest);
console.log(`auth users: ${all.length} total, ${test.length} test (@example.com) → to delete`);
console.log(`kept logins: ${all.filter((u) => !isTest(u)).map((u) => u.email ?? u.localId).join(", ")}`);

const docs = [];
for (const u of test) {
  const acc = await (await fetch(`${fs}/accounts/${u.localId}`, { headers: H })).json();
  if (acc.name) docs.push(acc.name);
  const pid = acc.fields?.pid?.stringValue;
  if (pid) {
    const user = await (await fetch(`${fs}/users/${pid}`, { headers: H })).json();
    if (user.name && user.fields?.ownerUid?.stringValue === u.localId) { // only a profile this test user owns
      for (const sub of ["subscribers", "private", "notes", "seen", "blocked"]) {
        const list = await (await fetch(`${fs}/users/${pid}/${sub}?pageSize=300`, { headers: H })).json();
        for (const d of list.documents ?? []) docs.push(d.name);
      }
      docs.push(user.name);
    }
  }
  const names = await (await fetch(`${fs}:runQuery`, { method: "POST", headers: H, body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: "usernames" }], where: { fieldFilter: { field: { fieldPath: "ownerUid" }, op: "EQUAL", value: { stringValue: u.localId } } },
  } }) })).json();
  for (const r of names) if (r.document) docs.push(r.document.name);
}
const n = (re) => docs.filter((d) => re.test(d)).length;
console.log(`firestore: ${docs.length} docs (accounts ${n(/\/accounts\/[^/]+$/)}, profiles ${n(/\/users\/[^/]+$/)}, usernames ${n(/\/usernames\//)}) → to delete`);

if (flag !== "--delete") { console.log("dry run — nothing deleted"); process.exit(0); }
for (let i = 0; i < docs.length; i += 400) {
  const r = await fetch(`${fs}:commit`, { method: "POST", headers: H, body: JSON.stringify({ writes: docs.slice(i, i + 400).map((d) => ({ delete: d })) }) });
  if (!r.ok) { console.error("firestore delete failed", r.status, await r.text()); process.exit(1); }
}
if (test.length) {
  const r = await fetch(`${idt}/accounts:batchDelete`, { method: "POST", headers: H, body: JSON.stringify({ localIds: test.map((u) => u.localId), force: true }) });
  console.log(`deleted; auth batchDelete status ${r.status}`);
} else console.log("nothing to delete");
