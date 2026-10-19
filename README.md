# Blister Buddy

A tiny private pill tracker for Android, iPhone (as a home-screen web app) and the browser.
Owners track their blister pack; subscribers (ID + password) get notified when the pill is due and when it was taken.

## Architecture (all free tiers)

```
 App (Expo: Android APK + web/PWA)
   │  Firebase Auth (email + password) + Firestore (Spark plan)
   ▼
 Firestore ── security rules enforce owner / subscriber access and the ID+password check
   ▲
   │  every minute (Firestore REST, service account)
 Cloudflare Worker (cron only, no HTTP endpoint) ──► FCM HTTP v1 ──► phones / browsers
```

- **Accounts**: email + password through Firebase Auth. Plain Firebase Auth is free on Spark: no per-user cost, and the verification and password-reset emails are free. The app offers register, log in, forgot password, email confirmation, change email (confirmed via a link to the new address), change password, log out (detaches this device's push token) and delete account (removes all of the account's Firestore data in one batch). Sensitive changes ask for the current password. The rules only accept tokens that carry an email.
- **Personal ID**: random 6-character code claimed when an account first opens the app (`users/{pid}`). It belongs to the account, so it's the same on every device.
- **Password**: the owner stores `sha256("<pid>:<password>")` in `users/{pid}/private/auth`, which only the owner can read. To subscribe, a client writes that same hash into `users/{pid}/subscribers/{uid}`. The rules only allow the write if it matches, so the password check happens inside Firestore. Changing the password does not remove existing subscribers.
- **Reminders**: the app stores `nextReminderAt`. The Worker sends "Pill time" to the owner and subscribers and moves it to the next day, using the owner's time zone. If the pill was already marked taken that day, no reminder goes out.
- **Taken**: marking a pill sets `takenPending`. Within a minute the Worker notifies subscribers only, then clears the flag.
- **Pack finished**: reminders stop until the owner taps "Start a new pack". This covers the pill-free week.
- **Languages**: English and German (`src/i18n.ts`). The device or browser language is the default, and the EN/DE switch on the home screen overrides it. The choice is stored on the account (`accounts/{uid}.lang`), so the Worker sends push notifications in that language too.
- **Offline**: marking a pill taken, editing the schedule and changing the password update the screen immediately. Firestore syncs them once the device is back online. Only subscribing waits for the server, because the server checks the password. Subscribing is one atomic batch.
- Data per day is a couple of small field writes, well inside Spark's limits. The Worker's queries cost about 2,900 Firestore reads a day; the free limit is 50,000.

Why a Worker? Spark can't run Cloud Functions, and sending FCM needs a server holding the service-account key. The Cloudflare Workers free plan includes cron triggers.

## One-time setup

1. **Firebase console** (project `blisterbuddy-8e7a4`)
   - Authentication → Sign-in method → **Email/Password** enabled (Anonymous stays off).
   - Project settings → Cloud Messaging → Web Push certificates → **Generate key pair**. Put the public key into `.env` as `EXPO_PUBLIC_FIREBASE_VAPID_KEY`.
   - Project settings → Service accounts → **Generate new private key**. Save it as `worker/service-account.json` (gitignored).
2. **Rules**: `firebase deploy --only firestore:rules`
3. **Worker** (from `worker/`). Cloudflare only accepts cron triggers after the account has a `workers.dev` subdomain. Open Workers & Pages in the Cloudflare dashboard once to create it.
   ```sh
   npm install
   npx wrangler login
   npx wrangler secret put SERVICE_ACCOUNT_JSON < service-account.json
   npx wrangler deploy
   ```
4. **Web app / iPhone**: `npm run deploy:web` deploys to https://blisterbuddy-8e7a4.web.app.
   On iPhone, open that URL in Safari, then Share → **Add to Home Screen**. Open the app from the home screen and tap "Turn on notifications" (iOS 16.4 or newer).
5. **Android APK**: `EAS_NO_VCS=1 npx eas-cli build --platform android --profile preview`, then install the APK from the link EAS prints.
   `.easignore` (not `.gitignore`) decides what gets uploaded. It includes `google-services.json` and `.env`, and excludes the worker and its secrets.

## Development

```sh
npm install
npm run web          # http://localhost:8081
npm run typecheck
node --env-file=.env scripts/test-rules.mjs   # live security-rules test (creates & deletes throwaway @example.com users)
cd worker && npm run dev                      # local worker; trigger with curl "http://localhost:8787/__scheduled"
                                              # needs worker/.dev.vars: SERVICE_ACCOUNT_JSON='<json on one line>' 
```

The old manually created doc `schedules/SveaBlisters` is not used. The rules leave it inaccessible to clients.
