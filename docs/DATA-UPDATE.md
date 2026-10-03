# Updating the registrations data

New registrations will keep coming in until the event. To refresh the list (e.g. the Saturday re-export):

## Do
1. Open the **same** Google Sheet (the one the Apps Script is attached to).
2. Click the **`registrations`** tab.
3. **File → Import → Upload** the new export → Import location: **Replace current sheet**.
   (Or select all cells in the tab, delete them, and paste the new data with headers.)
4. Make sure the header row still has `ID`, `First Name`, `Last Name`, `Email`, `AI`, `Sustainability`, `Checked In`, `Checked In Time`.
5. If the membership list changed, replace the **`ActiveMembersList`** tab the same way.

Desks pick up the new rows automatically. The full list reloads every 3 minutes, and a scanned ID that isn't loaded yet is fetched from the sheet directly.

## Don't
- **Don't upload the file as a new Google Sheet** or replace the whole spreadsheet file. The Apps Script is attached to *this* file, so a new file means a new script and a new URL.
- **Don't refresh the data once check-ins have started.** The export contains `Checked In = No`, so it would wipe check-ins made on the day. If you must refresh during the event, first copy the `Checked In` / `Checked In Time` values, or add only the new rows at the bottom.
- Don't rename the `registrations` or `ActiveMembersList` tabs.

The **`Guests`** tab is never touched by a registrations refresh.
