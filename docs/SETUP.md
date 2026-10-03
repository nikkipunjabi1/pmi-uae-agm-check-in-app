# Setup guide

Allow about 15 minutes. You need edit access to the registrations Google Sheet and to the Netlify site.

## 1. Google Sheet

The sheet must contain these tabs (header names matter, column order doesn't):

| Tab | Required columns |
|---|---|
| `registrations` | `ID`, `First Name`, `Last Name`, `Email`, `AI`, `Sustainability`, `Checked In`, `Checked In Time` (`Payment Status` is optional and only used to flag cancelled rows) |
| `ActiveMembersList` | `Personid`, `Firstname`, `Lastname`, `Primaryemail` |
| `Guests` | *Created automatically* the first time a guest/speaker is added |

## 2. Apps Script backend

1. Open the Google Sheet → **Extensions → Apps Script**.
2. Delete the placeholder code and paste the contents of [`apps-script/Code.gs`](../apps-script/Code.gs).
3. (Optional) **Project Settings → Show "appsscript.json"**, then paste [`apps-script/appsscript.json`](../apps-script/appsscript.json). This sets the timezone to Asia/Dubai.
4. **Project Settings → Script Properties → Add property**
   - `ACCESS_KEY` = a passphrase for the desk team, e.g. `agm-desk-2026-xyz`. (If it's left empty, anyone with the URL can read and write.)
   - *(optional)* `SHEET_ID` = the spreadsheet ID. Only needed if the script is **not** bound to the sheet.
5. In the editor, pick the function **`selfTest`** → **Run** → approve the permissions prompt. **View → Logs** should show something like `Registrations: 944, membership: {"email":595,"name":11,"none":338}`.
6. **Deploy → New deployment** → type **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - **Deploy**, then copy the **Web app URL** (ends in `/exec`).
7. Test it in a browser: `<web app URL>?action=ping` should return `{"ok":true,...}`.

> **Updating the script later:** after editing `Code.gs`, use **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. Creating a *new* deployment changes the URL.

## 3. Front end config

Edit [`public/config.js`](../public/config.js):

```js
API_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
GUEST_TYPES: ['Speaker', 'Guest', 'VIP', 'Sponsor', 'Volunteer'],
```

Commit and push to `main`. Netlify deploys automatically.

## 4. Netlify

1. **Add new site → Import from Git →** `nikkipunjabi/pmi-uae-agm-registration-check-in`.
2. Branch `main`. Build command: *(empty)*. Publish directory: `public` (already set in `netlify.toml`).
3. Optionally rename the site, e.g. `pmiuae-agm-checkin.netlify.app`.

## 5. Share with the desks

Send the team this link. It carries the access key once, and the key is removed from the address bar after the first load:

```
https://<your-site>.netlify.app/#key=<ACCESS_KEY>
```

Or share the plain URL and give them the key separately. The app asks for it on first open.

## 6. Dry run (recommended the day before)

- [ ] Open the link on every desk device (3 desks × 3 people) and allow camera access.
- [ ] Scan a real QR code → check in → confirm the row in the sheet shows `Yes` + time.
- [ ] Confirm the count increases on the *other* devices within ~10 s.
- [ ] Press **Undo** to reset the test check-in.
- [ ] Add a test guest, then delete that row from the `Guests` tab.
- [ ] For training, staff can use `https://<site>/?demo` (sample data, nothing is written to the sheet).
