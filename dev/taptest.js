const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T09:00:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(400);
  for (let i = 0; i < 6; i++) { await p.locator('[data-nav="1"]').tap(); await p.waitForTimeout(60); }
  console.log('after 6 fast taps:', await p.locator('#dateTitle').innerText());
  await p.locator('[data-view="month"]').tap(); await p.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await p.locator('[data-nav="-1"]').tap(); await p.waitForTimeout(60); }
  console.log('month after 3 fast taps back:', await p.locator('#dateTitle').innerText());
  console.log('touch-action:', await p.evaluate(() => getComputedStyle(document.querySelector('[data-nav="1"]')).touchAction), 'scale:', await p.evaluate(() => visualViewport.scale));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
