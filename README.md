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
- **Schedule model** (`shared/schedule.ts`, used by both the app and the Worker): a pack is `pillsPerPack` pills (the last `placebo` of them placebo, still taken daily), then `breakDays` pill-free days, and the next pack starts automatically. Pills are tied to calendar days like a real blister: `packStart` anchors pack 1, and `takenDays` maps each marked day to the time it was marked. A past day marked afterwards stores no time. Days before `trackingSince` (the first setup) count as taken. Presets: 21+7 break, 24+4 placebo, 21+7 placebo, 28 continuous, 84+7 break, or custom.
- **Reminders**: on every change the app computes `nextReminderAt` and `nextLateAt` with the shared module. The Worker sends due moments and moves them forward:
  - The owner gets the reminder at the set time, repeated every 15/30/60 minutes until marked (at most 8 times, same day only), with a "Taken" button. The button works on Android and in desktop/Android browsers; iPhone home-screen apps show no buttons.
  - Followers get the first reminder.
  - Followers also get "not taken yet" 30 min, 1 h or 2 h after the set time.
  - Nothing is sent on pill-free days or once the pill is marked.
- **Taken**: marking today's pill sets `takenPending`. Within a minute the Worker tells followers "took today's pill at HH:MM", then clears the flag. Undo is possible, and any past pill day can be corrected from the blister or the history calendar.
- **Marking a pill** always asks "Just now" or "Earlier…" (time picker capped at the current time; past days can also be saved without a time). This applies to the home screen, the wizard, the blister, the calendar and the notification's "Taken" button, which opens this sheet.
- **UI**: design tokens in `src/theme.ts` (colors, gradients, Plus Jakarta Sans, shadows). Shared components are in `src/ui.tsx`. In-app bottom sheets and toasts (`src/sheets.tsx`) replace system alerts on every platform. Icons are Lucide.
- **Supplies & appointments**: "unopened packs at home" is stored as `supplyPacks`/`supplyFrom`. The owner gets a refill notice when the last pack starts, and an appointment notice the day before at the reminder time. Both use `nextNoticeAt`, which the Worker's fourth job processes.
- **Own reminder text**: `reminderText` (up to 64 characters, emoji allowed) replaces the owner's reminder wording and becomes the notification title.
- **Starting a pack early** (to delay a period, on medical advice): moves `packStart` and keeps the old start in `earlierPackStarts`, so past days keep their pack position.
- **Daily notes**: a mood and free text per day in `users/{pid}/notes/shared` (followers can read it) or `notes/private` (owner only, enforced by the rules).
- **Travelling**: when the device's time zone differs from the schedule's, a notice shows both times. "Use local time" switches `tz`; "Keep home time" is remembered per zone pair.
- **Dark mode**: follows the system, with an override (System/Light/Dark) in Account. Palettes live in `src/theme.ts`, and style sheets use `themedStyles(...)` so they rebuild on a switch.
- **Pushes** are data-only FCM messages. The Android app (`expo-notifications`) and `public/firebase-messaging-sw.js` build the notification from `title`, `message`, `categoryId` and `body`.
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
   When the schedule format changes, deploy in this order: rules, then the Worker, then the web app. New rules can take several minutes to apply everywhere.
4. **Web app / iPhone**: `npm run deploy:web` deploys to https://blisterbuddy-8e7a4.web.app.
   On iPhone, open that URL in Safari, then Share → **Add to Home Screen**. Open the app from the home screen and tap "Turn on notifications" (iOS 16.4 or newer).
5. **Android APK**: `EAS_NO_VCS=1 npx eas-cli build --platform android --profile preview`, then install the APK from the link EAS prints.
   `.easignore` (not `.gitignore`) decides what gets uploaded. It includes `google-services.json` and `.env`, and excludes the worker and its secrets.

## Releasing an Android update

```sh
npm run release:android                 # patch version, e.g. 1.1.0 → 1.1.1
npm run release:android -- --minor      # minor version, e.g. 1.1.x → 1.2.0
npm run release:android -- "What's new" # optional notes shown in the update card
```

The script bumps `version` and `android.versionCode` in `app.json`, builds the APK on EAS (and waits), checks that the download is an APK, and stores it with `android/latest.json` in `public/android/`. It then deploys Firebase Hosting.

Installed apps check `latest.json` on start (at most every 6 hours), or via Account → "Check for updates". When a higher `versionCode` is available, the app shows "Version x is available · Update app": it downloads the APK with progress and opens the Android installer. Because every build is signed with the same EAS key, the update installs in place and keeps the login and all app data. The first time, Android asks to allow installs from Blister Buddy.

Notes:
- `public/android/` is gitignored and excluded from EAS uploads, since the APK is about 70 MB. Firebase Hosting serves only the latest APK.
- Run web deploys from the machine that holds `public/android/`. A deploy without it would remove the hosted APK.
- Commit the bumped `app.json` after a release.

## Development

```sh
npm install
npm run web          # http://localhost:8081
npm run typecheck
node --env-file=.env scripts/test-rules.mjs   # live security-rules test (creates & deletes throwaway @example.com users)
node scripts/test-schedule.ts                 # unit tests for shared/schedule.ts (packs, breaks, DST, repeats, late alerts)
cd worker && npm run dev                      # local worker; trigger with curl "http://localhost:8787/__scheduled"
                                              # needs worker/.dev.vars: SERVICE_ACCOUNT_JSON='<json on one line>' 
```

The old manually created doc `schedules/SveaBlisters` is not used. The rules leave it inaccessible to clients.
