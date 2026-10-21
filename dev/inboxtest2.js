const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), cp = require('child_process'), path = require('path');
const DIR = '/tmp/claude-0/-home-claude/c570a9af-ae86-5f4e-b20e-57fbb5f68c39/scratchpad/ocr';
const OUT = '/tmp/claude-0/-home-claude/c570a9af-ae86-5f4e-b20e-57fbb5f68c39/scratchpad/shots';
let n = 0;
const savePng = (u) => { const f = path.join(DIR, `_g${n++ % 50}.png`); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; };
function tsvLines(file) {
  const out = cp.execFileSync('tesseract', [file, '-', '--psm', '6', 'tsv'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const lines = new Map();
  for (const r of out.trim().split('\n').slice(1).map((l) => l.split('\t'))) {
    if (r[0] !== '5' || !(r[11] || '').trim()) continue;
    const k = r.slice(2, 5).join('.'); const [x, y, w, h] = r.slice(6, 10).map(Number);
    if (!lines.has(k)) lines.set(k, { words: [] });
    lines.get(k).words.push({ text: r[11], bbox: { x0: x, y0: y, x1: x + w, y1: y + h } });
  }
  return [...lines.values()].map((l) => ({ ...l, text: l.words.map((w) => w.text).join(' ') }));
}
(async () => {
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${DIR}/cam2.y4m`] });
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver', permissions: ['camera'] });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  // stand-in for tesseract.js: same API, backed by the local tesseract engine
  await ctx.route('**/tesseract.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: `
    window.Tesseract = { createWorker: async (lang, oem, opts) => { opts?.logger?.({ status: 'loading tesseract core', progress: 1 });
      let psm = '6'; return {
        setParameters: async (p) => { if (p.tessedit_pageseg_mode) psm = p.tessedit_pageseg_mode; },
        recognize: async (canvas, o, out) => { const u = canvas.toDataURL();
          if (psm === '7') return { data: { text: await window.__ocrDigits(u) } };
          const lines = await window.__ocrLines(u); return { data: { text: '', blocks: [{ paragraphs: [{ lines }] }] } }; },
        terminate: async () => {} }; } };` }));
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T09:40:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.exposeFunction('__ocrLines', (u) => tsvLines(savePng(u)));
  await p.exposeFunction('__ocrDigits', (u) => cp.execFileSync('tesseract', [savePng(u), '-', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789/'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(600);
  // calendar tallies -> inbox
  await p.locator('[data-count="msg"]').tap(); await p.locator('.count-pop .plus').tap(); await p.locator('.count-pop .plus').tap(); await p.waitForTimeout(100);
  await p.screenshot({ path: OUT + '/i0-cal.png' });
  // bottom bar: scroll to inbox tab
  const tabsInfo = await p.evaluate(() => { const t = document.getElementById('tabs'); return { sw: t.scrollWidth, cw: t.clientWidth, badge: document.getElementById('ibBadge').textContent }; });
  console.log('tabs', JSON.stringify(tabsInfo));
  await p.locator('[data-go="inbox"]').first().evaluate((e) => e.click()); await p.waitForTimeout(400);
  await p.screenshot({ path: OUT + '/i1-inbox.png' });
  // empty it with minus
  await p.locator('[data-ibminus="msg"]').tap(); await p.waitForTimeout(150);
  await p.locator('[data-ibminus="msg"]').tap(); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/i2-zero.png' });
  await p.waitForTimeout(3500);
  // import via live (fake) camera
  await p.locator('[data-ibimport]').tap();
  const t0 = Date.now();
  await p.waitForSelector('.cam.locked', { timeout: 120000 });
  console.log('locked after', Date.now() - t0, 'ms:', await p.locator('.cam-status').innerText());
  await p.screenshot({ path: OUT + '/i3-cam.png' });
  console.log(await p.locator('.cam-list').innerText());
  await p.locator('[data-cam=apply]').tap(); await p.waitForTimeout(800);
  await p.screenshot({ path: OUT + '/i4-after.png' });
  console.log('inbox after import:', JSON.stringify(await p.evaluate(() => window.__rvu.state().inbox.cats)));
  console.log('cam stopped:', await p.evaluate(() => !document.querySelector('.cam')));
  // photo path
  await p.locator('[data-ibimport]').tap(); await p.waitForTimeout(300);
  const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.locator('.cam-btns label').click()]);
  await fc.setFiles(path.join(DIR, 'epic.jpg'));
  await p.waitForSelector('.cam.locked', { timeout: 120000 });
  await p.screenshot({ path: OUT + '/i6-photo.png' }); console.log('photo:', await p.locator('.cam-status').innerText(), '|', (await p.locator('.cam-list').innerText()).replace(/\n/g, ' · '));
  await p.locator('.cam-x').tap();
  // tabs scroll: go to settings at far right
  await p.locator('#tabs').evaluate((t) => (t.scrollLeft = 1000)); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/i5-tabs-scrolled.png', clip: { x: 0, y: 760, width: 390, height: 84 } });
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
