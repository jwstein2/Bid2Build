# Built2Bid for Android (crew time clock)

James chose **Google only** (2026-11-21): there is no iPhone app. The Android app lives in `android/`.

## What it is

- A small native shell around the live site (`https://built2bid.org`). Every screen, rule and sign-in is the web app,
  so a site deploy updates the app without a Play release. It opens on **My work / time clock** (`/clock`).
- **Native geofencing** (Google Play services `GeofencingClient`) for automatic clock-in/out at assigned sites,
  which keeps working when the app is closed. This is the one thing the web app can't do.
- Plain Kotlin, no Capacitor/npm dependency. Package `org.built2bid.app`, min Android 10 (API 29), target API 36.

## How background clock-in works

1. On `/clock`, once the company turned automatic clock-in on and the employee agreed to the notice, the page hands
   today's assigned sites (centre + radius), the dwell/grace times and the accuracy limit to the app through
   `window.Built2BidNative` (`src/lib/workforce/gps/native.ts`). The bridge is only exposed to the Built2Bid origin,
   main frame (`WebViewCompat.addWebMessageListener`).
2. The app shows Google Play's required **prominent disclosure**, then asks for location, then "Allow all the time",
   then notifications.
3. Android reports ENTER, DWELL (still inside after the dwell time) and EXIT. The app sends the existing contract
   `POST /api/workforce/gps/me {action:"event", source:"native_android", clientEventId, ...}`, signed in with the
   WebView's own session cookie. Events go out one at a time in order, retry offline for up to 23 h, and keep the
   session cookie refreshed. An EXIT schedules `exit_confirmed` after the grace time; arriving again cancels it.
4. If Android's reading wouldn't pass the server's accuracy rule, the app takes one fresh high-accuracy fix first.
   Only distance and accuracy are sent, never coordinates (same privacy rule as the web clock).
5. Server replies with a message ("Clocked in — Smith deck") become Android notifications that open the time clock.
6. Turning automatic clock-in off on the page (or the company turning it off) removes every geofence.
7. Geofences are re-registered after a reboot, an app update, or when location comes back on.

Known limits (v1):
- Sites refresh when the employee opens the time clock. Yesterday's sites can stay fenced until then; the server
  ignores events at sites not assigned that day (`ignored_not_assigned`), so nothing wrong is recorded.
- If the company uses **"ask before clock-in"**, the question arrives as a notification; the employee taps it and
  uses **Clock in**. Auto clock-in works without opening the app.
- Some phone brands kill background apps. The time clock links to the battery setting ("Unrestricted").
- Android delivers geofence alerts about 1–3 minutes late, longer in deep sleep. Radius 100–150 m works best.

## Build

```bash
cd android
echo "sdk.dir=/path/to/Android/Sdk" > local.properties   # or set ANDROID_HOME
./gradlew assembleDebug          # app/build/outputs/apk/debug/app-debug.apk (sideload for testing)
./gradlew bundleRelease          # app/build/outputs/bundle/release/app-release.aab (upload to Play)
./gradlew assembleDebug -PbaseUrl=https://staging.example   # point a test build at another site
```

CI: `.github/workflows/android.yml` builds the debug APK and runs Android lint on every PR touching `android/`.

### Release signing (one time, James or a trusted machine)

Use **Play App Signing** (Play Console default). Create an upload key and keep it out of git:

```bash
keytool -genkeypair -v -keystore built2bid-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
```

Then create `android/keystore.properties` (git-ignored):

```
storeFile=/absolute/path/built2bid-upload.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

or set `B2B_KEYSTORE_FILE`, `B2B_KEYSTORE_PASSWORD`, `B2B_KEY_ALIAS`, `B2B_KEY_PASSWORD`. Bump `B2B_VERSION_CODE`
(integer) for every upload.

## Real-phone test plan (before production)

Use a test company with automatic clock-in on, one W-2 staff member enrolled, and a site with a 150 m radius.

1. Install the debug APK, sign in with email code, open My work → agree to the notice → **Allow location** →
   disclosure → "While using" → "Allow all the time" → notifications. Badge shows "On, even when the app is closed".
2. Swipe the app away. Walk/drive into the site, wait the dwell time: notification "Clocked in — …", entry source GPS.
3. Leave the site past the grace time: "left" prompt or auto clock-out per company setting.
4. Airplane mode while arriving, then back online: the clock-in still lands with the arrival time.
5. Reboot inside the site, then leave: exit still recorded.
6. Turn off automatic clock-in on the page: no more events (check `pm_geofence_events`).
7. Deny "all the time": badge "Needs “Allow all the time”", manual Clock in still works.

Store listing, Data safety answers and the background-location declaration: [PLAY_LISTING.md](PLAY_LISTING.md).
