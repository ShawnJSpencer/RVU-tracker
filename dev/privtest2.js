const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(400);
  const on = () => p.evaluate(() => document.documentElement.classList.contains('privacy'));
  const page = () => p.evaluate(() => document.querySelector('#tabs .on')?.dataset.go);
  const clickBrand = () => p.evaluate(() => document.querySelector('.brand').click());
  // from Reports: double tap (2 clicks), and also double tap where iOS sends duplicate clicks (4 clicks)
  for (const [label, seq] of [['double tap', [0, 150]], ['double tap with duplicate clicks', [0, 2, 150, 152]], ['triple tap', [0, 150, 300]]]) {
    await p.locator('[data-go="reports"]').first().tap(); await p.waitForTimeout(300);
    let t = 0; for (const at of seq) { await p.waitForTimeout(at - t); t = at; await clickBrand(); }
    await p.waitForTimeout(300);
    console.log(`from Reports, ${label}:`, await page(), 'privacy =', await on());
  }
  // on Calendar: double tap toggles, duplicate clicks still toggle exactly once
  await p.waitForTimeout(900);
  await clickBrand(); await p.waitForTimeout(150); await clickBrand(); await p.waitForTimeout(200);
  console.log('on Calendar, double tap -> privacy =', await on());
  await p.waitForTimeout(600);
  await clickBrand(); await p.waitForTimeout(2); await clickBrand(); await p.waitForTimeout(150); await clickBrand(); await p.waitForTimeout(2); await clickBrand(); await p.waitForTimeout(200);
  console.log('on Calendar, double tap w/ duplicates -> privacy =', await on());
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
