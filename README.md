# PMI UAE Chapter — AGM 2026 Check-In

A fast check-in web app for the **PMI UAE Chapter Annual Gathering Meeting 2026** (10 October 2026).
Registration desk staff scan an attendee's QR code. The app confirms the registration and active membership, shows the **lanyard colour** in large text, and writes the check-in back to the Google Sheet. Every desk sees the same live numbers.

- **Front end:** static HTML/CSS/JS in [`public/`](public/), deployed to Netlify from `main`.
- **Back end:** a Google Apps Script web app ([`apps-script/Code.gs`](apps-script/Code.gs)) bound to the registrations Google Sheet.
- **Data:** the Google Sheet is the single source of truth. There is no other database.

## How it works

```
 Attendee QR ──► Desk browser (Netlify) ──HTTPS──► Apps Script web app ──► Google Sheet
 …&id=9620&…     scans, finds ID 9620            checks the access key       registrations
                 shows lanyard + checks           locks, writes Yes + time     ActiveMembersList
                 polls every 8 s for other desks                               Guests (auto-created)
```

1. The QR code contains `https://pmiuae.org/index.php?option=com_eventbooking&task=registrant.checkin&id=9620&Itemid=4729`. The app reads the `id` (here `9620`) and matches it to the **ID** column of the `registrations` tab.
2. **Membership check:** the registration's **Email** is matched (case-insensitive) to **Primaryemail** in `ActiveMembersList`. If the email doesn't match but the first and last name do, the app shows an amber "matched by name" note and still allows check-in.
3. **Lanyard:** shown as a large coloured banner.

   | Type | Card colour |
   |---|---|
   | Delegate - AI (registrant with `AI = 1`, or walk-in) | **BLUE** |
   | Delegate - Sustainability (registrant with `Sustainability = 1`, or walk-in) | **GREEN** |
   | Board Member, Volunteer, Speaker, VIP, Partner, Guest | **WHITE** |

4. **Check in** sets `Checked In = Yes` and `Checked In Time = dd-MM-yyyy HH:mm:ss` (Dubai time) on that row.
5. **Walk-in guests and speakers** who aren't on the sheet are added with **+ Add guest / speaker** (first name, last name, type, and optional email, phone, PMI ID and organisation). The type sets the lanyard colour. They are checked in straight away and saved to a separate `Guests` tab. Types and colours are set in `public/config.js` (`GUEST_TYPES`, `GUEST_LANYARDS`).

| Situation | What the desk sees | Action |
|---|---|---|
| Registered + active member | Green ticks | **Check in** (green) |
| Registered, matched by name only | Amber note | **Check in** (green) |
| Registered, not in ActiveMembersList | Red warning | **Check in anyway** (amber, asks to confirm) |
| Registration cancelled | Red warning | **Check in anyway** (amber, asks to confirm) |
| Already checked in (at any desk) | "Already checked in at …" | Undo (if needed) |
| ID not on the sheet | "Registration not found" | Search by name/email, or add as a guest |

## Features

- Camera QR scanning (phones, tablets, laptops). It keeps scanning, so the next attendee can scan as soon as the current one is done.
- Works with handheld USB/Bluetooth barcode scanners: they type the QR URL into the lookup box and press Enter.
- Search by ID, name or email when someone has no QR code.
- Live summary: registered, checked in, % arrived, AI/Blue and Sustainability/Green counts, non-member check-ins, and guests/speakers.
- Attendees tab with the full checked-in list (newest first), a "not yet arrived" list and search. It shows the same data on every device, whenever you open it.
- Safe with several desks at once. Writes are locked, and if two desks scan the same person the second one sees "already checked in".
- Survives network drops. A check-in made while offline is saved on the device and synced automatically when the connection returns.
- Access key, so the attendee data isn't readable by anyone who finds the URL.
- Demo mode with sample data when no backend is configured, or by adding `?demo` to the URL. Use it for staff training.

## Quick start

| Task | Guide |
|---|---|
| First-time setup (Apps Script + Netlify) | [docs/SETUP.md](docs/SETUP.md) |
| Instructions for desk staff | [docs/DESK-GUIDE.md](docs/DESK-GUIDE.md) |
| Replacing the registrations data (e.g. Saturday refresh) | [docs/DATA-UPDATE.md](docs/DATA-UPDATE.md) |
| Design decisions & data notes | [docs/DECISIONS.md](docs/DECISIONS.md) |
| Change history | [CHANGELOG.md](CHANGELOG.md) |

Run locally (demo mode works without any setup):

```bash
npx http-server public -p 5173 -c-1
```

Then open http://localhost:5173. The camera needs `localhost` or HTTPS.

## Project layout

```
public/              Netlify site (no build step)
  index.html
  styles.css
  app.js             all UI logic, sync, offline queue, demo backend
  config.js          API URL, guest types, polling intervals
  assets/            chapter logo, favicon
apps-script/
  Code.gs            Google Apps Script backend
  appsscript.json    manifest (timezone Asia/Dubai, web app settings)
docs/                setup, desk guide, data update, decisions
tools/loadtest.mjs   simulate 9 desks against the live backend (no writes)
netlify.toml         publish dir + headers
```

## Privacy

The repository [nikkipunjabi1/pmi-uae-agm-check-in-app](https://github.com/nikkipunjabi1/pmi-uae-agm-check-in-app) is **public**. Never commit attendee data: `*.xlsx` and `*.csv` are git-ignored. The access key is stored only in the Apps Script **Script Properties** and on each desk device. It is never stored in this repo.
