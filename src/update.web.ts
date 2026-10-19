// The web app is always the deployed version; APK updates only exist on Android.
import Constants from "expo-constants";

export type Release = { versionCode: number; version: string; url: string; notes?: string };
export const currentVersion = () => ({ version: Constants.expoConfig?.version ?? "?", code: 0 });
export const checkForUpdate = async (): Promise<Release | null> => null;
export async function downloadAndInstall(_release: Release, _onProgress: (p: number) => void) {}
