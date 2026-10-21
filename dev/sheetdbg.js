const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T10:20:00-06:00') });
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(p);
  await p.locator('.slot.FU').first().tap(); await p.waitForTimeout(400);
  const r = await p.locator('.grab-zone').boundingBox(); const g = r.y + r.height / 2;
  const at = await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el.className + ' / ' + el.tagName + ' scrollTop=' + document.getElementById('sheet').scrollTop; }, [195, g + 200]);
  console.log('target at start:', at);
  await p.evaluate(() => { const sh = document.getElementById('sheet'); ['touchstart', 'touchmove', 'touchend'].forEach((t) => sh.addEventListener(t, (e) => console.log(t, e.touches[0]?.clientY, e.defaultPrevented, sh.style.transform))); });
  p.on('console', (m) => console.log('  ', m.text()));
  const y1 = g + 200;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: y1 }] });
  for (let i = 1; i <= 3; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: y1 + 20 * i }] }); await p.waitForTimeout(10); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(450);
  console.log('closed:', !(await p.locator('#sheet').isVisible()));
  await b.close();
})();
