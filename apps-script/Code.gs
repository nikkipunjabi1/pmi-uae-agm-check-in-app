/**
 * PMI UAE Chapter — AGM 2026 Check-in backend (Google Apps Script).
 *
 * Bind this script to the registrations Google Sheet (Extensions → Apps Script),
 * set the ACCESS_KEY script property, and deploy as a Web App
 * (Execute as: Me, Who has access: Anyone). See docs/SETUP.md.
 *
 * Endpoints (all return JSON):
 *   GET  ?action=ping                       → health check (no key needed)
 *   GET  ?action=data&key=K                 → all registrations + membership flag
 *   GET  ?action=status&key=K               → checked-in ids/times (lightweight poll)
 *   GET  ?action=lookup&id=9620&key=K       → single registration (fresh read)
 *   POST {action:'checkin', id, key}        → mark Checked In = Yes + time
 *   POST {action:'undo', id, key}           → revert a check-in
 *   POST {action:'addGuest', firstName, lastName, type, track, org, ref, key}
 *                                           → add a walk-in guest/speaker (checked in immediately)
 *
 * Guests/speakers live in their own "Guests" tab (created automatically) with ids like G-1, G-2…
 */

var CONFIG = {
  REG_SHEET: 'registrations',
  MEMBERS_SHEET: 'ActiveMembersList',
  GUESTS_SHEET: 'Guests',
  TIMEZONE: 'Asia/Dubai',
  TIME_FORMAT: 'dd-MM-yyyy HH:mm:ss',
};

// Header names are matched case-insensitively, so column order can change.
var COLS = {
  id: 'id',
  firstName: 'first name',
  lastName: 'last name',
  email: 'email',
  ai: 'ai',
  sustainability: 'sustainability',
  paymentStatus: 'payment status',
  checkedIn: 'checked in',
  checkedInTime: 'checked in time',
};

var GUEST_HEADERS = ['Guest ID', 'Type', 'First Name', 'Last Name', 'Organisation', 'Lanyard', 'Checked In', 'Checked In Time', 'Ref'];
var GUEST_COLS = {
  id: 'guest id', type: 'type', firstName: 'first name', lastName: 'last name', org: 'organisation',
  lanyard: 'lanyard', checkedIn: 'checked in', checkedInTime: 'checked in time', ref: 'ref',
};

var MEMBER_COLS = {
  email: 'primaryemail',
  firstName: 'firstname',
  lastName: 'lastname',
};

function doGet(e) {
  return handle_((e && e.parameter) || {});
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (_) {}
  var params = (e && e.parameter) || {};
  for (var k in body) params[k] = body[k];
  return handle_(params);
}

function handle_(p) {
  try {
    if (p.action === 'ping') {
      return json_({ ok: true, authorized: isAuthorized_(p.key), time: now_() });
    }
    if (!isAuthorized_(p.key)) return json_({ ok: false, error: 'UNAUTHORIZED' });

    switch (p.action) {
      case 'data':
        return json_(getData_());
      case 'status':
        return json_(getStatus_());
      case 'lookup':
        return json_(lookup_(p.id));
      case 'checkin':
        return json_(setCheckedIn_(p.id, true));
      case 'undo':
        return json_(setCheckedIn_(p.id, false));
      case 'addGuest':
        return json_(addGuest_(p));
      default:
        return json_({ ok: false, error: 'UNKNOWN_ACTION' });
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// ---------- actions ----------

function getData_() {
  var reg = readRegistrations_();
  var members = readMembers_();
  var records = reg.rows.map(function (r) {
    return toRecord_(r, reg.idx, members);
  }).filter(function (rec) { return rec.id; });
  return { ok: true, time: now_(), records: records.concat(readGuests_().records) };
}

function getStatus_() {
  var reg = readRegistrations_();
  var idx = reg.idx;
  var checked = [];
  var count = 0;
  reg.rows.forEach(function (r) {
    var id = String(r[idx.id]).trim();
    if (!id) return;
    count++;
    if (isYes_(r[idx.checkedIn])) checked.push([id, r[idx.checkedInTime] || '']);
  });
  readGuests_().records.forEach(function (g) {
    count++;
    if (g.checkedIn) checked.push([g.id, g.time]);
  });
  return { ok: true, time: now_(), count: count, checked: checked };
}

function lookup_(id) {
  id = cleanId_(id);
  if (!id) return { ok: false, error: 'MISSING_ID' };
  if (isGuestId_(id)) {
    var g = readGuests_().records.filter(function (x) { return x.id === id; })[0];
    return { ok: true, record: g || null };
  }
  var reg = readRegistrations_();
  for (var i = 0; i < reg.rows.length; i++) {
    if (String(reg.rows[i][reg.idx.id]).trim() === id) {
      return { ok: true, record: toRecord_(reg.rows[i], reg.idx, readMembers_()) };
    }
  }
  return { ok: true, record: null };
}

function setCheckedIn_(id, value) {
  id = cleanId_(id);
  if (!id) return { ok: false, error: 'MISSING_ID' };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var guest = isGuestId_(id);
    var sh = guest ? guestSheet_() : sheet_(CONFIG.REG_SHEET);
    var idx = headerIndex_(sh, guest ? GUEST_COLS : COLS);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: false, error: 'NOT_FOUND' };

    var ids = sh.getRange(2, idx.id + 1, lastRow - 1, 1).getDisplayValues();
    var rowNum = -1;
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]).trim() === id) { rowNum = i + 2; break; }
    }
    if (rowNum < 0) return { ok: false, error: 'NOT_FOUND' };

    var inCell = sh.getRange(rowNum, idx.checkedIn + 1);
    var timeCell = sh.getRange(rowNum, idx.checkedInTime + 1);
    var already = isYes_(inCell.getDisplayValue());

    if (value) {
      // Another desk got there first: report the original time, don't overwrite it.
      if (already) {
        return { ok: true, id: id, checkedIn: true, time: timeCell.getDisplayValue(), already: true };
      }
      var ts = now_();
      inCell.setValue('Yes');
      timeCell.setNumberFormat('@').setValue(ts); // keep as text so Sheets doesn't reformat it
      SpreadsheetApp.flush();
      return { ok: true, id: id, checkedIn: true, time: ts, already: false };
    }

    inCell.setValue('No');
    timeCell.setValue('');
    SpreadsheetApp.flush();
    return { ok: true, id: id, checkedIn: false, time: '' };
  } finally {
    lock.releaseLock();
  }
}

function addGuest_(p) {
  var firstName = String(p.firstName || '').trim();
  var lastName = String(p.lastName || '').trim();
  if (!firstName) return { ok: false, error: 'MISSING_NAME' };
  var ref = String(p.ref || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = guestSheet_();
    var existing = readGuests_();
    // Retried request from a desk that went offline: return the guest already saved.
    if (ref) {
      var dup = existing.records.filter(function (g) { return g.ref === ref; })[0];
      if (dup) return { ok: true, record: dup, already: true };
    }
    var next = 1;
    existing.records.forEach(function (g) {
      var n = Number(g.id.replace(/\D/g, ''));
      if (n >= next) next = n + 1;
    });
    var id = 'G-' + next;
    var ts = now_();
    var lanyard = trackToLanyard_(p.track);
    var row = [id, String(p.type || 'Guest').trim(), firstName, lastName, String(p.org || '').trim(), lanyard, 'Yes', ts, ref];
    var rowNum = sh.getLastRow() + 1;
    sh.getRange(rowNum, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    SpreadsheetApp.flush();
    return { ok: true, record: guestRecord_(row, headerIndex_(sh, GUEST_COLS)) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- sheet helpers ----------

function spreadsheet_() {
  var sheetId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = spreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet tab "' + name + '" not found');
  return sh;
}

function headerIndex_(sh, cols) {
  var header = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0]
    .map(function (h) { return String(h).trim().toLowerCase(); });
  var idx = {};
  for (var key in cols) {
    idx[key] = header.indexOf(cols[key]);
    if (idx[key] < 0 && key !== 'paymentStatus' && key !== 'org' && key !== 'ref') {
      throw new Error('Column "' + cols[key] + '" missing in ' + sh.getName());
    }
  }
  return idx;
}

function readRegistrations_() {
  var sh = sheet_(CONFIG.REG_SHEET);
  var values = sh.getDataRange().getDisplayValues();
  var idx = headerIndex_(sh, COLS);
  return { idx: idx, rows: values.slice(1) };
}

function guestSheet_() {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(CONFIG.GUESTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.GUESTS_SHEET);
    sh.getRange(1, 1, 1, GUEST_HEADERS.length).setValues([GUEST_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readGuests_() {
  var sh = spreadsheet_().getSheetByName(CONFIG.GUESTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return { records: [] };
  var idx = headerIndex_(sh, GUEST_COLS);
  var records = sh.getDataRange().getDisplayValues().slice(1)
    .map(function (r) { return guestRecord_(r, idx); })
    .filter(function (g) { return g.id; });
  return { records: records };
}

function guestRecord_(r, idx) {
  return {
    id: String(r[idx.id] || '').trim(),
    firstName: String(r[idx.firstName] || '').trim(),
    lastName: String(r[idx.lastName] || '').trim(),
    email: '',
    org: String(r[idx.org] || '').trim(),
    guestType: String(r[idx.type] || 'Guest').trim(),
    track: lanyardToTrack_(r[idx.lanyard]),
    member: 'guest',
    paymentStatus: '',
    checkedIn: isYes_(r[idx.checkedIn]),
    time: String(r[idx.checkedInTime] || ''),
    ref: String(r[idx.ref] || ''),
  };
}

function trackToLanyard_(t) {
  t = String(t || '').toUpperCase();
  return t === 'AI' ? 'Blue (AI)' : t === 'SUSTAINABILITY' ? 'Green (Sustainability)' : '';
}
function lanyardToTrack_(l) {
  l = String(l || '').toLowerCase();
  return /blue|\bai\b/.test(l) ? 'AI' : /green|sustain/.test(l) ? 'SUSTAINABILITY' : '';
}

function readMembers_() {
  var sh = sheet_(CONFIG.MEMBERS_SHEET);
  var values = sh.getDataRange().getDisplayValues();
  var idx = headerIndex_(sh, MEMBER_COLS);
  var emails = {};
  var names = {};
  values.slice(1).forEach(function (r) {
    var e = norm_(r[idx.email]);
    if (e) emails[e] = true;
    var n = nameKey_(r[idx.firstName], r[idx.lastName]);
    if (n) names[n] = true;
  });
  return { emails: emails, names: names };
}

function toRecord_(r, idx, members) {
  var email = String(r[idx.email] || '').trim();
  var nk = nameKey_(r[idx.firstName], r[idx.lastName]);
  var member = members.emails[norm_(email)] ? 'email' : (nk && members.names[nk] ? 'name' : 'none');
  var ai = isOne_(r[idx.ai]);
  var sus = isOne_(r[idx.sustainability]);
  return {
    id: String(r[idx.id]).trim(),
    firstName: String(r[idx.firstName] || '').trim(),
    lastName: String(r[idx.lastName] || '').trim(),
    email: email,
    track: ai && sus ? 'BOTH' : ai ? 'AI' : sus ? 'SUSTAINABILITY' : '',
    member: member,
    paymentStatus: idx.paymentStatus >= 0 ? String(r[idx.paymentStatus] || '').trim() : '',
    checkedIn: isYes_(r[idx.checkedIn]),
    time: String(r[idx.checkedInTime] || ''),
  };
}

// ---------- small utils ----------

function isAuthorized_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
  return !expected || String(key || '') === expected;
}

function isGuestId_(id) { return /^G-\d+$/.test(id); }

function cleanId_(id) {
  var g = String(id || '').trim().match(/^G-?(\d+)$/i);
  if (g) return 'G-' + Number(g[1]);
  var m = String(id || '').match(/\d+/);
  return m ? String(Number(m[0])) : '';
}

function norm_(s) { return String(s || '').trim().toLowerCase(); }
function nameKey_(f, l) {
  var k = (norm_(f) + ' ' + norm_(l)).replace(/\s+/g, ' ').trim();
  return k;
}
function isYes_(v) { return /^(yes|y|true|1)$/i.test(String(v || '').trim()); }
function isOne_(v) { return /^(1|1\.0|yes|true|y)$/i.test(String(v || '').trim()); }
function now_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, CONFIG.TIME_FORMAT); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to confirm the script can read both tabs. */
function selfTest() {
  var d = getData_();
  var byMember = { email: 0, name: 0, none: 0 };
  d.records.forEach(function (r) { byMember[r.member]++; });
  Logger.log('Registrations: %s, membership: %s', d.records.length, JSON.stringify(byMember));
}
