import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApp, getApps, initializeApp } from "firebase/app";
// @ts-expect-error getReactNativePersistence only exists in the react-native build of firebase/auth.
import { getAuth, initializeAuth, getReactNativePersistence, type Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./config";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let nativeAuth: Auth;
try {
  nativeAuth = initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
} catch {
  nativeAuth = getAuth(app); // already initialized (fast refresh)
}
export const auth = nativeAuth;
export const db = getFirestore(app);
