/* PMI UAE Chapter — AGM 2026 check-in front end. No build step; plain browser JS. */
(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const DEMO = !CFG.API_URL || params.has('demo');
  const POLL_MS = CFG.POLL_MS || 8000;
  const FULL_RELOAD_MS = CFG.FULL_RELOAD_MS || 180000;
  const REQUEST_TIMEOUT_MS = 30000;
  const DATA_TIMEOUT_MS = 60000;      // the full list is the biggest, slowest call — give it longer
  const FIRST_LOAD_RETRY_MS = 5000;   // until the list has loaded once, retry steadily (no backoff)
  const STORE = { key: 'agm26.key', queue: 'agm26.queue' };

  const state = {
    records: new Map(),   // id -> record
    view: null,           // what the result panel shows
    filter: 'in',
    pending: new Set(),   // ids with a request in flight
    queue: readJSON(STORE.queue, []), // check-ins/undos waiting for the network
    lastSync: 0,
    syncError: false,
    loaded: false,
    loadAttempts: 0,
  };

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- storage

  function readJSON(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; }
  }
  function writeJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} }
  function getKey() { try { return localStorage.getItem(STORE.key) || ''; } catch (_) { return ''; } }
  function setKey(k) { try { localStorage.setItem(STORE.key, k); } catch (_) {} }

  // ---------------------------------------------------------------- utils

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const fullName = (r) => `${r.firstName} ${r.lastName}`.replace(/\s+/g, ' ').trim();
  const isCancelled = (r) => /cancel/i.test(r.paymentStatus || '');
  const isGuest = (r) => r.member === 'guest';
  const isTmp = (id) => String(id).startsWith('tmp-');
  const newRef = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  function dubaiNow() {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
  }
  // "dd-MM-yyyy HH:mm:ss" -> sortable "yyyyMMddHHmmss"
  function timeKey(t) {
    const m = String(t || '').match(/(\d{2})-(\d{2})-(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    return m ? `${m[3]}${m[2]}${m[1]}${m[4].padStart(2, '0')}${m[5]}${m[6] || '00'}` : '';
  }
  function shortTime(t) {
    const m = String(t || '').match(/(\d{1,2}:\d{2})(?::\d{2})?/);
    return m ? m[1] : (t || '');
  }

  /** Accepts the QR URL (…&id=9620&…), a bare ID, or anything else (returns null). */
  function extractId(text) {
    const t = String(text || '').trim();
    const m = t.match(/[?&]id=(\d+)/i);
    if (m) return String(Number(m[1]));
    if (/^#?\d{1,9}$/.test(t)) return String(Number(t.replace('#', '')));
    return null;
  }

  let toastTimer;
  function toast(msg, kind = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = `toast ${kind}`;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }

  let audioCtx;
  function beep(ok = true) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = ok ? 880 : 220;
      g.gain.value = 0.08;
      o.connect(g).connect(audioCtx.destination);
      o.start();
      o.stop(audioCtx.currentTime + (ok ? 0.09 : 0.25));
    } catch (_) {}
    try { navigator.vibrate && navigator.vibrate(ok ? 50 : [80, 60, 80]); } catch (_) {}
  }

  // ---------------------------------------------------------------- API

  class ApiError extends Error {
    constructor(code, network = false) { super(code); this.code = code; this.network = network; }
  }

  async function api(action, payload = {}, retried = false) {
    if (DEMO) return demoApi(action, payload);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), action === 'data' ? DATA_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    let res;
    try {
      // text/plain keeps this a "simple" request, so Apps Script needs no CORS preflight.
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action, key: getKey(), ...payload }),
        signal: ctrl.signal,
        cache: 'no-store',
        redirect: 'follow',
      });
    } catch (e) {
      throw new ApiError(e.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK', true);
    } finally {
      clearTimeout(timer);
    }
    let data;
    try { data = await res.json(); } catch (_) { throw new ApiError('BAD_RESPONSE', true); }
    if (!data.ok) {
      if (data.error === 'UNAUTHORIZED') {
        // Google occasionally drops the request body on a redirect; retry once before blaming the key.
        if (!retried) return api(action, payload, true);
        openKeyDialog('That key was not accepted. Please re-enter it.');
      }
      throw new ApiError(data.error || 'ERROR');
    }
    return data;
  }

  // ---------------------------------------------------------------- data sync

  // Only one full-list download at a time: a slow one must not be overlapped by retries.
  let loadInFlight = null;
  function loadAll() {
    if (!loadInFlight) {
      if (!state.loaded) { state.loadAttempts++; renderSync(); }
      loadInFlight = doLoadAll().finally(() => { loadInFlight = null; });
    }
    return loadInFlight;
  }

  async function doLoadAll() {
    const d = await api('data');
    const fresh = new Map();
    d.records.forEach((r) => fresh.set(r.id, r));
    // Keep local check-ins that haven't reached the sheet yet.
    state.queue.forEach((q) => {
      if (q.action === 'addGuest') fresh.set(q.id, { ...q.record });
      else applyLocal(fresh.get(q.id), q);
    });
    state.pending.forEach((id) => {
      const old = state.records.get(id);
      const r = fresh.get(id);
      if (old && r) { r.checkedIn = old.checkedIn; r.time = old.time; } else if (old && isTmp(id)) fresh.set(id, old);
    });
    state.records = fresh;
    state.loaded = true;
    markSynced(true);
    renderAll();
  }

  async function pollStatus() {
    await flushQueue();
    const s = await api('status');
    if (s.count !== state.records.size) return loadAll(); // new or removed registrations
    const checked = new Map(s.checked);
    const queued = new Set(state.queue.map((q) => q.id));
    let changed = false;
    for (const r of state.records.values()) {
      if (state.pending.has(r.id) || queued.has(r.id)) continue;
      const isIn = checked.has(r.id);
      const t = isIn ? checked.get(r.id) : '';
      if (r.checkedIn !== isIn || r.time !== t) { r.checkedIn = isIn; r.time = t; changed = true; }
    }
    markSynced(true);
    if (changed) renderAll();
  }

  function applyLocal(r, q) {
    if (!r) return;
    r.checkedIn = q.action === 'checkin';
    r.time = r.checkedIn ? q.at : '';
  }

  function enqueue(action, id, at, extra = {}) {
    state.queue = state.queue.filter((q) => q.id !== id);
    state.queue.push({ action, id, at, ...extra });
    writeJSON(STORE.queue, state.queue);
    renderSync();
  }

  let flushing = false;
  async function flushQueue() {
    if (flushing || !state.queue.length) return;
    flushing = true;
    try {
      while (state.queue.length) {
        const q = state.queue[0];
        try {
          if (q.action === 'addGuest') {
            const res = await api('addGuest', q.payload);
            replaceTmp(q.id, res.record);
          } else {
            const res = await api(q.action, { id: q.id });
            const r = state.records.get(q.id);
            if (r) { r.checkedIn = res.checkedIn; r.time = res.time || ''; }
          }
        } catch (e) {
          if (e.network || e.code === 'UNAUTHORIZED' || /lock/i.test(e.code)) throw e;
          // Permanent failure (e.g. row deleted) — drop it so the queue doesn't jam.
          toast(`Could not sync ID ${q.id}: ${e.code}`, 'err');
        }
        state.queue.shift();
        writeJSON(STORE.queue, state.queue);
      }
      renderAll();
    } finally {
      flushing = false;
      renderSync();
    }
  }

  function markSynced(ok) {
    if (ok) { state.lastSync = Date.now(); state.syncError = false; } else { state.syncError = true; }
    renderSync();
  }

  let pollTimer;
  let pollFailures = 0;
  function nextPollDelay() {
    // Before the list has loaded the desk can't work offline yet, so keep retrying steadily.
    if (!state.loaded) return FIRST_LOAD_RETRY_MS;
    // Back off (up to 4×) while the backend is struggling, and add jitter so desks don't poll in sync.
    const base = POLL_MS * Math.min(4, 2 ** pollFailures);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }
  function schedulePoll(delay) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      // Keep fetching the list even in the background until it has loaded once; after that, pause while hidden.
      if ((!document.hidden || !state.loaded) && (DEMO || getKey())) {
        try {
          if (!state.loaded) await loadAll(); else await pollStatus();
          pollFailures = 0;
        } catch (_) {
          pollFailures++;
          markSynced(false);
        }
      }
      schedulePoll();
    }, delay ?? nextPollDelay());
  }

  // ---------------------------------------------------------------- actions

  async function showById(id) {
    let r = state.records.get(id);
    if (!r && !DEMO) {
      state.view = { loading: true, id };
      renderResult();
      try {
        const res = await api('lookup', { id }); // maybe a late registration
        if (res.record) { state.records.set(id, res.record); r = res.record; renderStats(); }
      } catch (_) {}
    }
    state.view = r ? { id } : { notFound: true, id };
    beep(!!r && !r.checkedIn);
    renderResult();
    revealResult();
  }

  async function checkIn(id, override) {
    const r = state.records.get(id);
    if (!r || state.pending.has(id)) return;
    if (override) {
      const reason = isCancelled(r) ? 'This registration is CANCELLED.' : 'This person is NOT in the Active Members list.';
      if (!confirm(`${reason}\n\nCheck in ${fullName(r)} anyway?`)) return;
    }
    const at = dubaiNow();
    r.checkedIn = true;
    r.time = at;
    state.pending.add(id);
    state.view = { id, justDone: true };
    renderAll();
    try {
      const res = await api('checkin', { id });
      r.time = res.time || at;
      if (res.already) {
        state.view = { id };
        toast(`Already checked in at ${shortTime(res.time)} (another desk)`, 'err');
        beep(false);
      }
      markSynced(true);
    } catch (e) {
      if (e.network || e.code === 'UNAUTHORIZED' || /lock/i.test(e.code)) {
        enqueue('checkin', id, at);
        toast('Saved on this device — will sync automatically', '');
        markSynced(false);
      } else {
        r.checkedIn = false; r.time = '';
        state.view = { id };
        toast(`Check-in failed: ${e.code}`, 'err');
      }
    } finally {
      state.pending.delete(id);
      renderAll();
    }
  }

  async function undoCheckIn(id) {
    const r = state.records.get(id);
    if (!r || state.pending.has(id)) return;
    if (!confirm(`Undo check-in for ${fullName(r)}?`)) return;
    const prev = { checkedIn: r.checkedIn, time: r.time };
    r.checkedIn = false; r.time = '';
    state.pending.add(id);
    state.view = { id };
    renderAll();
    try {
      await api('undo', { id });
      toast('Check-in undone');
    } catch (e) {
      if (e.network || /lock/i.test(e.code)) enqueue('undo', id, '');
      else { Object.assign(r, prev); toast(`Undo failed: ${e.code}`, 'err'); }
    } finally {
      state.pending.delete(id);
      renderAll();
    }
  }

  function replaceTmp(tmpId, rec) {
    state.records.delete(tmpId);
    state.records.set(rec.id, rec);
    if (state.view && state.view.id === tmpId) state.view = { ...state.view, id: rec.id };
  }

  function openGuestDialog() {
    const f = $('guestForm');
    f.reset();
    const first = f.querySelector('input[name=gType]');
    if (first) first.checked = true;
    // A failed name search is usually the guest standing at the desk — prefill it.
    const v = state.view;
    if (v && v.unrecognised && /[a-z]/i.test(v.text) && !/[@\/]/.test(v.text)) {
      const parts = String(v.text).trim().split(/\s+/);
      $('gFirst').value = parts.shift() || '';
      $('gLast').value = parts.join(' ');
    } else if (v && v.unrecognised && /^\S+@\S+\.\S+$/.test(String(v.text).trim())) {
      $('gEmail').value = String(v.text).trim();
    }
    $('guestDialog').showModal();
    $(($('gFirst').value ? 'gLast' : 'gFirst')).focus();
  }

  async function onGuestSubmit(e) {
    e.preventDefault();
    const f = $('guestForm');
    const payload = {
      firstName: $('gFirst').value.trim(),
      lastName: $('gLast').value.trim(),
      type: (f.querySelector('input[name=gType]:checked') || {}).value || 'Guest',
      track: '',
      email: $('gEmail').value.trim(),
      phone: $('gPhone').value.trim(),
      pmiId: $('gPmiId').value.trim(),
      org: $('gOrg').value.trim(),
      ref: newRef(),
    };
    payload.lanyard = guestLanyard(payload.type);
    if (!payload.firstName) return;
    $('guestDialog').close();

    const tmpId = `tmp-${payload.ref.slice(0, 8)}`;
    const at = dubaiNow();
    const rec = {
      id: tmpId, firstName: payload.firstName, lastName: payload.lastName, email: payload.email, phone: payload.phone, org: payload.org,
      guestType: payload.type, track: '', lanyard: payload.lanyard, member: 'guest', paymentStatus: '',
      checkedIn: true, time: at, ref: payload.ref,
    };
    state.records.set(tmpId, rec);
    state.pending.add(tmpId);
    state.view = { id: tmpId, justDone: true };
    switchView('checkin');
    renderAll();
    beep(true);
    try {
      const res = await api('addGuest', payload);
      replaceTmp(tmpId, res.record);
      markSynced(true);
    } catch (err) {
      if (err.network || err.code === 'UNAUTHORIZED' || /lock/i.test(err.code)) {
        enqueue('addGuest', tmpId, at, { payload, record: rec });
        toast('Guest saved on this device — will sync automatically');
        markSynced(false);
      } else {
        state.records.delete(tmpId);
        state.view = null;
        toast(`Could not add guest: ${err.code}`, 'err');
      }
    } finally {
      state.pending.delete(tmpId);
      renderAll();
    }
  }

  function search(q) {
    const n = norm(q);
    if (n.length < 2) return [];
    const terms = n.split(/\s+/);
    const out = [];
    for (const r of state.records.values()) {
      const hay = norm(`${fullName(r)} ${r.email} ${r.phone || ''} ${r.org || ''} ${r.id}`);
      if (terms.every((t) => hay.includes(t))) out.push(r);
      if (out.length >= 8) break;
    }
    return out;
  }

  function handleInput(text) {
    const id = extractId(text);
    hideSearchResults();
    if (id) return showById(id);
    const hits = search(text);
    if (hits.length === 1) return showById(hits[0].id);
    if (!hits.length) {
      state.view = { unrecognised: true, text };
      renderResult();
      beep(false);
      return;
    }
    renderSearchResults(hits);
  }

  // ---------------------------------------------------------------- scanner

  let scanner = null;
  let scanning = false;
  let cameras = [];
  let camIndex = -1;
  let lastScan = { text: '', at: 0 };

  function onScan(text) {
    const now = Date.now();
    if (text === lastScan.text && now - lastScan.at < 4000) return; // same badge still in view
    lastScan = { text, at: now };
    const id = extractId(text);
    if (!id) {
      state.view = { unrecognised: true, text };
      renderResult();
      revealResult();
      beep(false);
      return;
    }
    showById(id);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isTouch = () => window.matchMedia('(pointer: coarse)').matches;
  let facing = 'environment';  // phones: toggled by "Switch camera"
  let starting = false;

  function createScanner() {
    const opts = { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };
    if (window.Html5QrcodeSupportedFormats) opts.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
    return new Html5Qrcode('reader', opts);
  }

  function cameraConstraint() {
    // Phones: let the browser pick the main back (or front) lens. Laptops: cycle through device ids.
    if (isTouch() || camIndex < 0 || !cameras[camIndex]) return { facingMode: facing };
    return cameras[camIndex].id;
  }

  function videoAlive() {
    const v = document.querySelector('#reader video');
    return !!v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused;
  }

  async function startScanner(attempt = 0) {
    if (!window.Html5Qrcode) { toast('Scanner failed to load — check the internet connection', 'err'); return; }
    if (starting || scanning) return;
    starting = true;
    $('readerPlaceholder').hidden = true;
    setScanBtn('Starting…', true);
    try {
      // Ask for permission + list cameras BEFORE opening the scan stream. Doing it while the
      // stream is live opens a second camera request, which blanks the video on iOS Safari.
      if (!cameras.length) {
        cameras = await Html5Qrcode.getCameras().catch(() => []);
        $('switchCamBtn').hidden = cameras.length < 2;
      }
      scanner = scanner || createScanner();
      await scanner.start(
        cameraConstraint(),
        {
          fps: 12,
          qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.72); return { width: s, height: s }; },
        },
        onScan,
        () => {}
      );
      scanning = true;
      setScanBtn('Stop Scanner', false);
    } catch (e) {
      scanning = false;
      $('readerPlaceholder').hidden = false;
      setScanBtn('Start Scanner', false);
      const raw = String((e && (e.message || e.name)) || e);
      const msg = /NotAllowed|Permission/i.test(raw)
        ? 'Camera blocked — allow camera access for this site in the browser settings, then tap Start Scanner'
        : `Camera not available: ${raw}`;
      toast(msg, 'err');
      return;
    } finally {
      starting = false;
    }
    verifyCamera(attempt);
  }

  /** Some phones (mostly iOS on first permission grant) start with a black preview. Detect and restart. */
  async function verifyCamera(attempt) {
    await sleep(1500);
    if (!scanning || videoAlive()) return;
    const v = document.querySelector('#reader video');
    if (v) { try { await v.play(); } catch (_) {} await sleep(400); if (videoAlive()) return; }
    if (attempt >= 2) { toast('Camera preview not showing — tap Stop, then Start Scanner', 'err'); return; }
    await stopScanner();
    await sleep(250);
    startScanner(attempt + 1);
  }

  async function stopScanner() {
    if (scanner && scanning) { try { await scanner.stop(); } catch (_) {} }
    scanning = false;
    $('readerPlaceholder').hidden = false;
    setScanBtn('Start Scanner', false);
  }

  async function switchCamera() {
    if (isTouch()) facing = facing === 'environment' ? 'user' : 'environment';
    else if (cameras.length > 1) camIndex = (camIndex + 1) % cameras.length;
    await stopScanner();
    await sleep(200);
    startScanner();
  }

  function setScanBtn(label, disabled) {
    const b = $('scanBtn');
    b.querySelector('span').textContent = label;
    b.disabled = disabled;
    b.classList.toggle('btn-secondary', label.startsWith('Stop'));
    b.classList.toggle('btn-primary', !label.startsWith('Stop'));
  }

  // ---------------------------------------------------------------- rendering

  function renderAll() {
    renderStats();
    renderResult();
    renderList();
    renderSync();
  }

  function renderStats() {
    let total = 0, inCount = 0, ai = 0, aiIn = 0, sus = 0, susIn = 0, nonMemberIn = 0, guestsIn = 0;
    for (const r of state.records.values()) {
      if (isGuest(r)) { if (r.checkedIn) guestsIn++; continue; }
      if (isCancelled(r) && !r.checkedIn) continue;
      total++;
      if (r.track === 'AI') ai++;
      if (r.track === 'SUSTAINABILITY') sus++;
      if (!r.checkedIn) continue;
      inCount++;
      if (r.track === 'AI') aiIn++;
      if (r.track === 'SUSTAINABILITY') susIn++;
      if (r.member === 'none' || isCancelled(r)) nonMemberIn++;
    }
    const loaded = state.loaded;
    $('stTotal').textContent = loaded ? total : '–';
    $('stIn').textContent = loaded ? inCount : '–';
    const pct = total ? Math.round((inCount / total) * 100) : 0;
    $('stPct').textContent = loaded ? `${pct}%` : '–';
    $('stBar').style.width = `${pct}%`;
    $('stAi').innerHTML = loaded ? `${aiIn}<small>/${ai}</small>` : '–';
    $('stSus').innerHTML = loaded ? `${susIn}<small>/${sus}</small>` : '–';
    $('stOverride').textContent = loaded ? nonMemberIn : '–';
    $('stGuests').textContent = loaded ? guestsIn : '–';
  }

  function renderSync() {
    const b = $('syncBadge');
    const q = state.queue.length;
    if (DEMO) { b.textContent = 'Demo mode · sample data'; b.className = 'sync-badge demo'; }
    else if (!state.loaded) {
      const n = state.loadAttempts;
      b.textContent = n > 1 ? `Loading registrations… (attempt ${n})` : 'Loading registrations…';
      b.className = `sync-badge${n > 1 ? ' warn' : ''}`;
    }
    else if (state.syncError || q) {
      b.textContent = q ? `Offline · ${q} to sync` : 'Reconnecting…';
      b.className = `sync-badge ${q ? 'err' : 'warn'}`;
    } else { b.textContent = '● Live'; b.className = 'sync-badge ok'; }
    $('lastSync').textContent = state.lastSync
      ? `synced ${new Date(state.lastSync).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
      : 'not synced';
  }

  /** Card colour: registered delegates by track (AI blue, Sustainability green); walk-ins by type (see config). */
  function guestLanyard(type) {
    const map = CFG.GUEST_LANYARDS || {};
    return map[type] || CFG.DEFAULT_GUEST_LANYARD || 'WHITE';
  }
  function lanyardOf(r) {
    // The type decides the colour (config.js is the single source of truth); the sheet's Lanyard
    // column is only a record. This also keeps the screen right if an older backend saved another colour.
    if (isGuest(r)) return guestLanyard(r.guestType);
    return r.track === 'AI' ? 'BLUE' : r.track === 'SUSTAINABILITY' ? 'GREEN' : '';
  }
  function lanyardSub(r) {
    if (isGuest(r)) return r.guestType || 'Guest';
    return r.track === 'AI' ? 'Delegate · AI' : 'Delegate · Sustainability';
  }

  function lanyardHtml(r) {
    const colour = lanyardOf(r);
    if (colour) {
      return `<div class="lanyard lanyard-${colour.toLowerCase()}"><div class="l-label">Card colour</div><div class="l-color">${colour}</div><div class="l-track">${esc(lanyardSub(r))}</div></div>`;
    }
    const why = r.track === 'BOTH' ? 'Registered for both tracks' : 'No track selected';
    return `<div class="lanyard lanyard-unknown"><div class="l-label">Card colour</div><div class="l-color">ASK</div><div class="l-track">${why} — ask: AI (Blue) or Sustainability (Green)?</div></div>`;
  }

  function lanyardWord(r) {
    return lanyardOf(r) || 'the chosen';
  }

  function renderResult() {
    const v = state.view;
    const box = $('result');
    document.body.classList.toggle('has-result', !!v);
    $('sheetBackdrop').hidden = !v;
    $('resultEmpty').hidden = !!v;
    box.hidden = !v;
    if (!v) return;

    if (v.loading) {
      box.innerHTML = `<div class="notfound"><div class="muted">Looking up ID ${esc(v.id)}…</div></div>`;
      return;
    }
    const missActions = `<div class="actions"><button class="btn btn-guest" data-addguest>Add as guest / speaker</button>
      <button class="btn btn-secondary next-btn" data-next>Close</button></div>`;
    if (v.unrecognised) {
      box.innerHTML = `<div class="notfound pop"><div class="big">No match</div>
        <p class="muted">Nothing found for “${esc(String(v.text).slice(0, 80))}”.<br/>Try the attendee's name or email.</p>${missActions}</div>`;
      return;
    }
    if (v.notFound) {
      box.innerHTML = `<div class="notfound pop"><div class="big">Registration not found</div>
        <p class="muted">ID <strong>${esc(v.id)}</strong> is not in the registrations sheet.<br/>Search by name or email, or send the attendee to the help desk.</p>${missActions}</div>`;
      return;
    }

    const r = state.records.get(v.id);
    if (!r) { state.view = null; renderResult(); return; }
    const cancelled = isCancelled(r);
    const busy = state.pending.has(r.id) || isTmp(r.id);
    const checks = [];
    if (isGuest(r)) {
      checks.push(`<div class="check check-ok"><span class="ic">★</span><span>Walk-in ${esc(r.guestType || 'Guest')}<small>${isTmp(r.id) ? 'Saving…' : `ID ${esc(r.id)}`}${r.org ? ` · ${esc(r.org)}` : ''}</small></span></div>`);
    } else {
      checks.push(`<div class="check check-ok"><span class="ic">✓</span><span>Registered<small>ID ${esc(r.id)}</small></span></div>`);
    }
    if (isGuest(r)) {
      // no membership check for guests/speakers
    } else if (r.member === 'email') {
      checks.push(`<div class="check check-ok"><span class="ic">✓</span><span>Active PMI UAE member</span></div>`);
    } else if (r.member === 'name') {
      checks.push(`<div class="check check-warn"><span class="ic">!</span><span>Active member — matched by name<small>Registration email differs from the membership record</small></span></div>`);
    } else {
      checks.push(`<div class="check check-bad"><span class="ic">✕</span><span>Not in Active Members list<small>${esc(r.email)} not found in ActiveMembersList</small></span></div>`);
    }
    if (cancelled) checks.push(`<div class="check check-bad"><span class="ic">✕</span><span>Registration cancelled</span></div>`);

    let action;
    if (r.checkedIn && v.justDone) {
      action = `<div class="done pop">✓ Checked in — give ${lanyardWord(r)} card<small>${esc(shortTime(r.time))}${busy ? ' · saving…' : ''}</small></div>
        <div class="undo-row"><button class="btn-ghost btn-sm" data-undo="${esc(r.id)}" ${busy ? 'disabled' : ''}>Undo</button></div>`;
    } else if (r.checkedIn) {
      action = `<div class="already pop">Already checked in<small>at ${esc(r.time || '—')}</small></div>
        <div class="undo-row"><button class="btn-ghost btn-sm" data-undo="${esc(r.id)}" ${busy ? 'disabled' : ''}>Undo check-in</button></div>`;
    } else if (r.member !== 'none' && !cancelled) {
      action = `<button class="btn btn-lg btn-ok" data-checkin="${esc(r.id)}" ${busy ? 'disabled' : ''}>Check in</button>`;
    } else {
      action = `<button class="btn btn-lg btn-warn" data-checkin="${esc(r.id)}" data-override="1" ${busy ? 'disabled' : ''}>Check in anyway</button>
        <p class="muted small" style="text-align:center;margin:0">Only if the registration lead approves.</p>`;
    }

    box.innerHTML = `<div class="pop">
      ${lanyardHtml(r)}
      <p class="person-name">${esc(fullName(r))}</p>
      <p class="person-meta">${esc([r.email, r.phone].filter(Boolean).join(' · ') || r.org || '')}</p>
      <div class="checks">${checks.join('')}</div>
      <div class="actions">${action}<button class="btn btn-secondary next-btn" data-next>Next attendee</button></div>
    </div>`;
  }

  const isNarrow = () => window.matchMedia('(max-width: 719px)').matches;
  function revealResult() {
    // Phones show the result as a bottom sheet; wide screens show it beside the scanner.
    if (isNarrow()) $('resultCard').scrollTop = 0;
  }

  function renderSearchResults(hits) {
    const ul = $('searchResults');
    ul.innerHTML = hits.map((r) => `<li><button type="button" data-open="${esc(r.id)}">
      <span class="sr-name">${esc(fullName(r))}</span>
      ${trackPill(r)}
      <span class="sr-meta">${r.checkedIn ? '✓ in' : `#${esc(r.id)}`}</span></button></li>`).join('');
    ul.hidden = !hits.length;
  }
  function hideSearchResults() { $('searchResults').hidden = true; }

  function trackPill(r) {
    const colour = lanyardOf(r);
    if (!colour) return '<span class="pill pill-grey">Ask</span>';
    const name = colour[0] + colour.slice(1).toLowerCase();
    const sub = isGuest(r) ? '' : r.track === 'AI' ? ' · AI' : ' · Sust.';
    return `<span class="pill pill-l-${colour.toLowerCase()}">${name}${sub}</span>`;
  }
  function memberPill(r) {
    if (isGuest(r)) return `<span class="pill pill-purple">${esc(r.guestType || 'Guest')}</span>`;
    if (isCancelled(r)) return '<span class="pill pill-red">Cancelled</span>';
    if (r.member === 'email') return '<span class="pill pill-green">Member</span>';
    if (r.member === 'name') return '<span class="pill pill-amber">Name match</span>';
    return '<span class="pill pill-red">Not found</span>';
  }

  let listRenderQueued = false;
  function renderList() {
    if ($('view-list').hidden || listRenderQueued) return;
    listRenderQueued = true;
    requestAnimationFrame(() => {
      listRenderQueued = false;
      const q = norm($('listSearch').value);
      const terms = q ? q.split(/\s+/) : [];
      let rows = [...state.records.values()].filter((r) => {
        if (state.filter === 'in' && !r.checkedIn) return false;
        if (state.filter === 'pending' && (r.checkedIn || isCancelled(r))) return false;
        if (!terms.length) return true;
        const hay = norm(`${fullName(r)} ${r.email} ${r.org || ''} ${r.id}`);
        return terms.every((t) => hay.includes(t));
      });
      if (state.filter === 'in') rows.sort((a, b) => timeKey(b.time).localeCompare(timeKey(a.time)));
      else rows.sort((a, b) => fullName(a).localeCompare(fullName(b)));
      $('listCount').textContent = `${rows.length} ${rows.length === 1 ? 'person' : 'people'}`;
      $('listBody').innerHTML = rows.map((r) => `<tr class="clickable" data-open="${esc(r.id)}">
        <td><div class="t-name">${esc(fullName(r))}</div><div class="t-email">${esc(r.email || r.org || '')}</div></td>
        <td>${isTmp(r.id) ? '…' : esc(r.id)}</td>
        <td>${trackPill(r)}</td>
        <td>${memberPill(r)}</td>
        <td>${r.checkedIn ? `<span class="pill pill-green">✓ ${esc(shortTime(r.time))}</span>` : '<span class="muted">—</span>'}</td>
      </tr>`).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:24px">No one here yet.</td></tr>`;
    });
  }

  function switchView(name) {
    document.querySelectorAll('.tab').forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
    });
    $('view-checkin').hidden = name !== 'checkin';
    $('view-list').hidden = name !== 'list';
    if (name === 'list') renderList();
  }

  // ---------------------------------------------------------------- access key

  function openKeyDialog(message) {
    const dlg = $('keyDialog');
    $('keyError').hidden = !message;
    $('keyError').textContent = message || '';
    if (!dlg.open) { $('keyInput').value = ''; dlg.showModal(); }
  }

  async function onKeySubmit(e) {
    e.preventDefault();
    const k = $('keyInput').value.trim();
    if (!k) return;
    setKey(k);
    $('keyDialog').close();
    try { await loadAll(); flushQueue().catch(() => {}); } catch (_) { markSynced(false); }
  }

  // ---------------------------------------------------------------- events

  function bind() {
    $('scanBtn').addEventListener('click', () => (scanning ? stopScanner() : startScanner()));
    $('switchCamBtn').addEventListener('click', switchCamera);
    $('manualForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('manualInput').value;
      if (!v.trim()) return;
      handleInput(v);
      if (extractId(v)) $('manualInput').value = '';
    });
    $('manualInput').addEventListener('input', (e) => {
      const v = e.target.value;
      if (extractId(v) || norm(v).length < 2) return hideSearchResults();
      renderSearchResults(search(v));
    });
    document.addEventListener('click', (e) => {
      const open = e.target.closest('[data-open]');
      if (open) {
        hideSearchResults();
        $('manualInput').value = '';
        switchView('checkin');
        showById(open.dataset.open);
        if (!isNarrow()) window.scrollTo({ top: $('resultCard').offsetTop - 12, behavior: 'smooth' });
        return;
      }
      const ci = e.target.closest('[data-checkin]');
      if (ci) return checkIn(ci.dataset.checkin, !!ci.dataset.override);
      if (e.target.closest('[data-addguest]')) return openGuestDialog();
      if (e.target.closest('[data-next]') || e.target.id === 'sheetBackdrop') {
        state.view = null;
        lastScan = { text: '', at: 0 }; // allow re-scanning the same badge
        renderResult();
        return;
      }
      const un = e.target.closest('[data-undo]');
      if (un) return undoCheckIn(un.dataset.undo);
    });
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
    document.querySelectorAll('.seg-btn').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('active', x === b));
      state.filter = b.dataset.filter;
      renderList();
    }));
    $('listSearch').addEventListener('input', renderList);
    $('keyForm').addEventListener('submit', onKeySubmit);
    $('addGuestBtn').addEventListener('click', openGuestDialog);
    $('guestForm').addEventListener('submit', onGuestSubmit);
    $('guestCancel').addEventListener('click', () => $('guestDialog').close());
    $('changeKeyBtn').addEventListener('click', () => openKeyDialog());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      schedulePoll(50);
      if (scanning) verifyCamera(0); // iOS stops the camera while the app is in the background
    });
    window.addEventListener('online', () => schedulePoll(50));
  }

  // ---------------------------------------------------------------- demo backend

  let demoDb = null;
  function demoApi(action, p) {
    if (!demoDb) {
      const first = ['Aisha', 'Omar', 'Priya', 'Rahul', 'Fatima', 'Yousef', 'Sara', 'Arjun', 'Layla', 'Hassan', 'Meera', 'Khalid', 'Noor', 'Vikram', 'Huda', 'Ravi', 'Mariam', 'Imran', 'Zainab', 'Daniel'];
      const last = ['Al Mansoori', 'Sharma', 'Khan', 'Haddad', 'Nair', 'Rahman', 'Iyer', 'Saleh', 'Fernandes', 'Qureshi'];
      demoDb = [];
      for (let i = 0; i < 60; i++) {
        const fn = first[i % first.length];
        const ln = last[(i * 7) % last.length];
        demoDb.push({
          id: String(9561 + i),
          firstName: fn,
          lastName: ln,
          email: `${fn}.${ln}`.toLowerCase().replace(/\s/g, '') + '@example.com',
          track: i % 3 === 0 ? 'SUSTAINABILITY' : 'AI',
          member: i % 5 === 4 ? 'none' : i % 11 === 10 ? 'name' : 'email',
          paymentStatus: i === 13 ? 'Cancelled' : 'Paid',
          checkedIn: i % 4 === 1,
          time: i % 4 === 1 ? `10-10-2026 08:${String(10 + (i % 40)).padStart(2, '0')}:00` : '',
        });
      }
    }
    const find = (id) => demoDb.find((r) => r.id === String(id));
    const delay = (v) => new Promise((res) => setTimeout(() => res(v), 250));
    switch (action) {
      case 'data': return delay({ ok: true, records: demoDb.map((r) => ({ ...r })) });
      case 'status': return delay({ ok: true, count: demoDb.length, checked: demoDb.filter((r) => r.checkedIn).map((r) => [r.id, r.time]) });
      case 'lookup': return delay({ ok: true, record: find(p.id) ? { ...find(p.id) } : null });
      case 'checkin': {
        const r = find(p.id);
        if (!r) return Promise.reject(new ApiError('NOT_FOUND'));
        if (r.checkedIn) return delay({ ok: true, checkedIn: true, time: r.time, already: true });
        r.checkedIn = true; r.time = dubaiNow();
        return delay({ ok: true, checkedIn: true, time: r.time });
      }
      case 'addGuest': {
        const dup = demoDb.find((r) => r.ref && r.ref === p.ref);
        if (dup) return delay({ ok: true, record: { ...dup }, already: true });
        const n = demoDb.filter(isGuest).length + 1;
        const rec = {
          id: `G-${n}`, firstName: p.firstName, lastName: p.lastName, email: p.email || '', phone: p.phone || '', org: p.org || '',
          guestType: p.type, track: '', lanyard: p.lanyard, member: 'guest', paymentStatus: '', checkedIn: true, time: dubaiNow(), ref: p.ref,
        };
        demoDb.push(rec);
        return delay({ ok: true, record: { ...rec } });
      }
      case 'undo': {
        const r = find(p.id);
        if (r) { r.checkedIn = false; r.time = ''; }
        return delay({ ok: true, checkedIn: false, time: '' });
      }
      default: return Promise.reject(new ApiError('UNKNOWN_ACTION'));
    }
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    if (CFG.EVENT_NAME) $('eventName').textContent = CFG.EVENT_NAME;
    $('gTypes').innerHTML = (CFG.GUEST_TYPES || ['Speaker', 'Guest']).map((t) =>
      `<label class="chip"><input type="radio" name="gType" value="${esc(t)}" /><span><i class="dot dot-${guestLanyard(t).toLowerCase()}"></i>${esc(t)}</span></label>`).join('');
    // Share links can carry the key as #key=XXXX; store it and strip it from the address bar.
    const hashKey = new URLSearchParams(location.hash.slice(1)).get('key');
    if (hashKey) {
      setKey(hashKey);
      history.replaceState(null, '', location.pathname + location.search);
    }
    bind();
    renderAll();
    setInterval(() => { if (!document.hidden && state.loaded) loadAll().catch(() => markSynced(false)); }, FULL_RELOAD_MS);
    if (!DEMO && !getKey()) {
      openKeyDialog();
      return schedulePoll(POLL_MS);
    }
    loadAll().catch(() => markSynced(false)).finally(() => schedulePoll());
  }

  boot();
})();
