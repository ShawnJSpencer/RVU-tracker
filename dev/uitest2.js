const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const OUT = process.argv[2];
const hist = fs.readFileSync('/home/claude/history.json', 'utf8');
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'America/Denver' });
  await ctx.addInitScript((h) => { if (!localStorage.getItem('rvu.hist.v1')) localStorage.setItem('rvu.hist.v1', h); }, hist);
  const p = await ctx.newPage();
  await p.clock.install({ time: new Date('2026-10-20T15:10:00-06:00') });
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await p.goto('http://localhost:8765/'); await p.waitForTimeout(600);
  // bill all 7 past notes on Tuesday, one by one
  let n = 0;
  while (await p.locator('.slot.overdue').count()) {
    await p.locator('.slot.overdue').first().click(); await p.waitForTimeout(150);
    await p.locator('[data-code="99215"]').click(); await p.locator('#doneBtn').click();
    n++;
    if (n === 1) { await p.waitForTimeout(350); await p.screenshot({ path: OUT + '/a-progress.png' }); }
    await p.waitForTimeout(200);
  }
  console.log('billed', n, 'daybar:', await p.locator('#daybar').innerText());
  // bill the in-progress 2:45 slot and upcoming one -> day complete
  for (const t of ['2:45pm', '3:30pm']) { await p.locator('.slot', { hasText: t }).first().click(); await p.waitForTimeout(150); await p.locator('[data-code="99214"]').click(); await p.locator('#doneBtn').click(); await p.waitForTimeout(300); }
  await p.waitForTimeout(1700);
  await p.screenshot({ path: OUT + '/b-bigcelebration.png' });
  await p.waitForTimeout(3500);
  // celebrations sample
  await p.evaluate(() => window.__rvu.FX.celebrate('confettiPop')); await p.waitForTimeout(250);
  await p.screenshot({ path: OUT + '/c-confetti.png' });
  await p.evaluate(() => window.__rvu.FX.celebrate('plusOneGold')); await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/d-plusone.png' });
  await p.waitForTimeout(2500);
  // next day: split the Wednesday? go to Thursday and split NP
  await p.locator('[data-nav="1"]').click(); await p.locator('[data-nav="1"]').click(); await p.waitForTimeout(300);
  await p.locator('.slot.NP').first().click(); await p.waitForTimeout(150);
  await p.locator('#splitBtn').click(); await p.waitForTimeout(300);
  const thu = await p.evaluate(() => [...document.querySelectorAll('.slot')].map((e) => e.innerText.replace(/\n/g, ' ')).join(' | '));
  console.log('THU after split:', thu);
  // mark Friday off via day menu
  await p.locator('[data-nav="1"]').click(); await p.waitForTimeout(200);
  await p.locator('[data-daymenu]').click(); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/e-daymenu.png' });
  await p.locator('#dmLabels button', { hasText: 'Holiday' }).click();
  await p.locator('#dmOff').click(); await p.waitForTimeout(300);
  await p.locator('[data-view="week"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/f-week-after.png' });
  // reports chart
  await p.locator('[data-go="reports"]').first().click(); await p.waitForTimeout(300);
  await p.locator('.card').first().screenshot({ path: OUT + '/g-chart.png' });
  await p.locator('[data-go="insights"]').first().click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/h-insights.png', fullPage: true });
  await p.locator('[data-go="hours"]').first().click(); await p.waitForTimeout(300);
  console.log('EMAIL\n' + await p.locator('pre.email').innerText());
  console.log('ERRORS', JSON.stringify(errors));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
