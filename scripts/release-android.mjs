// Builds and publishes a new Android release that installed apps offer as an in-app update.
//   npm run release:android -- [--minor] ["What's new"]
// 1. bumps android.versionCode (+1) and the version (patch, or minor with --minor) in app.json
// 2. builds the APK on EAS (same signing key → updates keep the app's data)
// 3. writes android/latest.json (pointing at the APK on Expo's servers) and deploys Firebase Hosting.
//    The APK itself can't live on Firebase Hosting: the free Spark plan rejects executable files.
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const minor = args.includes("--minor");
const notes = args.filter((a) => a !== "--minor").join(" ").trim();

// 1. Version
const appJson = JSON.parse(readFileSync("app.json", "utf8"));
const expo = appJson.expo;
const [major, min, patch] = expo.version.split(".").map(Number);
expo.version = minor ? `${major}.${min + 1}.0` : `${major}.${min}.${patch + 1}`;
expo.android.versionCode = (expo.android.versionCode ?? 1) + 1;
writeFileSync("app.json", JSON.stringify(appJson, null, 2) + "\n");
const { version } = expo;
const versionCode = expo.android.versionCode;
console.log(`▶ Release ${version} (versionCode ${versionCode})`);

// 2. Build
console.log("▶ Building on EAS (this waits for the build queue)…");
const out = execSync("npx eas-cli build --platform android --profile preview --non-interactive --wait --json", {
  env: { ...process.env, EAS_NO_VCS: "1" }, stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024,
}).toString();
const build = JSON.parse(out)[0];
if (build.status !== "FINISHED") throw new Error(`EAS build ${build.id} ended with status ${build.status}`);
console.log(`✔ Built: ${build.artifacts.buildUrl}`);

// 3. Publish: check the artifact really is a downloadable APK, then point latest.json at it.
const url = build.artifacts.buildUrl;
const head = await fetch(url, { method: "HEAD", redirect: "follow" });
const size = Number(head.headers.get("content-length") ?? 0);
if (!head.ok || size < 1_000_000) throw new Error(`APK not downloadable: HTTP ${head.status}, ${size} bytes`);
const dir = "public/android";
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/latest.json`, JSON.stringify({ versionCode, version, url, notes, publishedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`✔ latest.json → ${url} (${(size / 1e6).toFixed(1)} MB)`);

execSync("npm run deploy:web", { stdio: "inherit" });
console.log(`✔ Published. Installed apps will offer version ${version}.`);
