# Blister Buddy

A tiny private contraception tracker (pill, patch, ring, injection) for Android, iPhone (as a home-screen web app) and the browser.
Owners track their blister pack, patch, ring or injection; followers (username + password) get notified when it's due and when it was done.

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
- **Just following**: accounts without an own schedule see "Set up your contraception plan" on the home screen. "I'm just here to follow someone else's plan" hides it (`accounts/{uid}.followerOnly`, so on every device); "Set up my own plan" under the follow button opens the wizard. Account → "Home screen" has the same setting as a switch (both ways), while there's no own schedule.
- **Personal ID**: random 6-character code claimed when an account first opens the app (`users/{pid}`). It belongs to the account, so it's the same on every device.
- **Username**: what others see and type to follow. It's unique, changeable at any time (pencil on the username card), and can be 2–24 characters: ASCII 33–126 (no spaces), accented Latin letters, Greek, Cyrillic, Hiragana and Katakana (normalized to NFC). The personal ID stays the internal key of everything (schedule doc, follows, access keys, share keys), so renaming keeps all followers connected.
  - `usernames/{key}` = `{ pid, ownerUid, username }` makes names unique. `key` = the name lowercased letter by letter, with `%` and `/` escaped (so "Svea" and "svea" are the same name). The same formula is in `src/data.ts` and `firestore.rules`.
  - The profile shows it as `users/{pid}.username`. The rules only accept a name this profile holds, and claiming, renaming (which frees the old name) and the profile update happen in one batch.
  - Accounts from before usernames, and new accounts, claim their personal ID as username on first open. Following by a personal ID typed directly keeps working.
- **Password**: the owner stores `sha256("<pid>:<password>")` in `users/{pid}/private/auth`, which only the owner can read. To subscribe, a client writes that same hash into `users/{pid}/subscribers/{uid}`. The rules only allow the write if it matches, so the password check happens inside Firestore. Changing the password does not remove existing subscribers.
- **Schedule model** (`shared/schedule.ts`, used by both the app and the Worker): a pack is `pillsPerPack` pills (the last `placebo` of them placebo, still taken daily), then `breakDays` pill-free days, and the next pack starts automatically. Pills are tied to calendar days like a real blister: `packStart` anchors pack 1, and `takenDays` maps each marked day to the time it was marked. A past day marked afterwards stores no time. Days before `trackingSince` (the first setup) count as taken. Presets: 21+7 break, 24+4 placebo, 21+7 placebo, 28 continuous, 84+7 break, or custom.
- **Reminders**: on every change the app computes `nextReminderAt` and `nextLateAt` with the shared module. The Worker sends due moments and moves them forward:
  - The owner gets the reminder at the set time, repeated every 15/30/60 minutes until marked (at most 8 times, same day only), with a "Taken" button. The button works on Android and in desktop/Android browsers; iPhone home-screen apps show no buttons.
  - Followers get the first reminder.
  - Followers also get "not taken yet" 30 min, 1 h or 2 h after the set time.
  - Nothing is sent on pill-free days or once the pill is marked.
- **Taken**: marking today's pill sets `takenPending`. Within a minute the Worker tells followers "took today's pill at HH:MM", then clears the flag. Undo is possible, and any past pill day can be corrected from the blister or the history calendar.
- **Seen** (like a read receipt): followers confirm they've seen that today's pill was taken, with the button next to "Taken at …" on the followed schedule or "Mark as seen" on the notification (Android, and desktop/Android browsers; category `seen`). It writes `users/{pid}/seen/{followerUid}` = `{ day, at, name? }` (`name`: the follower's chosen username, else their schedule name). The owner's hero shows "Seen at 13:40" or "Seen by Bob · 13:40". Unfollowing removes it.
- **Marking a pill** always asks "Just now" or "Earlier…" (time picker capped at the current time; past days can also be saved without a time). This applies to the home screen, the wizard, the blister, the calendar and the notification's "Taken" button, which opens this sheet.
- **UI**: design tokens in `src/theme.ts` (colors, gradients, Plus Jakarta Sans, shadows). Shared components are in `src/ui.tsx`. In-app bottom sheets and toasts (`src/sheets.tsx`) replace system alerts on every platform. Icons are Lucide.
- **Supplies & appointments**: "unopened packs at home" is stored as `supplyPacks`/`supplyFrom`. The owner gets a refill notice when the last pack starts, and an appointment notice the day before at the reminder time. Both use `nextNoticeAt`, which the Worker's fourth job processes.
- **Own reminder text**: `reminderText` (up to 64 characters, emoji allowed) replaces the owner's reminder wording and becomes the notification title.
- **Starting a pack early** (to delay a period, on medical advice): moves `packStart` and keeps the old start in `earlierPackStarts`, so past days keep their pack position.
- **Daily notes**: a mood and free text per day in `users/{pid}/notes/shared` (followers can read it) or `notes/private` (owner only, enforced by the rules). Accounts without a contraception plan have the notes card on the home screen too ("All my notes" opens the calendar of notes), and their followers see the shared notes.
- **Export** (Account → "Export my data", or from the history): the own daily data for a period (7 days to 12 months, or custom) as **PDF** or **CSV**, with a choice of columns: date, mood, note, and with a plan what was due, taken/done (`[x]`/`[ ]`), time (with the day if done late), remark (missed, late, new pack), cycle position and the doctor's appointment. `src/export.ts` builds the rows, CSV (BOM; `;` in German) and a printable HTML table (A4, landscape with many columns, wide note column, repeating header). Android/iOS: `expo-print` turns it into a PDF and `expo-sharing` opens the share sheet (`src/exportFile.ts`). Web: CSV download, PDF via the browser's print dialog (`src/exportFile.web.ts`). Nothing leaves the device unless the user shares the file.
- **Travelling**: when the device's time zone differs from the schedule's, a notice shows both times. "Use local time" switches `tz`; "Keep home time" is remembered per zone pair.
- **Dark mode**: follows the system, with an override (System/Light/Dark) in Account. Palettes live in `src/theme.ts`, and style sheets use `themedStyles(...)` so they rebuild on a switch.
- **Pushes** are data-only FCM messages. The Android app (`expo-notifications`) and `public/firebase-messaging-sw.js` build the notification from `title`, `message`, `categoryId` and `body`.
- **Languages**: English and German (`src/i18n.ts`). The device or browser language is the default, and the EN/DE switch on the home screen overrides it. The choice is stored on the account (`accounts/{uid}.lang`), so the Worker sends push notifications in that language too.
- **Offline**: marking a pill taken, editing the schedule and changing the password update the screen immediately. Firestore syncs them once the device is back online. Only subscribing waits for the server, because the server checks the password. Subscribing is one atomic batch.
- Data per day is a couple of small field writes, well inside Spark's limits. The Worker's queries cost about 2,900 Firestore reads a day; the free limit is 50,000.

Why a Worker? Spark can't run Cloud Functions, and sending FCM needs a server holding the service-account key. The Cloudflare Workers free plan includes cron triggers.

## Patch, ring and injection

The schedule can be for the pill, the patch, the vaginal ring or the injection (`users/{pid}.method`; missing means pill). The wizard's first step picks the method. All four use the same cycle model in `shared/schedule.ts`, so reminders, follower notices, "seen", history and supplies work for each of them:

| Method | `pillsPerPack` + `breakDays` | Actions (`actionOn`) | Open after the day (`CARRY_DAYS`) | Follower alert (`LATE_DAYS`) |
|---|---|---|---|---|
| Pill | as before | every pill day | 0 (missed) | 30 min – 2 h |
| Patch | 21 + 7, or 42 + 7 (6 in a row) | new patch on day 0, change every 7 days, off after the wear weeks | 6 days | after 1 day |
| Ring | 21 + 7, or 21 + 0 | new ring on day 0, out on day 21 | 6 days | after 1 day |
| Injection | 56, 84 or 91 + 0 | injection on day 0 | 28 days | after 7 days |

- **An action stays open** until it's marked done. The owner's reminder comes back every day at the reminder time ("Patch change overdue · 1 day late"), followers get one alert after `LATE_DAYS`, and a follower reminder only on the scheduled day.
- **Done on another day:** `takenDays[scheduledDay]` = `"YYYY-MM-DDTHH:MM"` (done day and time) instead of `"HH:MM"`. A cycle start (new patch, new ring, injection) done late or early starts the cycle on that day instead: its day becomes the new `packStart` and the old one moves to `earlierPackStarts` (`withAction`, `movedTo`). A late patch change in mid-cycle keeps the change weekday. An injection can be given from 2 weeks before it's due.
- **Rules shown when late** (`lateness`, texts `lateRules` in `src/i18n.ts`), from familienplanung.de (linked in the app, with "your leaflet and your doctor know best"):
  - Patch change under 48 h late: still protected; over 48 h: 7 days extra contraception; first patch late: the change day moves; removal up to 7 days late: still protected.
  - Ring: new ring more than 3 h late: insert now, extra contraception advised; left in up to 7 days longer: still protected; more than 4 weeks in a row: not protected.
  - Injection (12-week type): earliest week 10, latest week 14, after that protection isn't certain. A hint after about 2 years of use.
- **Views** (`src/methods/`): `PatchStrip` (one tile per week), `RingDial` (a dial of the cycle's days), `InjectionWindow` (earliest / due / latest bar with today's position). The hero (`MethodSchedule`) shows the next action, its button opens `openActionSheet` ("Just now", or an earlier day and time; change or undo). Followers see the same view read-only and a badge per method.
- **Setup:** the injection asks for the date of the last one. Tracking starts there, so an injection that's already overdue shows as open.
- **History** marks only action days (done, late in amber, missed) and tints the days in between (patch on / ring in).
- **Worker:** texts per action in English and German, the button "Done ✓" (notification category `action`), and for the injection a notice 7 days before it's due ("book your appointment", `noticesAt` kind `injection`). Supplies count cycles for patch and ring; the injection has no supply row.

## Web hosting and stale pages

Firebase Hosting has no catch-all rewrite (the app has a single page, `/`), so a script that no longer exists is a 404 instead of `index.html`. `/` and `/index.html` are never cached, while the content-hashed files under `/_expo/` and `/assets/` are cached for a year. `public/index.html` shows a start screen in plain HTML (icon and spinner) until the app calls `bbStarted()`. It reloads itself once if the app script fails to load or run (a stale cached page after an update), and after 10 seconds without a start it shows the error and a reload button. The app waits at most 3 seconds for its fonts and then starts with system fonts, and `ErrorBoundary` shows the error message with a reload button instead of an empty screen.

## Nyxi, the kitten mascot

Nyxi, a small kitten (white, red sweater with a heart), lives on the home screen and introduces itself on the first open. Code in `src/mascot/`:
- `art.tsx`: the drawing, split into parts (tail, legs, body, paws, collar, ears, head, eyes, muzzle) that share one 200×236 box.
- `Kitten.tsx`: the puppet. Each part sits on its own `Animated.View` with a pivot (`transformOrigin`), so blinking, breathing, the tail, ear twitches, walking and climbing run on the native animation driver.
- `world.tsx`: where it lives.
  - Home blocks are wrapped in `<MascotSpot>`, which reports their position and has a "room" (zero height) above them.
  - When the kitten settles, that room opens and pushes the cards below aside. The kitten and its speech bubble sit in it, on the card's top edge, so they never cover anything and scroll with the page.
  - On its way somewhere it moves on a layer in front of the cards, or behind them when it sneaks. That layer is clamped to the visible part of the page, so while you scroll it clings to the screen edge, then climbs to a room in view.
  - It only speaks where the whole bubble fits on screen.
  - If it ever fails to render, the home screen continues without it.
- `brain.ts`: pure logic, unit-tested in `scripts/test-mascot.ts`. Decides what it says, by priority:
  - today's pill reminder (own schedule, after the reminder time; "Later" snoozes 30 min)
  - a greeting on the first open of the day (an introduction the very first time)
  - "How are you feeling?" once a day without a note, which leads to the note card
  - good night once per evening from 21:00, after the mood question
  - Greetings, the celebration after the pill, good night and petting come from pools of lines in English and German (`mascotGreet`, `mascotYay`, `mascotPurr` in `src/i18n.ts`). About half the time Nyxi uses the variant with your username, but only if you chose one; the automatic personal ID isn't used as a name.
  - one automatic health fact a day, unless you already got one; more on request ("Another one", or a tap). After you decline one, Nyxi offers again on every third tap.
  - Bubbles are built from the current language, so an open one follows the EN/DE switch.
  - It celebrates when today's pill gets marked, and naps after 2 minutes alone.
- `facts.ts`: the facts in English and German, each with its source (NHS, WHO, gesund.bund.de, familienplanung.de, RKI, OHSU) and a **tag** (a subject slug). The database is meant to keep growing:
  - [docs/mascot-facts-index.md](docs/mascot-facts-index.md) is a short lookup table of all tags per topic. Read it to see what's covered; no need to read the facts. Near-duplicates are fine.
  - `node scripts/facts-index.ts` validates the facts (both languages, bubble length, https source, no identical text twice) and regenerates the index and [docs/mascot-facts.md](docs/mascot-facts.md) (the full list for review). `node scripts/facts-index.ts find <word>` searches; `--check` is for CI.
  - Adding a fact is described at the top of the index.
  - Finding the fact behind a bubble (e.g. to fix a translation): each shown fact is logged in the browser console as `[Nyxi] fact FACTS[79] tag "uti-dont-hold"`, and `nyxiFact` in the console holds the current one. Search facts.ts for the tag, edit `en`/`de`, then run `node scripts/facts-index.ts`. Android apps get new facts with the next release; the web app with the next deploy.
- `store.ts`: per-device settings (Account → Nyxi: show it, health facts) and memory (facts shown, daily counters), in AsyncStorage.
- Reduced motion (system setting): it sits still.

## End-to-end encryption

Notes (shared and private), the appointment note and the owner's stored sharing password are encrypted on the device: AES-256-GCM, `v1:` format in `src/crypto.ts`, with `@noble` libraries that work the same in Hermes and browsers. Neither Google nor anyone holding the service-account key can read them.
- **Data key** (per account): wrapped twice in `accounts/{uid}.keyring`: with PBKDF2(account password) and with PBKDF2(recovery code). The recovery code is shown once, at registration or later via Account → "Create a new recovery code". The unlocked key is cached on the device: Android Keystore via `expo-secure-store`, browser storage on the web. A new device unlocks with the login password; a device without a cached key shows the unlock screen once.
- **Forgot password:** after a reset, the keyring opens only with the recovery code, which re-wraps it for the new password. Without the code, "Start fresh" creates a new key, and old encrypted data becomes unreadable.
- **Share key** (per schedule): encrypts shared notes. Followers receive it through `users/{pid}.shareKeyWrap` (wrapped with PBKDF2(sharing password)) and keep it in their own keyring. Changing the sharing password re-wraps the same key, so existing followers keep reading.
- **Following:** a follower presents `accessKeyFor(pid, password)` (PBKDF2). The security rules compare it to `private/auth.key`.
- **Migration:** at the first unlock after the update, plain-text data from before gets encrypted (`migrateToEncryption`).
- **Stays readable for the server** (the Worker needs it): taken days and times, pack layout, reminder time and zone, supply, appointment date, the custom reminder text, the schedule name. Push texts to followers also pass through FCM in plain text.

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

The script bumps `version` and `android.versionCode` in `app.json`, builds the APK on EAS (and waits), and checks that its download link delivers an APK. It writes `android/latest.json` (version and link) to `public/android/` and deploys Firebase Hosting. The APK itself stays on Expo's servers, because Firebase Hosting's free plan rejects executable files.

Installed apps check `latest.json` on start (at most every 6 hours), or via Account → "Check for updates". When a higher `versionCode` is available, the app shows "Version x is available · Update app": it downloads the APK with progress and opens the Android installer. Because every build is signed with the same EAS key, the update installs in place and keeps the login and all app data. The first time, Android asks to allow installs from Blister Buddy.

Notes:
- Expo doesn't document how long build downloads stay available. If an old link stops working, a new release fixes it.
- Commit the bumped `app.json` after a release.

## Development

```sh
npm install
npm run web          # http://localhost:8081
npm run typecheck
node --env-file=.env scripts/test-rules.mjs   # live security-rules test (creates & deletes throwaway @example.com users)
node scripts/test-schedule.ts                 # unit tests for shared/schedule.ts (packs, breaks, DST, repeats, late alerts)
node scripts/test-mascot.ts                   # unit tests for the kitten's logic (src/mascot/brain.ts)
npx tsx scripts/test-export.ts               # unit tests for the export (rows per method, CSV, PDF table)
node scripts/facts-index.ts --check          # validates the kitten's facts and checks the generated fact docs are current
cd worker && npm run dev                      # local worker; trigger with curl "http://localhost:8787/__scheduled"
                                              # needs worker/.dev.vars: SERVICE_ACCOUNT_JSON='<json on one line>' 
```

The old manually created doc `schedules/SveaBlisters` is not used. The rules leave it inaccessible to clients.
