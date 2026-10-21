const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const OUT = process.argv[2];
const hist = fs.readFileSync('/home/claude/history.json', 'utf8');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.addInitScript((h) => { if (!localStorage.getItem('rvu.hist.v1')) localStorage.setItem('rvu.hist.v1', h); }, hist);
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T10:20:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const drag = async (x1, y1, x2, y2, steps = 8, gap = 16) => {
    await touch('touchStart', [{ x: x1, y: y1 }]);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', [{ x: x1 + (x2 - x1) * i / steps, y: y1 + (y2 - y1) * i / steps }]); await p.waitForTimeout(gap); }
    await touch('touchEnd', []); await p.waitForTimeout(500);
  };
  const title = () => p.locator('#dateTitle').innerText();
  await drag(320, 500, 60, 510); console.log('swipe left:', await title());
  await drag(60, 500, 330, 495); console.log('swipe right:', await title());
  await drag(60, 500, 330, 495); console.log('swipe right:', await title());
  await drag(200, 500, 160, 502, 6, 16); console.log('short slow drag (no change):', await title());
  await drag(200, 600, 205, 300); console.log('vertical scroll (no change):', await title(), 'sheet:', await p.locator('#sheet').isVisible());
  // quick double swipe
  await drag(320, 500, 60, 500, 5, 8); await drag(320, 500, 60, 500, 5, 8); console.log('two fast swipes left:', await title(), 'view:', await p.locator('#viewSeg .on').innerText());
  await p.locator('[data-view="week"]').tap(); await p.waitForTimeout(200);
  await drag(330, 600, 50, 600); console.log('week swipe left:', await title());
  await p.locator('[data-view="month"]').tap(); await p.waitForTimeout(200);
  await drag(50, 700, 330, 700); console.log('month swipe right:', await title());
  await p.locator('[data-view="day"]').tap(); await p.waitForTimeout(200);
  // mid-swipe screenshot
  await touch('touchStart', [{ x: 320, y: 500 }]);
  for (let i = 1; i <= 5; i++) { await touch('touchMove', [{ x: 320 - 30 * i, y: 500 }]); await p.waitForTimeout(16); }
  await p.screenshot({ path: OUT + '/w-midswipe.png' });
  await touch('touchEnd', []); await p.waitForTimeout(500);
  // tap a slot still opens the sheet
  await p.locator('[data-nav="today"]').tap(); await p.waitForTimeout(300);
  await p.locator('.slot.FU').first().tap(); await p.waitForTimeout(300);
  console.log('tap slot opens sheet:', await p.locator('#sheet').isVisible());
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
