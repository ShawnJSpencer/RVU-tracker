const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), cp = require('child_process'), path = require('path');
const DIR = '/tmp/claude-0/-home-claude/c570a9af-ae86-5f4e-b20e-57fbb5f68c39/scratchpad/ocr';
let n = 0;
const savePng = (dataUrl) => { const f = path.join(DIR, `_f${n++}.png`); fs.writeFileSync(f, Buffer.from(dataUrl.split(',')[1], 'base64')); return f; };
function tsvLines(file) {
  const out = cp.execFileSync('tesseract', [file, '-', '--psm', '6', 'tsv'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  const rows = out.trim().split('\n').slice(1).map((l) => l.split('\t'));
  const lines = new Map();
  for (const r of rows) {
    if (r[0] !== '5' || !(r[11] || '').trim()) continue;
    const k = r.slice(2, 5).join('.');
    const [x, y, w, h] = r.slice(6, 10).map(Number);
    if (!lines.has(k)) lines.set(k, { text: '', words: [] });
    lines.get(k).words.push({ text: r[11], bbox: { x0: x, y0: y, x1: x + w, y1: y + h } });
  }
  return [...lines.values()].map((l) => ({ ...l, text: l.words.map((w) => w.text).join(' ') }));
}
(async () => {
  const b = await chromium.launch(); const errors = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.route('**/_epic.jpg', (r) => r.fulfill({ body: fs.readFileSync(path.join(DIR, 'epic.jpg')), contentType: 'image/jpeg' }));
  await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.exposeFunction('ocrLines', (u) => tsvLines(savePng(u)));
  await p.exposeFunction('ocrDigits', (u) => cp.execFileSync('tesseract', [savePng(u), '-', '--psm', '7', '-c', 'tessedit_char_whitelist=0123456789/'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
  await p.goto('http://localhost:8765/diag.html');
  const res = await p.evaluate(async () => {
    const M = await import('/inbox-ocr.js');
    const img = new Image(); img.src = '/_epic.jpg'; await img.decode();
    const engine = { lines: (c) => window.ocrLines(c.toDataURL()), digits: (c) => window.ocrDigits(c.toDataURL()) };
    const out = {};
    // straight on, plus rotated and smaller (farther away) versions to mimic a hand-held camera
    const variants = { straight: [0, 1], tilt3: [3, 1], tiltNeg4: [-4, 1], farther: [0, 0.6] };
    for (const [name, [deg, s]] of Object.entries(variants)) {
      const W = 1920, H = 1440; const c = document.createElement('canvas'); c.width = W; c.height = H;
      const x = c.getContext('2d'); x.fillStyle = '#8a8a8a'; x.fillRect(0, 0, W, H);
      x.translate(W / 2, H / 2); x.rotate(deg * Math.PI / 180); x.scale(s * W / img.width, s * W / img.width);
      x.drawImage(img, -img.width / 2, -img.height / 2);
      out[name] = await M.readImage(c, W, H, engine);
    }
    out.match = ['Pt Advice Requset', 'ray Attached & Covering Users', 'had My Messages', 'Rx Respnse', 'My lncomplete Notes', 'Staff Messaqe', 'Results', 'Follow up'].map((l) => [l, M.matchCategory(l)]);
    out.counts = ['1/5', 'O/2', 'V5', '12/30', '3/1', 'l/4'].map((t) => [t, M.parseCount(t)]);
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  console.log('ERRORS', JSON.stringify(errors)); await b.close();
})();
