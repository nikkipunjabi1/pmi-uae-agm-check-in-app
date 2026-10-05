// Simulates the registration desks against the live Apps Script backend, without changing the sheet.
//
//   ACCESS_KEY=xxxx node tools/loadtest.mjs [desks=9] [minutes=2]
//
// Each simulated desk polls `status` like the app does (every ~15 s with jitter) and sends a
// check-in roughly every 40 s for a non-existent ID (exercises the lock + row lookup, writes nothing).
// 9 desks × 1 check-in / 40 s ≈ 800 check-ins per hour.
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('../public/config.js', import.meta.url), 'utf8');
const URL_ = (cfg.match(/API_URL:\s*'([^']+)'/) || [])[1];
const KEY = process.env.ACCESS_KEY;
const DESKS = Number(process.argv[2] || 9);
const MINUTES = Number(process.argv[3] || 2);
if (!URL_ || !KEY) { console.error('Need API_URL in public/config.js and ACCESS_KEY env var'); process.exit(1); }

const stats = {};
async function call(action, extra = {}) {
  const t = Date.now();
  let ok = false;
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, key: KEY, ...extra }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    ok = data.ok || data.error === 'NOT_FOUND';
  } catch (_) {}
  const s = (stats[action] ||= { n: 0, fail: 0, ms: [] });
  s.n++; if (!ok) s.fail++; s.ms.push(Date.now() - t);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const end = Date.now() + MINUTES * 60000;
async function desk(i) {
  await sleep(Math.random() * 5000);
  await call('data');
  let nextCheckin = Date.now() + Math.random() * 40000;
  while (Date.now() < end) {
    if (Date.now() >= nextCheckin) { await call('checkin', { id: '1' }); nextCheckin = Date.now() + 40000 * (0.5 + Math.random()); }
    await call('status');
    await sleep(15000 * (0.8 + Math.random() * 0.4));
  }
}

console.log(`${DESKS} desks for ${MINUTES} min against ${URL_.slice(0, 60)}…`);
await Promise.all(Array.from({ length: DESKS }, (_, i) => desk(i)));
const pct = (a, p) => a.sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))];
for (const [k, s] of Object.entries(stats)) {
  console.log(`${k.padEnd(8)} n=${String(s.n).padStart(4)} fail=${s.fail}  median=${pct(s.ms, 0.5)}ms  p90=${pct(s.ms, 0.9)}ms  max=${Math.max(...s.ms)}ms`);
}
