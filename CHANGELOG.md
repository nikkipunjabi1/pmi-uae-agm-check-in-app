# Changelog

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
