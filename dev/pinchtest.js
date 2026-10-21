const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T10:20:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/z0-before.png' });
  const cdp = await ctx.newCDPSession(p);
  const pinch = async (y, from, to, steps = 10) => {
    const pts = (g) => [{ x: 195, y: y - g / 2, id: 1 }, { x: 205, y: y + g / 2, id: 2 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
    for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / steps) }); await p.waitForTimeout(20); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForTimeout(500);
  };
  const info = async () => p.evaluate(() => ({ ppm: +document.querySelector('.tl-wrap').dataset.ppm, slots: document.querySelectorAll('.slot').length, scale: visualViewport.scale, zoom: JSON.parse(localStorage.getItem('rvu.ui.v1')).zoom }));
  await pinch(500, 300, 100);
  console.log('pinched in (out):', JSON.stringify(await info()));
  await p.screenshot({ path: OUT + '/z1-zoomed-out.png' });
  await pinch(500, 100, 400);
  console.log('pinched out (in):', JSON.stringify(await info()));
  await p.screenshot({ path: OUT + '/z2-zoomed-in.png' });
  // tap a slot still works after pinch
  await p.waitForTimeout(500);
  await p.locator('.slot.FU').first().tap(); await p.waitForTimeout(300);
  console.log('sheet opens after pinch:', await p.locator('#sheet').isVisible());
  await p.locator('#scrim').tap({ position: { x: 20, y: 20 } }); await p.waitForTimeout(200);
  // week view zoom independent
  await p.locator('[data-view="week"]').tap(); await p.waitForTimeout(300);
  await pinch(600, 300, 120);
  await p.screenshot({ path: OUT + '/z3-week-out.png' });
  console.log('week:', JSON.stringify(await info()));
  await p.reload(); await p.waitForTimeout(500);
  console.log('after reload:', JSON.stringify(await info()));
  console.log('toast visible when idle:', await p.evaluate(() => getComputedStyle(document.getElementById('toast')).visibility));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
