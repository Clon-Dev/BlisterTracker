// In-app updates for the Android APK (no Play Store): the release script publishes
// /android/latest.json and the APK on Firebase Hosting; the app compares versionCodes,
// downloads the APK and hands it to the Android installer. Same signing key + higher
// versionCode = an in-place update that keeps the login and all app data.
import * as Application from "expo-application";
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { appUrl } from "./config";

export type Release = { versionCode: number; version: string; url: string; notes?: string };

export const currentVersion = () => ({
  version: Application.nativeApplicationVersion ?? "?",
  code: Number(Application.nativeBuildVersion ?? 0),
});

const isApk = (name: string) => /^blister-buddy-\d+\.apk$/.test(name);

/** Removes downloaded APKs (they are only needed until the installer has run). */
async function cleanupDownloads(keep?: string) {
  const dir = FileSystem.cacheDirectory!;
  const files = await FileSystem.readDirectoryAsync(dir);
  await Promise.all(files.filter((f) => isApk(f) && f !== keep).map((f) => FileSystem.deleteAsync(dir + f, { idempotent: true })));
}

/** The published release if it is newer than this install, else null. */
export async function checkForUpdate(): Promise<Release | null> {
  const res = await fetch(`${appUrl}/android/latest.json?t=${Date.now()}`);
  if (!res.ok) return null;
  const release = (await res.json()) as Release;
  if (release.versionCode > currentVersion().code) return release;
  await cleanupDownloads();
  return null;
}

/** Downloads the APK (progress 0–1) and opens the Android installer for it. */
export async function downloadAndInstall(release: Release, onProgress: (p: number) => void) {
  const name = `blister-buddy-${release.versionCode}.apk`;
  await cleanupDownloads(name);
  // Plain concatenation: React Native's URL implementation doesn't reliably resolve relative URLs.
  const url = release.url.startsWith("http") ? release.url : appUrl + release.url;
  const download = FileSystem.createDownloadResumable(url, FileSystem.cacheDirectory + name, {},
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => onProgress(totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0));
  const result = await download.downloadAsync();
  if (!result || result.status !== 200) throw new Error(`HTTP ${result?.status ?? "?"}`);
  const contentUri = await FileSystem.getContentUriAsync(result.uri);
  await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
    data: contentUri,
    type: "application/vnd.android.package-archive",
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION: lets the installer read our file
  });
}
