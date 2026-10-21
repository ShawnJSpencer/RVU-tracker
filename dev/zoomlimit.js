const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T10:20:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(p);
  const touch = async (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const pinch = async (y, from, to) => {
    const pts = (g) => [{ x: 195, y: y - g / 2, id: 1 }, { x: 205, y: y + g / 2, id: 2 }];
    await touch('touchStart', pts(from));
    for (let i = 1; i <= 12; i++) { await touch('touchMove', pts(from + (to - from) * i / 12)); await p.waitForTimeout(20); }
    await touch('touchEnd', []); await p.waitForTimeout(500);
  };
  const fit = async () => p.evaluate(() => { const sc = document.querySelector('.tl-scroll'), inner = document.querySelector('.tl-inner'); let avail = sc.clientHeight; sc.querySelectorAll('.pull-hint').forEach((h) => (avail -= h.offsetHeight)); return { inner: Math.round(inner.offsetHeight), avail, scrollable: sc.scrollHeight > sc.clientHeight + 1, appBottom: document.querySelector('.app').getBoundingClientRect().bottom, vh: innerHeight }; });
  await pinch(500, 400, 40);
  console.log('day max pinch-out:', JSON.stringify(await fit()));
  await p.screenshot({ path: OUT + '/l1-day-min.png' });
  // pull up at bottom (whole day fits) should open a later slot
  await touch('touchStart', [{ x: 200, y: 700 }]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: 200, y: 700 - 25 * i }]); await p.waitForTimeout(15); }
  await touch('touchEnd', []); await p.waitForTimeout(600);
  console.log('after pull-up, last label:', await p.locator('.tl-gutter span').last().innerText(), JSON.stringify(await fit()));
  await p.locator('[data-view="week"]').tap(); await p.waitForTimeout(300);
  await pinch(560, 300, 40);
  console.log('week max pinch-out:', JSON.stringify(await fit()));
  await p.screenshot({ path: OUT + '/l2-week-min.png' });
  await pinch(560, 60, 300);
  console.log('zoom back in:', JSON.stringify(await fit()));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
