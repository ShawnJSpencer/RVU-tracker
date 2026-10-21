const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const OUT = process.argv[2];
(async () => {
  const b = await chromium.launch(); const errors = [];
  // normal phone browser
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T10:20:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  await p.locator('[data-count="msg"]').tap(); await p.waitForTimeout(250);
  await p.locator('.count-pop .plus').tap(); await p.locator('.count-pop .plus').tap(); await p.locator('.count-pop .plus').tap(); await p.waitForTimeout(150);
  await p.screenshot({ path: OUT + '/c1-pop.png' });
  await p.locator('.count-pop .minus').tap(); await p.waitForTimeout(120);
  await p.screenshot({ path: OUT + '/c2-tiny.png' });
  await p.waitForTimeout(600);
  console.log('pop shows:', await p.locator('.count-pop b').innerText(), '| bar:', await p.locator('[data-count="msg"] b').innerText());
  const ctr = await p.evaluate(() => window.__rvu.state().counters['2026-10-20']);
  console.log('stored:', JSON.stringify(ctr));
  // tap elsewhere closes
  await p.locator('.tl-gutter').tap({ position: { x: 10, y: 50 } }); await p.waitForTimeout(200);
  console.log('closed on outside tap:', !(await p.locator('.count-pop').count()));
  // minus at zero
  await p.locator('[data-count="rx"]').tap(); await p.waitForTimeout(200); await p.locator('.count-pop .minus').tap(); await p.waitForTimeout(200);
  console.log('rx stays 0:', await p.locator('.count-pop b').innerText());
  await p.locator('[data-count="rx"]').tap(); await p.waitForTimeout(200);
  console.log('tap same counter toggles closed:', !(await p.locator('.count-pop').count()));
  // settings time off
  await p.locator('[data-go="settings"]').first().tap(); await p.waitForTimeout(300);
  await p.locator('#offAdd').scrollIntoViewIfNeeded();
  const card = p.locator('.card', { hasText: 'Time off' });
  await card.screenshot({ path: OUT + '/c3-timeoff.png' });
  console.log('gapfix (browser):', await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--gapfix')));
  // simulated iPhone home-screen app with a short viewport
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 785 }, screen: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx2.addInitScript(() => Object.defineProperty(navigator, 'standalone', { get: () => true }));
  await ctx2.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const q = await ctx2.newPage(); await q.goto('http://localhost:8765/'); await q.waitForTimeout(500);
  console.log('standalone sim:', JSON.stringify(await q.evaluate(() => ({ gap: getComputedStyle(document.documentElement).getPropertyValue('--gapfix'), appBottom: document.querySelector('.app').getBoundingClientRect().bottom, innerH: innerHeight, tabsBottom: document.querySelector('.tabs').getBoundingClientRect().bottom }))));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
