# rea

**Say a sale out loud. Get a bill and a customer ledger.**

```
"Sharma ji took 20 kg onion at 30, paid 400"
        ↓
Sharma ji · Onion 20 kg × ₹30 = ₹600 · Paid ₹400 · Due ₹200
```

Built for small shops that run on *udhar* (credit): the kirana, dairy, tailor, tiffin or
hardware shop where the owner is too busy to type a bill. It understands Marathi, Hindi and
English mixed together, in Latin or Devanagari script.

It is a plain static web app (PWA). No backend, no account, no build step. Your ledger is
stored on the phone.

## Try it

```bash
npm start          # serves http://localhost:8080
npm test           # 28 tests for the parser and the ledger
```

Open it on a phone and use "Add to Home screen" to install it. To publish it free, turn on
GitHub Pages for this repo (Settings → Pages → Deploy from branch → `main` / root).

## Android app (APK)

Every push to `main` builds an installable Android app with GitHub Actions
(`.github/workflows/android-apk.yml`). To get it:

1. Open the **Releases** page of this repo and pick **rea Android app (latest build)** (tag `apk-latest`).
2. Download the `.apk` on your phone and open it. Android will ask to allow "install unknown apps" once.

To rebuild without changing code: **Actions → Build Android APK → Run workflow**. The same file is also kept for 90 days under that run's **Artifacts**.

The app is the same web app wrapped with [Capacitor](https://capacitorjs.com). Inside the app:
voice uses the phone's own speech recogniser (microphone permission is asked on first use),
backups open the Android share sheet, and WhatsApp links open in the browser or WhatsApp.
The Print / PDF button is hidden there. It is a debug-signed build for your own use, not a Play Store release.

## What it understands

| You say | rea reads |
| --- | --- |
| `Sharma ji took 20 kg onion at 30, paid 400` | customer, item, qty, rate, payment |
| `Sharma ji ne 20 kilo pyaz 30 rupaye kilo liya, 400 diye` | the same, in Hindi word order |
| `Patil kaka ni 10 kilo kanda 25 rate ne ghetla, 100 dile` | Marathi |
| `शर्मा जी ने २० किलो प्याज ३० रुपये किलो लिया ४०० दिए` | Devanagari script and digits |
| `Raj took 500 g sugar at 45 per kg` | grams → 0.5 kg |
| `Ravi took half kg sugar at 44 and dedh kilo dal at 120` | half, dedh, dhai, sawa |
| `Meena took 3 soap for 60` | line total instead of rate |
| `Sunita took 3 dozen eggs at 70 udhar` | on credit, nothing paid |
| `Raju took 10 kg rice at 50, baki 300` | explicit balance |
| `Sharma ji paid 400` | a payment, not a sale |

Every result goes to a **review screen** before anything is saved. Things rea is unsure
about (no customer heard, no payment mentioned, missing price) are listed in a yellow box
rather than guessed.

## Features

- Voice or typed input → editable bill
- Customer ledger with running balance, payments, and "who owes me" total
- Bill with WhatsApp share and Print / Save as PDF
- WhatsApp payment reminders
- Works offline after the first load (service worker)
- Backup and restore as a JSON file

## Honest limits

- **Voice is not offline.** It uses the browser's built-in speech recognition. In Chrome on
  Android that audio goes to Google and needs internet. Firefox and iOS Safari have little or
  no support. Typing always works offline. A truly offline voice model is a separate, bigger project.
- **Accuracy depends on the speech engine.** Marathi voice recognition is the weakest of the
  three. That is why the review step exists. Do not skip it.
- **Number words are partial.** Digits (what speech engines normally return) are fully
  supported. Spoken Hindi/Marathi numbers work for 1–20, the round tens, and *sau*/*hazaar*,
  but compounds like *pachees* (25) are not recognised yet.
- **One device, no sync.** The ledger lives in this browser. Clearing site data or losing the
  phone loses it, so download a backup now and then. Two phones will have two separate ledgers.
- **Not tax software.** Bills are simple receipts: no GST, no invoice-numbering rules.
- **Rate is per the unit you said.** `2 dozen eggs at 70` means ₹70 per dozen.

## How it works

| File | Job |
| --- | --- |
| `parser.js` | Rule-based sentence → bill. No ML, no network, never throws. |
| `store.js` | Ledger in one JSON document. Balances are *computed* from entries, never stored. |
| `app.js` | Screens: record, review, bill, ledger, settings, voice. |
| `sw.js` | Offline cache of the app shell. |

## Ideas for next

- Offline voice with a small on-device model
- Customer phone numbers, so WhatsApp opens the right chat
- Item price memory ("onion" → last rate)
- Marathi/Hindi bill text
- Optional sync between two phones

## License

MIT
