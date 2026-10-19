import {
  createUserWithEmailAndPassword, EmailAuthProvider, reauthenticateWithCredential,
  sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updatePassword,
  verifyBeforeUpdateEmail, type User,
} from "firebase/auth";
import { auth } from "./firebase";
import { strings, type Lang } from "./i18n";

/** Auth emails (verification, password reset, email change) are sent in the app language. */
export const setAuthLanguage = (lang: Lang) => { auth.languageCode = lang; };

export async function register(email: string, password: string) {
  const { user } = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await sendEmailVerification(user);
}

export const login = (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());
export const resendVerification = (user: User) => sendEmailVerification(user);

/** Sensitive changes need a fresh login; asking for the current password covers that. */
const reauthenticate = (user: User, password: string) =>
  reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email!, password));

export async function changePassword(user: User, current: string, next: string) {
  await reauthenticate(user, current);
  await updatePassword(user, next);
}

/** The address only changes once the link sent to the new address is confirmed. */
export async function changeEmail(user: User, password: string, newEmail: string) {
  await reauthenticate(user, password);
  await verifyBeforeUpdateEmail(user, newEmail.trim());
}

/** Re-authenticates, lets `deleteData` remove the Firestore data, then deletes the login itself. */
export async function deleteAccount(user: User, password: string, deleteData: () => Promise<void>) {
  await reauthenticate(user, password);
  await deleteData();
  await user.delete();
}

/** User-facing message for Firebase Auth errors. */
export function authErrorText(e: unknown) {
  const t = strings();
  const code = (e as { code?: string })?.code ?? "";
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"].includes(code)) return t.authInvalid;
  if (code === "auth/email-already-in-use" || code === "auth/credential-already-in-use") return t.authEmailInUse;
  if (code === "auth/invalid-email" || code === "auth/missing-email") return t.authInvalidEmail;
  if (code === "auth/weak-password") return t.authWeakPassword;
  if (code === "auth/too-many-requests") return t.authTooMany;
  if (code === "auth/network-request-failed") return t.authNetwork;
  return e instanceof Error ? e.message : String(e);
}
