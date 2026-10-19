// Web preview deliberately keeps app data flows available without requiring
// browser push credentials. FCM web push can be added after the UI is tested.
export async function setupPush(_registerToken: (token: string) => Promise<unknown>) {}
export function listenForPush() { return () => {}; }
