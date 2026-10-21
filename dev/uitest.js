const { chromium, devices } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs');
const OUT = process.argv[2];
const hist = fs.readFileSync('/home/claude/history.json', 'utf8');
(async () => {
  const b = await chromium.launch();
  const errors = [];
  async function ctxFor(vp, mobile) {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, timezoneId: 'America/Denver' });
    await ctx.addInitScript((h) => { if (!localStorage.getItem('rvu.hist.v1')) localStorage.setItem('rvu.hist.v1', h); }, hist);
    const p = await ctx.newPage();
    await p.clock.install({ time: new Date('2026-10-20T15:10:00-06:00') });
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await p.goto('http://localhost:8765/');
    await p.waitForTimeout(800);
    return p;
  }
  const p = await ctxFor({ width: 390, height: 844 }, true);
  await p.screenshot({ path: OUT + '/1-day-phone.png' });
  // open a past slot and bill it
  const slot = p.locator('.slot.overdue').first();
  await slot.click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/2-sheet.png' });
  await p.locator('[data-code="99214"]').click();
  await p.locator('#doneBtn').click();
  await p.waitForTimeout(700);
  await p.screenshot({ path: OUT + '/3-celebrate.png' });
  await p.waitForTimeout(3000);
  // week
  await p.locator('[data-view="week"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/4-week-phone.png' });
  await p.locator('[data-view="month"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/5-month.png' });
  await p.locator('[data-view="year"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/6-year.png' });
  await p.locator('[data-go="reports"]').first().click(); await p.waitForTimeout(500);
  await p.screenshot({ path: OUT + '/7-reports.png', fullPage: false });
  await p.locator('[data-rgroup="season"]').click(); await p.selectOption('#rYear', '2025'); await p.waitForTimeout(300);
  const seasonText = await p.locator('.tbl').innerText();
  await p.locator('[data-rgroup="half"]').click(); await p.waitForTimeout(300);
  const halfText = await p.locator('.tbl').innerText();
  await p.locator('[data-go="hours"]').first().click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/8-hours.png' });
  const email = await p.locator('pre.email').innerText();
  await p.locator('[data-go="insights"]').first().click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/9-insights.png' });
  await p.locator('[data-go="settings"]').first().click(); await p.waitForTimeout(300);
  await p.locator('[data-theme-pick="daywater"]').click(); await p.waitForTimeout(200);
  await p.screenshot({ path: OUT + '/10-settings-daywater.png' });
  await p.locator('[data-go="calendar"]').first().click(); await p.locator('[data-view="day"]').click(); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/11-day-daywater.png' });
  // desktop
  const d = await ctxFor({ width: 1400, height: 900 }, false);
  await d.locator('[data-view="week"]').click(); await d.waitForTimeout(300);
  await d.screenshot({ path: OUT + '/12-week-desktop.png' });
  // history day
  await d.locator('[data-view="day"]').click();
  await d.evaluate(() => { });
  for (let i = 0; i < 13; i++) await d.locator('[data-nav="-1"]').click();
  await d.waitForTimeout(300);
  await d.screenshot({ path: OUT + '/13-hist-day.png' });
  // landscape phone
  const l = await ctxFor({ width: 844, height: 390 }, true);
  await l.screenshot({ path: OUT + '/14-landscape.png' });
  console.log('SEASON\n' + seasonText + '\nHALF\n' + halfText + '\nEMAIL\n' + email);
  console.log('ERRORS', JSON.stringify(errors, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
