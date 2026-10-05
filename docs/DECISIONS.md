# Design decisions & data notes

## Data findings (snapshot 3 Oct 2026, 944 registrations)

| Finding | Count | How the app handles it |
|---|---|---|
| Email found in `ActiveMembersList` | 595 | ✓ Active member → normal **Check in** |
| Email not found, but first + last name match a member | 11 | Amber "matched by name" → normal **Check in** |
| Neither email nor name found | 338 (~36%) | Red "Not in Active Members list" → **Check in anyway** with confirmation |
| `Payment Status = Cancelled` | 17 | Red "Registration cancelled" → **Check in anyway** with confirmation |
| AI = 1 (Blue) / Sustainability = 1 (Green) | 665 / 279 | Every row has exactly one track. "ASK" only appears if the data changes. |
| Email used by more than one registration | 15 | Each registration ID is checked in separately |

There's no shared ID between the two tabs (`User ID` is the website account; `Personid` is the PMI ID), so **email is the match key**.
The ~36% unmatched rate is because the `ActiveMembersList` tab is out of date. It will be refreshed on **Friday 9 Oct 2026**, together with the registrations. Some people may still have registered with a different email from their PMI profile, so non-members get an override button instead of being blocked.

## Architecture

- **Google Sheet + Apps Script** instead of a separate database. Organisers already work in the sheet, it's free, and the result is visible live in the sheet with no export step.
- **Load once, look up locally.** Each desk downloads all registrations (with the membership flag already computed on the server) when it starts. A scan is then matched instantly in the browser, with no network round-trip. Only the check-in itself writes to the server.
- **The membership list never leaves Google.** The browser only receives `member: email | name | none`, not member phone numbers or emails.
- **Optimistic UI.** The "Checked in" banner shows immediately. The write happens in the background (Apps Script takes about 1–2 s).
- **Concurrency.** `LockService` serialises writes. If a row is already `Yes`, the original time is kept and the desk is told "already checked in".
- **Sync.** Every desk polls a lightweight `status` endpoint every 8 s and reloads everything every 3 min.
- **Offline queue.** Check-ins and guest additions that fail on the network are saved in `localStorage` and retried. Guest additions carry a unique `ref`, so a retry never creates a duplicate.
- **Access key.** The web app must be "Anyone" so the static site can call it. The key in Script Properties stops strangers from reading attendee data. All calls are POST, so the key is never in a URL.
- **Header-based columns.** The script finds columns by name, so a re-export with different column order still works.
- **Guests in their own tab.** Walk-in guests and speakers go to `Guests` (IDs `G-1`, `G-2`, …) so a registrations refresh can't wipe them.
- **No payment information is shown** (all members are treated as paid). The `Payment Status` column is only read to flag cancelled registrations.

## Card colours

| Type | Card colour |
|---|---|
| Board Member | White |
| Volunteer | White |
| Speaker | White |
| VIP | White |
| Partner | White |
| Delegate - Sustainability | Green |
| Delegate - AI | Blue |

Registered delegates take their colour from the sheet's `AI` / `Sustainability` columns. Walk-in delegates who aren't on the sheet can be added with the guest form as "Delegate - AI" or "Delegate - Sustainability".

Guest colours are configured in `public/config.js` (`GUEST_LANYARDS`, `DEFAULT_GUEST_LANYARD`). The colour is also written to the `Lanyard` column of the `Guests` tab.

## Open questions

- After Friday's member-list refresh: should anyone still unmatched be checked in with the override, or sent to verify in the PMI app first? The app currently allows an override with confirmation.
