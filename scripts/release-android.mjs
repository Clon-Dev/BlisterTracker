// Builds and publishes a new Android release that installed apps offer as an in-app update.
//   npm run release:android -- [--minor] ["What's new"]
// 1. bumps android.versionCode (+1) and the version (patch, or minor with --minor) in app.json
// 2. builds the APK on EAS (same signing key → updates keep the app's data)
// 3. puts the APK and android/latest.json into public/ and deploys Firebase Hosting
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

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

// 3. Publish
const dir = "public/android";
mkdirSync(dir, { recursive: true });
const apkName = `blister-buddy-${versionCode}.apk`;
const apk = Buffer.from(await (await fetch(build.artifacts.buildUrl)).arrayBuffer());
if (apk.length < 1_000_000 || apk.subarray(0, 2).toString() !== "PK") throw new Error(`Downloaded file is not an APK (${apk.length} bytes)`);
for (const f of readdirSync(dir)) if (f.endsWith(".apk")) rmSync(`${dir}/${f}`); // only the latest is hosted
writeFileSync(`${dir}/${apkName}`, apk);
writeFileSync(`${dir}/latest.json`, JSON.stringify({ versionCode, version, url: `/android/${apkName}`, notes, publishedAt: new Date().toISOString() }, null, 2) + "\n");
console.log(`✔ ${apkName} (${(apk.length / 1e6).toFixed(1)} MB) + latest.json`);

execSync("npm run deploy:web", { stdio: "inherit" });
console.log(`✔ Published. Installed apps will offer version ${version}.`);
