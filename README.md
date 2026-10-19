# Blister Buddy

A private iOS, Android, and Chrome app for a small circle. Firebase Anonymous Authentication identifies each user, Firebase Cloud Messaging sends mobile notifications, and a Cloudflare Worker plus D1 provide the authenticated API and daily reminder job. This avoids deploying Firebase Cloud Functions, which requires Firebase Blaze.

## Firebase setup (Spark)

1. In Firebase, keep **Authentication → Anonymous** enabled. FCM and Firebase Authentication are available on the no-cost Spark plan.
2. The Android and iOS app identifiers are both `com.example.blisterbuddy`. `app.json` already points at the root `google-services.json` and `GoogleService-Info.plist` files.
3. Register a Firebase Web app and copy its values into `.env` using `.env.example` as the template. `EXPO_PUBLIC_API_BASE_URL` is filled in after the Worker is deployed.
4. Configure APNs credentials under Firebase Project settings → Cloud Messaging to deliver notifications to iOS.

The app no longer calls Firebase Cloud Functions or reads Firestore. The manually created Firestore document `schedules/SveaBlisters` is left untouched, but it is not imported into the app. Schedules, password hashes, subscriptions, and FCM tokens are stored in Cloudflare D1 instead.

## Set up the free Cloudflare API

Create a Cloudflare account on its Free plan, then from this project folder:

```sh
cd worker
npm install
npx wrangler login
npx wrangler d1 create blister-buddy
```

Copy the `database_id` printed by Wrangler into `worker/wrangler.toml`, replacing `REPLACE_WITH_D1_DATABASE_ID`. Then create the database tables:

```sh
npm run db:migrate:remote
```

The Worker verifies Firebase ID tokens against the Firebase project and sends FCM messages with the Firebase HTTP v1 API. It needs three secrets:

- `FIREBASE_API_KEY`: the web app API key from `.env`.
- `FCM_SERVICE_ACCOUNT_JSON`: a Firebase service account JSON key. Create it in Firebase Project settings → Service accounts. Grant that service account the **Firebase Cloud Messaging API Admin** role in Google Cloud IAM. Paste the full JSON as the value when Wrangler prompts.
- `PASSWORD_PEPPER`: a random private value used to hash schedule passwords. Generate one locally (for example, `openssl rand -base64 32`) and paste it into Wrangler’s prompt. Do not commit or share it.

Set each secret from `worker/`:

```sh
npx wrangler secret put FIREBASE_API_KEY
npx wrangler secret put FCM_SERVICE_ACCOUNT_JSON
npx wrangler secret put PASSWORD_PEPPER
npx wrangler deploy
```

Wrangler prints the deployed Worker URL. Put that URL in the root `.env` as `EXPO_PUBLIC_API_BASE_URL`, then restart Expo. The Worker cron trigger runs once per minute and sends the owner and subscribers a reminder unless the pill was marked taken that day.

Cloudflare’s current Free limits include 100,000 Worker requests per day and 5 million D1 row reads plus 100,000 writes per day. If D1 reaches its daily limit, queries stop until the quota resets; no automatic overage charge is applied on the Free plan. Limits and plan terms can change, so check Cloudflare’s current pricing before relying on them.

## Test in Chrome

After setting `.env` and deploying the Worker:

```sh
# From the project root
npm install
npm run web
```

Open the localhost URL printed by Expo. Chrome can test sign-in, schedule creation, subscriptions, and API calls. Browser push is not implemented; mobile FCM notifications are supported.

## Build for phones

FCM uses native code, so Expo Go is not sufficient. Build a development app or run locally:

```sh
npx expo run:android
npx expo run:ios
```

For private distribution, use `eas build --profile preview --platform all`. The Android preview is an APK. iOS internal distribution requires Apple signing credentials and registered devices; neither needs an app-store release.

## Data and behavior

- Anonymous Firebase identity persists on the device. Removing the app or its local data may lose that identity.
- Schedule passwords are stored as keyed hashes in D1. Changing a password does not remove existing subscribers.
- Marking a pill taken notifies subscribers only. The scheduled reminder goes to the owner and subscribers if that day is not already marked taken.
- Reminder times use the device time zone saved with the schedule.
- Pack progress is a visual count; the app does not infer missed doses or give medical guidance.
