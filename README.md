# Payout

A small installable web app that estimates what each deal pays under a tiered
quota plan. It lives in [`payout/`](payout/) and is served by GitHub Pages.

- **No plan details in this repo.** Rates, thresholds and labels load from a
  private setup code pasted into the app. The code is never committed.
- **Works offline.** A service worker caches the app; data is kept on the device.
- **Optional sync.** Add a Firebase web config to `payout/firebase-config.js`
  to sign in and keep devices in step. Each person can read and write only
  their own document (`firestore.rules`).

## Firebase setup (for sync)

1. Create a project at console.firebase.google.com (Analytics not needed).
2. Authentication → Get started → Email/Password → Enable.
3. Firestore Database → Create database → Production mode. Then Rules → paste
   `firestore.rules` → Publish.
4. Project settings → Your apps → Web → register an app and copy its
   `firebaseConfig` into `payout/firebase-config.js` as the default export.

## Deploying

Settings → Pages → Build and deployment → Deploy from a branch → `main` / root.
Bump `VERSION` in `payout/sw.js` when you change files so installed copies update.
