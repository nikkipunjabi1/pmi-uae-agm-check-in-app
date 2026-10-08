# Changelog

## 2026-10-08 — v1.5.1 (first-load reliability)
- Until the registration list has loaded, the app retries every 5 s (no backoff) and keeps loading even if the phone switches to another app.
- Only one full-list download runs at a time, so a slow download is never overlapped by retries.
- Full-list download timeout raised to 60 s (other calls stay at 30 s).
- Badge shows "Loading registrations… (attempt N)" instead of "Connecting…/Reconnecting…" while loading.
- No backend change needed.

## 2026-10-05 — v1.5.0 (performance)
- Backend: `status` cached 5 s and `data` cached 120 s in CacheService; caches cleared on every write.
- App: polls every ~15 s with jitter (was 8 s), backs off up to 4× on errors; full reload every 10 min (was 3 min).
- App: 30 s request timeout; retries once on an unexpected UNAUTHORIZED before asking for the key.
- Lock wait for writes raised to 30 s.
- `tools/loadtest.mjs`: simulate 9 desks against the live backend without writing to the sheet.
- Requires an Apps Script redeploy (Manage deployments → Edit → New version).

## 2026-10-05 — v1.4.1
- Fix: walk-in card colour is always derived from the guest type via `config.js`, never from the stored `Lanyard` value (an outdated backend had saved Board Member as Blue).

## 2026-10-05 — v1.4.0
- Guest / speaker form: optional **Email** and **Phone** fields, saved to the `Guests` tab.
- Existing `Guests` tabs get the new columns added automatically; values are placed by header name.
- Guests are searchable by phone; a failed email search pre-fills the guest form's email.
- Requires an Apps Script redeploy (Manage deployments → Edit → New version).

## 2026-10-05 — v1.3.1
- Added **Guest** to the walk-in types (White card).

## 2026-10-05 — v1.3.0
- New card colours: **Board Member, Volunteer, Speaker, VIP, Partner → White**; **Delegate - AI → Blue**; **Delegate - Sustainability → Green**.
- Walk-in form types: Speaker, Board Member, VIP, Partner, Volunteer, Delegate - AI, Delegate - Sustainability.
- "Lanyard" wording changed to "Card colour" on screen.
- Apps Script fallback updated (needs a redeploy: Manage deployments → Edit → New version).

## 2026-10-03 — v1.2.0
- Fix: iPhone camera preview was black on first start. Camera permission is now requested before the scan stream opens, and a watchdog restarts the camera if no video arrives.
- Camera restarts automatically when returning to the app (iOS stops it in the background).
- "Switch camera" toggles back/front on phones; cycles devices on laptops.
- Faster scanning: QR-only decoding and the native BarcodeDetector where available (Android Chrome).
- Bottom spacing so the Netlify badge never covers buttons; desk guide explains how to hide it per phone.

## 2026-10-03 — v1.1.0
- Guest lanyard colour now comes from the type: **Speaker → Red**, **Volunteer → Yellow**, VIP / Guest / Sponsor / other → **Blue**. The form no longer asks for a lanyard.
- Lanyard colours configurable in `config.js` (`GUEST_LANYARDS`, `DEFAULT_GUEST_LANYARD`).
- Front end connected to the deployed Apps Script web app.
- Repository moved to `nikkipunjabi1/pmi-uae-agm-check-in-app`.

## 2026-10-03 — v1.0.0
- QR scan check-in: reads the `id` from the pmiuae.org check-in URL and matches it to the `registrations` tab.
- Active member verification against `ActiveMembersList` (email match, name-match fallback).
- Large BLUE (AI) / GREEN (Sustainability) lanyard banner.
- Writes `Checked In = Yes` and `Checked In Time` (Dubai time) back to the sheet. Undo supported.
- Live summary across desks (8 s polling) and an Attendees list (checked in / not yet / all, with search).
- Walk-in guest / speaker check-in, saved to an auto-created `Guests` tab.
- Search by ID, name or email; handheld barcode scanner support.
- Offline queue with automatic retry; duplicate-safe guest creation.
- Desk access key; demo mode (`?demo`) with sample data for training.
- Payment details are not displayed (only cancelled registrations are flagged).
- Mobile-first layout: result opens as a bottom sheet over the camera, compact live stats, phone-friendly guest form and attendee list.
- PMI UAE Chapter logo in the header.
