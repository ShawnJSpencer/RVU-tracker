const { chromium } = require('/opt/npm-tools/node_modules/playwright');
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, timezoneId: 'America/Denver' });
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); await p.clock.install({ time: new Date('2026-10-20T15:10:00-06:00') });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(500);
  await p.locator('[data-view="week"]').click(); await p.waitForTimeout(300);
  const el = p.locator('.tl-col[data-date="2026-10-22"] .slot', { hasText: 'F/U' }).first();
  const bx = await el.boundingBox();
  const fri = await p.locator('.tl-col[data-date="2026-10-23"]').boundingBox();
  await p.mouse.move(bx.x + 20, bx.y + 10); await p.mouse.down();
  await p.mouse.move(bx.x + 30, bx.y + 30, { steps: 3 });
  await p.mouse.move(fri.x + 20, bx.y + 10 + 1.15 * 30 * 2, { steps: 8 });
  await p.mouse.up(); await p.waitForTimeout(400);
  const res = await p.evaluate(() => { const C = window.__rvu.C, s = window.__rvu.state(); return { thu: C.resolveDay(s, '2026-10-22').filter(C.isPatient).length, fri: C.resolveDay(s, '2026-10-23').map((x) => C.fmtTime(x.start)).join(',') }; });
  console.log(JSON.stringify(res), 'sheetOpen:', await p.locator('#sheet').isVisible());
  // day view elastic via wheel at top
  await p.locator('[data-view="day"]').click(); await p.waitForTimeout(200);
  await p.evaluate(() => (document.querySelector('.tl-scroll').scrollTop = 0));
  await p.mouse.move(700, 400);
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, -120); await p.waitForTimeout(30); }
  await p.waitForTimeout(300);
  console.log('first gutter label after pull:', await p.locator('.tl-gutter span').first().innerText());
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
