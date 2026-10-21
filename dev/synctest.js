const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const histTxt = fs.readFileSync('/home/claude/history.json', 'utf8');
const store = { 'data.json': null, 'history.json': { text: histTxt, sha: 'h1' } };
let shaN = 1, puts = 0;
async function route(r) {
  const req = r.request(), url = new URL(req.url());
  const m = url.pathname.match(/\/repos\/ShawnJSpencer\/RVU-tracker-data\/contents\/(.+)$/);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors });
  if (url.pathname.endsWith('/dispatches')) return r.fulfill({ status: 204, headers: cors });
  if (!m) return r.fulfill({ status: 404, headers: cors, body: '{}' });
  const f = m[1];
  if (req.headers()['authorization'] !== 'Bearer good') return r.fulfill({ status: 401, headers: cors, body: '{"message":"Bad credentials"}' });
  if (req.method() === 'GET') {
    const e = store[f]; if (!e) return r.fulfill({ status: 404, headers: cors, body: '{"message":"Not Found"}' });
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ sha: e.sha, encoding: 'base64', content: Buffer.from(e.text).toString('base64') }) });
  }
  if (req.method() === 'PUT') {
    const b = JSON.parse(req.postData()); const e = store[f];
    if (e && b.sha !== e.sha) return r.fulfill({ status: 409, headers: cors, body: '{"message":"conflict"}' });
    if (!e && b.sha) return r.fulfill({ status: 422, headers: cors, body: '{}' });
    puts++; store[f] = { text: Buffer.from(b.content, 'base64').toString(), sha: 's' + (++shaN) };
    return r.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ content: { sha: store[f].sha } }) });
  }
}
(async () => {
  const b = await chromium.launch(); const errors = [];
  async function device(name) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Denver', isMobile: true, hasTouch: true });
    await ctx.route('https://api.github.com/**', route);
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T15:10:00-06:00') });
    p.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
    return p;
  }
  const A = await device('A');
  // wrong token first
  await A.locator('[data-go="settings"]').first().click();
  await A.fill('#syToken', 'bad'); await A.locator('#sySave').click(); await A.waitForTimeout(800);
  console.log('bad token status:', await A.locator('#syncCard .help').first().innerText());
  await A.fill('#syToken', 'good'); await A.locator('#sySave').click(); await A.waitForTimeout(1200);
  console.log('good token status:', await A.locator('#syncCard .help').first().innerText(), '| hist days:', await A.evaluate(() => Object.keys(window.__rvu.hist().days).length));
  // A bills a note
  await A.locator('[data-go="calendar"]').first().click(); await A.waitForTimeout(200);
  await A.locator('.slot.overdue').first().click(); await A.locator('[data-code="99215"]').click(); await A.locator('#doneBtn').click();
  await A.waitForTimeout(3500);
  const B = await device('B');
  await B.locator('[data-go="settings"]').first().click(); await B.fill('#syToken', 'good'); await B.locator('#sySave').click(); await B.waitForTimeout(1200);
  await B.locator('[data-go="calendar"]').first().click(); await B.waitForTimeout(300);
  console.log('B sees billed:', await B.locator('.slot.billed').count());
  // both edit different slots offline-ish, then sync
  await B.locator('.slot.overdue').first().click(); await B.locator('[data-status="noshow"]').click();
  await A.locator('.slot.overdue').nth(1).click(); await A.locator('[data-code="99214"]').click(); await A.locator('#doneBtn').click();
  await A.waitForTimeout(3500); await B.waitForTimeout(500);
  await B.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await B.waitForTimeout(1500);
  await A.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await A.waitForTimeout(1500);
  const sum = async (p) => p.evaluate(() => { const C = window.__rvu.C; const s = window.__rvu.state(); return C.resolveDay(s, '2026-10-20').filter((x) => C.isPatient(x)).map((x) => x.status[0]).join(''); });
  console.log('A day:', await sum(A), ' B day:', await sum(B), ' puts:', puts);
  // big fx smoke test
  const names = await A.evaluate(() => window.__rvu.FX.fxNames());
  for (const n of [...names.small, ...names.big]) { await A.evaluate((k) => window.__rvu.FX.celebrate(k), n); await A.waitForTimeout(120); }
  await A.waitForTimeout(800);
  console.log('ERRORS', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
