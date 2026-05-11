# APS Mobile — Store Release Guide

Walks you through publishing the Expo app to **Apple App Store** and **Google Play Store** using EAS Build + EAS Submit.

---

## 1. Prerequisites (one-time)

### Apple
- Active Apple Developer Program membership ($99/yr)
- An App Store Connect record for **com.aps.autoservice**
- Your Apple Team ID (Apple Developer → Membership)

### Google
- Active Google Play Console account ($25 one-time)
- Created the **com.aps.autoservice** application in Play Console
- A Google Cloud service account JSON key for Play submissions
  (Play Console → Setup → API access → Create service account → grant `Release manager` role)
- Save the JSON to `artifacts/mobile/google-play-service-account.json`
  (already gitignored — DO NOT commit it)

### Expo
```bash
pnpm add -g eas-cli
eas login
cd artifacts/mobile
eas init        # creates the project on your Expo account
```
After `eas init`, copy the printed `projectId` into `app.json` →
`expo.extra.eas.projectId`, and the account name into `expo.owner`.

---

## 2. Fill in the TODOs

`app.json`:
- `expo.owner` — your Expo account name
- `expo.extra.eas.projectId` — from `eas init`

`eas.json` → `submit.production`:
- `ios.appleId`, `ios.ascAppId`, `ios.appleTeamId`
- `android.serviceAccountKeyPath` should already point to the JSON key
  you saved above

---

## 3. Required store assets

Drop production-grade assets into `artifacts/mobile/assets/images/` before
your first build and reference them from `app.json`:

| Asset | Size | Usage |
| --- | --- | --- |
| `icon.png` | 1024×1024, no transparency | App icon (already present) |
| `adaptive-icon.png` | 1024×1024 transparent foreground | Android adaptive icon foreground |
| `splash.png` | 1284×2778 | iOS splash |
| Feature graphic | 1024×500 | Play Store listing |
| Screenshots | iPhone 6.7" + 6.5" + Android phone | Both stores |

> The current config reuses `icon.png` for the adaptive-icon foreground
> and splash. Replace with proper assets before public launch.

---

## 4. Build

```bash
cd artifacts/mobile

# First-time iOS credentials (interactive — generates certs on Expo's servers)
eas credentials

# Production builds
eas build --platform ios       --profile production
eas build --platform android   --profile production

# Or both at once
eas build --platform all --profile production
```

The `production` profile uses `autoIncrement: true` so the iOS
`buildNumber` and Android `versionCode` are bumped server-side on every
build — you never have to remember to bump them manually.

---

## 5. Submit

```bash
eas submit --platform ios     --profile production --latest
eas submit --platform android --profile production --latest
```

`--latest` picks up the most recent successful production build.

The Android submit defaults to the **internal** track with
`releaseStatus: draft` so nothing goes live until you promote it inside
the Play Console. iOS submissions land in App Store Connect ready for
TestFlight or App Store Review.

---

## 6. Privacy & data safety declarations

Both stores require a privacy disclosure. APS collects:

- **Account**: email, name, phone, password (hashed)
- **Location** (foreground + background-during-active-jobs): match
  customers with mechanics, share live ETA
- **Camera + Photos**: attach photos to service requests / work logs
- **Device identifiers**: push notification token only
- **Payments**: handled exclusively by **Stripe** — APS never sees raw
  card data (declare "Payment info: not collected by app, handled by
  third party")

Privacy policy URL is **required**. Host it (Notion, Vercel, your
marketing site) and supply the URL when submitting.

---

## 7. Production environment variables

Update `eas.json` → `build.base.env.EXPO_PUBLIC_DOMAIN` to your
production API domain BEFORE building. The current placeholder is
`aps.replit.app` — change to whatever your deployed API serves on.

Do NOT put server secrets (DB URL, Stripe secret, JWT secret) here —
they belong in the API server's deployment env.

---

## 8. Common rejection causes (and how we already address them)

| Cause | Status |
| --- | --- |
| Missing iOS permission strings | ✅ All declared in `infoPlist` |
| Background location without justification | ✅ Used only during active jobs, justified in `NSLocationAlwaysAndWhenInUseUsageDescription` |
| Camera/photo without justification | ✅ Justified in `expo-image-picker` plugin strings |
| Encryption disclosure | ✅ `usesNonExemptEncryption: false` |
| Android target SDK below current | ✅ `targetSdkVersion: 35` |
| Crash on first launch | Mitigated by ErrorBoundary at the root |
| App tracking without ATT prompt | We don't track — no ATT needed |

---

## 9. Updates after first release

For JS-only changes you can ship over-the-air without going through
review:

```bash
eas update --channel production --message "Patch: fix login error"
```

For native changes (adding a new permission, a new native module, an
Expo SDK upgrade) you must rebuild and resubmit.
