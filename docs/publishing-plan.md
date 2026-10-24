# Publishing Blister Buddy: changes, costs and business estimate

*Status: analysis only, not decided (October 2026). Prices and benchmarks were checked then. Look them up again before acting.*

Blister Buddy was built for two people, on free tiers:
- Firebase Spark;
- Cloudflare Workers Free;
- an APK outside the Play Store;
- iPhone as a home-screen web app.

This document covers a public release on Google Play and the App Store:
1. What breaks at 3,000 daily users.
2. The minimal changes.
3. Running and fixed costs.
4. A rough business estimate (expected users, willingness to pay, ads).

**Assumptions:**
- 3,000 daily active users (DAU), split evenly across web, iPhone and Android.
- ~60 % own a plan (1,800 owners), ~40 % only follow; ~0.7 followers per owner.
- ~3 app opens a day; 2 reminder repeats on average; one release a month.
- The database is in **eur3** (Europe multi-region).

---

## 1. What breaks at 3,000 daily users

| Area | Today | At 3,000 DAU | Severity |
|---|---|---|---|
| **Firestore on Spark** | 50k reads, 20k writes and 1 GiB per day free. Beyond that the database stops for the rest of the day. | ~120k reads/day. The app would stop around midday from ~1,200 users. | Blocker |
| **Auth emails on Spark** | 150 password resets, 1,000 verification emails per day | A launch day with 1,000+ sign-ups hits the cap | High |
| **Worker on Workers Free** | At most 50 sub-requests and 10 ms CPU per run | Each reminder needs ~4–6 calls. At 20:00 hundreds of users share the default ":00" time. | Blocker |
| **Worker code** | Queries fetch at most 100 due docs (`limit: 100`) and process them one by one (`forEachDoc`) | Reminders arrive minutes late at peak times | Blocker |
| **Native iPhone app** | The Worker sends data-only pushes | On iOS these are silent; reminders would not appear | Blocker for iOS |
| **Android in the Play Store** | The app installs APKs itself (`src/update.ts`) | Play forbids self-updating; the app would be rejected | Blocker for Play |
| **Abuse protection** | Rules validate the data, but scripts can still make requests with the public config | Every read is billed | High |
| **Natural method (planned Step 2)** | Not built | A "fertile / not fertile" verdict is a medical device under EU MDR (Natural Cycles: class IIb). Can't be published without certification. | Legal blocker |

Everything else scales fine: Firestore itself, FCM, Auth, and Hosting with long caching.

## 2. Minimal changes for public use

**A. Scaling (required)**
1. Firebase **Blaze** plan with budget alerts (€5 / €20 / €50).
2. **Cloudflare Workers Paid** ($5/month): 10,000 sub-requests and 30 s CPU per run.
3. **Worker:**
   - page through due docs instead of `limit: 100`;
   - process them in parallel with a limit (~20);
   - batch device lookups per run;
   - keep each run under a minute (`patchIfUnchanged` already prevents duplicates).
4. Remove `takenDays` from Firestore indexing (an index exemption).

**B. App Store / Play Store (required)**
5. **iOS pushes:**
   - send a visible notification / APNs alert in addition to the data;
   - register the APNs key in Firebase;
   - iOS notification categories ("Taken", "Done", "Mark as seen").
6. **Store builds:**
   - an Android AAB;
   - the in-app updater only for the sideloaded APK;
   - an iOS build via EAS.
7. **Store requirements:**
   - privacy policy and Impressum (URL plus a link in the app);
   - an account deletion page on the web (Play requires a URL; in-app deletion already exists);
   - Data safety (Play) and privacy labels (Apple);
   - Play's health apps declaration;
   - screenshots and texts in EN/DE;
   - **new personal Play accounts:** a closed test with 12 testers for 14 days.
8. **Health data and GDPR (Art. 9):**
   - explicit consent at registration;
   - age limit 16+;
   - processing agreements with Google and Cloudflare (free, online);
   - ideally a short data protection impact assessment (DPIA).

**C. Strongly recommended**
9. **Firebase App Check** (Play Integrity, App Attest, reCAPTCHA; free) against abuse bills.
10. **Medical claims:**
    - keep "you're still protected" strictly as sourced information, and have it checked once;
    - don't publish a fertile/infertile verdict (a diary without a verdict is fine).
11. Crash reports (e.g. Sentry free tier) and a support address.

Effort for A–C (excluding legal texts and store listings): ~2–4 days of development.

---

## 3. Running costs per month

**Firestore (eur3)**
- Prices: reads ~$0.06, writes ~$0.18, deletes ~$0.02 per 100k; storage ~$0.18/GiB.
- Free every day: 50k reads, 20k writes, 1 GiB.
- These prices come from third-party sources; Google's table didn't load at the time. Check before switching.

| Item (3,000 DAU) | Per day | Per month (billable) | Cost |
|---|---|---|---|
| Reads: app (~30 per user/day incl. listener updates) | ~90k | | |
| Reads: Worker (empty queries ~5.8k + ~16 per owner) | ~30k | | |
| **Reads total** | ~120k | ~2.1M above free | **~$1.30** |
| Writes (~6.6 per owner, seen, notes, tokens) | ~13k | under the free 20k/day | **$0** |
| Storage (< 200 MB) | | under 1 GiB | **$0** |

| Service | Plan | 3,000 DAU | 10,000 DAU | 30,000 DAU |
|---|---|---|---|---|
| Firestore | Blaze | ~$1–3 | ~$8 | ~$35 |
| Hosting (web: 5.7 MB per new install/update) | 360 MB/day free, then $0.15/GB | ~$1 | ~$7 | ~$25 |
| Firebase Auth (email/password) | free up to 50k MAU | $0 | $0 | $0 |
| FCM, App Check | free | $0 | $0 | $0 |
| Cloudflare Worker | Workers Paid | $5 | $5 | $5 (+ CPU) |
| Expo EAS builds | Free: 30 builds/month | $0 | $0 (or Starter ~$19) | ~$19 |
| Domain + mail forwarding | | ~€1 | ~€1 | ~€1 |
| **Total infrastructure** | | **~€7–10** | **~€20 (€40 with EAS Starter)** | **~€85** |

Usage-based costs can be 2–3× higher with heavier usage. 3,000 DAU stays under €20 a month either way.

### Store and fixed costs

| Item | Cost |
|---|---|
| Google Play developer account | $25 once |
| Apple Developer Program | $99/year (~€8.25/month) |
| Store commission (only if you sell) | 15 % up to $1M/year (Apple Small Business Program is opt-in) |
| Privacy policy / Impressum | free generator, or a subscription ~€10–25/month, or a one-off lawyer review ~€500–1,500 |
| Liability / cyber insurance (optional) | ~€100–300/year |
| Natural method with a verdict as a medical device (CE, MDR IIb) | six figures and years. Not realistic. |

---

## 4. Business estimate

### Market
- **Germany:** 38 % of sexually active adults aged 18–49 use the pill (BZgA 2023; falling, 2007: 55 %). That's roughly 5–6 million users, plus patch, ring and injection users.

| Competitor | Downloads | Model |
|---|---|---|
| Lady Pill Reminder | 1M+ (Play), 4.8★ from 89k reviews, ~140 downloads/day | free + Pro |
| myPill | ~2.5M | free + purchase |
| Flo / Clue | tens of millions | subscriptions ~€40–60/year, large marketing budgets |
| Natural Cycles | certified medical device | ~€100/year |

- **Rare in Blister Buddy:**
  - partner following with "seen" and follower alerts;
  - pill, patch, ring and injection in one app;
  - Nyxi.
- **Built-in virality:** ×1.5–2 users per owner (the partner follows).

### Launch with friends and family, plus ~500 Instagram followers (no ad budget)

| Source | Heuristic | Installs |
|---|---|---|
| Instagram (stories + a post, repeated) | 20–35 % see a story, ~5–15 % of viewers tap the link, ~50 % install, only part of the audience is relevant | 10–40 |
| Friends and family, asked directly | | 10–30 |
| Partners via following | ×1.5–2 | +10–50 |
| Organic store search (new app, no reviews) | 0–3/day in year 1 | ~100–1,000/year |
| **Year 1 total** | | **~150–1,100** |

- **Retention:** health apps keep ~3–7 % of installs after 30 days (median). A daily reminder with a partner should do better: assume 10–25 %.
- **Active users:** ~20–250 after year 1, ~100–600 after 3 years.
- **3,000 DAU isn't realistic without marketing.** Below ~1,000 DAU Firestore stays practically free.
- The Worker needs Workers Paid once ~50–100 owners share a reminder time (or spread sends over several runs).

### Willingness to pay
- **Install to paid** (RevenueCat):
  - freemium, all categories: ~2.2 % median;
  - Health & Fitness, within 35 days: ~2.9 % median, top quartile > 6 % (mostly subscriptions with paywalls);
  - an optional €2.99 "supporter" purchase in a free app: realistically 0.5–2 %.
- **Net per €2.99 sale:** minus 19 % VAT, so €2.51; minus 15 % fee, so **~€2.14**.
- The market is "winner takes most". Successful pill reminders are free with Pro and took years and many reviews.

### Advertising
- **Install price** in Germany for Health & Fitness: iOS ~$2–6, Android ~$1–3; blended ~€2–3.
- **Cost per sale:** at 1–2 % conversion, €100–300 of ads per sale, which earns €2.14.
- **For 8–15 sales a month:** ~400–1,500 extra installs, i.e. €800–4,000 ad spend a month for ~€17–32 revenue.
- **Don't use paid ads.** Only free channels: content, forums, reviews, store optimization.

### 3-year comparison (organic, no ads, ~1–3 supporter sales/month)

| Variant | Fixed costs over 3 years | Revenue (est.) | Result |
|---|---|---|---|
| **A: Google Play + web app for iPhone** | Play $25 + domain ~€36 + Worker from about year 2 ~€120 ≈ €180 | €75–230 | **−€100 to +€50** |
| **B: Play + App Store** | A + Apple 3 × €99 ≈ €480 | €100–300 | **−€380 to −€180** |
| **C: stay private** | €0 | €0 | €0 |
| With a one-off lawyer review | + €500–1,500 | | lower accordingly |

### Hidden requirements once you sell anything (Germany / EU)
- **Public address:**
  - Google Play shows the developer address publicly when you monetize;
  - the EU Digital Services Act requires "trader" details on both stores;
  - the Impressum requires an address;
  - a postal address service costs ~€5–15/month if you don't want your home address published.
- **Business registration** (~€20–60) and declaring the income. The small-business VAT exemption (Kleinunternehmer) is possible.
- **Completely free (donations only):** lighter. A privacy policy is still required.

## Recommendation
1. **Start with variant A:** free on Google Play, plus the web app (iPhones use the home-screen web app). Optional supporter purchase or donation link. About €25 once + ~€1–5/month.
2. **Measure for 3 months:** installs a month, users still active after 30 days, sales a month.
3. **Add the App Store only if** there are reliably ≥ 7 sales a month or ≥ 300 active users.
4. **No paid advertising.**
5. The expected loss after 2–3 years is ~€0–150 (A) versus €200–400 (B). The bigger risk is legal (health data, privacy policy, Impressum), not the servers.

## Next steps (if you decide to publish; variant A first)
1. Blaze with budget alerts. Workers Paid only once the Worker hits its limits.
2. Worker: paging, parallel processing, APNs alert.
3. App Check; a Play build without the in-app updater (iOS build only for variant B).
4. Consent and age limit, privacy policy, Impressum, account deletion page.
5. Store listing, Play closed test (14 days).
6. Step 2 (natural method) only as a diary without a verdict.

**How to check the estimates:**
- **Worker load test:** a local simulation with 3,000 fake schedules (like the earlier `worker-sim`): 500 reminders at 20:00 within the same minute, with a count of sub-requests and CPU.
- **Usage:** measure Firestore usage over a week in the Firebase console.
- **Prices:** look up eur3 prices on the official page.

## Sources
- [Firebase pricing](https://firebase.google.com/pricing)
- [Firestore pricing](https://cloud.google.com/firestore/pricing)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Firebase Auth limits](https://firebase.google.com/docs/auth/limits)
- [Firestore locations](https://firebase.google.com/docs/firestore/locations)
- [BudgetForge: Firebase pricing 2026](https://www.budgetforge.dev/tools/firebase-pricing-2026)
- [SplitMetrics: store fees](https://splitmetrics.com/blog/google-play-apple-app-store-fees/)
- [d-tt: store commissions](https://www.d-tt.nl/en/articles/app-store-commissions-how-much-do-you-pay-apple-and-google-and-how-can-you-keep-costs-down)
- [BZgA: contraception behaviour 2023](https://bzga.de/fileadmin/user_upload/PDF/pressemitteilungen/2023/23_11_16_PM_BZgA-Studiendaten_Verhütungsverhalten_2023.pdf)
- [Lady Pill Reminder (Google Play)](https://play.google.com/store/apps/details?id=com.baviux.pillreminder&hl=en)
- [Lady Pill Reminder (AppBrain)](https://www.appbrain.com/app/lady-pill-reminder/com.baviux.pillreminder)
- [myPill](https://mwm.ai/apps/mypill-birth-control-reminder/425632209)
- [RevenueCat State of Subscription Apps 2025](https://www.revenuecat.com/state-of-subscription-apps-2025)
- [Sahha: health app conversion](https://sahha.ai/blog/health-app-monetization-first-month/)
- [Adapty: Health & Fitness benchmarks](https://adapty.io/blog/health-fitness-app-subscription-benchmarks/)
- [ad-stack: CPI 2026](https://www.ad-stack.ai/blog/cpi-benchmarks-mobile-apps-2026/)
- [Mapendo: CPI by country](https://mapendo.co/blog/cost-per-install-by-country-2025)
- [MarTech: story link rates](https://martech.org/instagram-story-links-get-15-25-swipe-rates-brands-publishers/)
- [JMIR: app retention](https://preprints.jmir.org/preprint/14567)
- [Adjust: retention benchmarks](https://www.adjust.com/blog/get-the-mobile-app-retention-benchmarks-for-2023/)
