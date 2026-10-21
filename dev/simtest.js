// run inbox-ocr.js readImage on simulated phone frames; prints which folders were read per frame
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), cp = require('child_process'), path = require('path');
const DIR = '/tmp/claude-0/-home-claude/c570a9af-ae86-5f4e-b20e-57fbb5f68c39/scratchpad/ocr';
const MODE = process.argv[2] || 'full';
let n = 0;
const savePng = (u) => { const f = path.join(DIR, `_s${n++ % 60}.png`); if (process.env.ONLY) fs.writeFileSync(path.join(DIR, 'last_' + (n % 3) + '.png'), Buffer.from(u.split(',')[1], 'base64')); fs.writeFileSync(f, Buffer.from(u.split(',')[1], 'base64')); return f; };
function tsvLines(file) {
  const out = cp.execFileSync('tesseract', [file, '-', '--psm', '6', 'tsv'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const lines = new Map();
  for (const r of out.trim().split('\n').slice(1).map((l) => l.split('\t'))) {
    if (r[0] !== '5' || !(r[11] || '').trim()) continue;
    const k = r.slice(2, 5).join('.'); const [x, y, w, h] = r.slice(6, 10).map(Number);
    if (!lines.has(k)) lines.set(k, { words: [] });
    lines.get(k).words.push({ text: r[11], bbox: { x0: x, y0: y, x1: x + w, y1: y + h } });
  }
  return [...lines.values()].map((l) => ({ ...l, text: l.words.map((w) => w.text).join(' ') }));
}
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext();
  await ctx.route('**/_sim/*', (r) => r.fulfill({ body: fs.readFileSync(path.join(DIR, 'sim', path.basename(new URL(r.request().url()).pathname))), contentType: 'image/jpeg' }));
  const p = await ctx.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message));
  p.on('console', (m) => console.log('>', m.text()));
  await p.exposeFunction('ocrLines', (u) => tsvLines(savePng(u)));
  await p.exposeFunction('ocrDigits', (u) => cp.execFileSync('tesseract', [savePng(u), '-', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789/'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  await p.goto('http://localhost:8765/diag.html');
  const files = fs.readdirSync(path.join(DIR, 'sim')).filter((f) => f.endsWith('.jpg') && f.includes(process.env.ONLY || '')).sort();
  let score = 0;
  for (const f of files) {
    const res = await p.evaluate(async ([f, MODE, TUNE]) => {
      globalThis.__ocrTune = TUNE; const M = await import('/inbox-ocr.js?' + Date.now());
      const img = new Image(); img.src = '/_sim/' + f; await img.decode();
      const engine = { lines: (c) => window.ocrLines(c.toDataURL()), digits: (c) => window.ocrDigits(c.toDataURL()) };
      // guide box for a 390x844 screen showing a 1080x1920 video with object-fit: cover
      const roi = M.guideRect ? M.guideRect(1080, 1920, 390, 844, { l: .04, r: .04, t: .06, b: .40 }) : null;
      const r = MODE === 'full' || !roi ? await M.readImage(img, 1080, 1920, engine) : await M.readImage(img, 1080, 1920, engine, { roi });
      return Object.entries(r).map(([k, v]) => `${k}=${v.unreadable ? '?['+v.raw+']' : v.new + '/' + v.total}`).join(' ');
    }, [f, MODE, JSON.parse(process.env.TUNE || '{}')]);
    const want = ['call=0/2', 'results=0/3', 'rx=2/2', 'msg=1/5'];
    const got = want.filter((w) => res.split(' ').includes(w)).length; score += got;
    console.log(f.padEnd(22), `${got}/4`, res);
  }
  console.log('TOTAL', score, '/', files.length * 4);
  await b.close();
})();
