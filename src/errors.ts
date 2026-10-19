import { strings } from "./i18n";
import { alert } from "./sheets";

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * For Firestore writes that are fine to sync later: the local cache (and every listener) updates
 * immediately, but the promise only settles once the server confirms, which never happens while
 * offline. So don't block the UI on it; just report a rejection if one comes.
 */
export const queued = (write: Promise<unknown>) => { write.catch((e) => alert(strings().errorTitle, errorText(e))); };
