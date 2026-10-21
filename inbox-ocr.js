// inbox-ocr.js — read Epic In Basket counts ("Pt Advice Request 1/5") from the camera.
// Everything runs on the phone: frames never leave the device.
import { INBOX_CATS } from "./core.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/* ----------------------------------------------------------- clean-up */
const TUNE = { blurUp: 1, passesUp: 1, k: 0.2, win: 40, up: 2, adaptive: true };
// Photos of a monitor have a fine pixel-grid (moiré) that confuses text recognition.
// Scale → grayscale → soften twice → stretch contrast → black/white (Otsu). Mirrors what tested best.
export function preprocess(src, sw, sh, targetW = 1400, adaptive) {
  const scale = targetW / sw, w = Math.round(sw * scale), h = Math.round(sh * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h;
  let g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  // soften the screen's pixel grid; when the crop was enlarged, it is already soft, so go easy
  const O = { ...TUNE, ...(globalThis.__ocrTune || {}) };
  const r = scale > 1.3 ? O.blurUp : Math.max(1, Math.round(w / 1000));
  for (let p = 0; p < (scale > 1.3 ? O.passesUp : 2); p++) if (r) g = boxBlur(g, w, h, r);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.min(255, g[i] | 0)]++;
  const pct = (p) => { let acc = 0; const target = n * p; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= target) return v; } return 255; };
  const lo = pct(0.02), hi = pct(0.98), span = Math.max(1, hi - lo);
  const h2 = new Uint32Array(256);
  for (let i = 0; i < n; i++) { const v = Math.max(0, Math.min(255, ((g[i] - lo) / span) * 255)); g[i] = v; h2[v | 0]++; }
  // keep a softened gray copy too: faint gray numbers survive better there than in pure black/white
  const gray = document.createElement("canvas"); gray.width = w; gray.height = h;
  const gimg = new ImageData(w, h), gd = gimg.data;
  for (let i = 0; i < n; i++) { const v = g[i]; gd[i * 4] = gd[i * 4 + 1] = gd[i * 4 + 2] = v; gd[i * 4 + 3] = 255; }
  gray.getContext("2d").putImageData(gimg, 0, 0);
  if (adaptive ?? O.adaptive) {
    // local threshold: compare each pixel with its neighborhood, so faint gray text next to
    // a dark bezel or a bright glare spot still separates cleanly (Sauvola-style)
    const R = Math.max(8, Math.round(w / O.win)), m = boxBlur(g, w, h, R);
    const sq = new Float32Array(n); for (let i = 0; i < n; i++) sq[i] = g[i] * g[i];
    const m2 = boxBlur(sq, w, h, R);
    for (let i = 0; i < n; i++) {
      const sd = Math.sqrt(Math.max(0, m2[i] - m[i] * m[i]));
      const t = m[i] * (1 + O.k * (sd / 128 - 1));
      const v = sd < 6 ? 255 : g[i] > t ? 255 : 0; // flat areas are background
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
    }
  } else {
    const th = otsu(h2, n);
    for (let i = 0; i < n; i++) { const v = g[i] > th ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  }
  ctx.putImageData(img, 0, 0);
  c.gray = gray;
  return c;
}
function boxBlur(a, w, h, r) {
  // integral-image box blur with edge clamping
  const W = w + 1, I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += a[y * w + x]; I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row; } }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const s = I[(y1 + 1) * W + x1 + 1] - I[y0 * W + x1 + 1] - I[(y1 + 1) * W + x0] + I[y0 * W + x0];
      out[y * w + x] = s / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  return out;
}
function otsu(hist, total) {
  let sumAll = 0; for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let wb = 0, sb = 0, best = -1, th = 128;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue;
    const wf = total - wb; if (!wf) break;
    sb += t * hist[t];
    const v = wb * wf * (sb / wb - (sumAll - sb) / wf) ** 2;
    if (v > best) { best = v; th = t; }
  }
  return th;
}

/* ------------------------------------------------------------ parsing */
const letters = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
function lev(a, b) {
  const m = a.length, n = b.length; if (!m || !n) return m || n;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const sim = (a, b) => 1 - lev(a, b) / Math.max(a.length, b.length);
// Which Epic folder does this label belong to? (tolerates icon junk in front and OCR typos)
export function matchCategory(label) {
  const L = letters(label);
  if (L.length < 4) return null;
  let best = null, bestScore = 0;
  for (const c of INBOX_CATS) {
    for (const name of [c.name, ...(c.aliases || [])]) {
      const N = letters(name);
      const tail = L.slice(-Math.min(L.length, N.length + 2));
      const score = Math.max(sim(L, N), sim(tail, N), L.endsWith(N) ? 1 : 0);
      if (score > bestScore) { bestScore = score; best = c.key; }
    }
  }
  return bestScore >= 0.78 ? best : null;
}
// "1/5" → {new:1,total:5}. Accepts common look-alikes but needs to find a slash
// (in bold text a "1" often melts into the slash and reads as "V": "V5" → 1/5).
export function parseCount(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/\s+/g, "").replace(/[\\|]/g, "/");
  s = s.replace(/^[^0-9A-Za-z/]+|[^0-9A-Za-z/]+$/g, "");
  if (/^[Vv]\/?[0-9SsZzOoIlB]{1,3}$/.test(s)) s = "1/" + s.replace(/^[Vv]\/?/, "");
  s = s.replace(/(?<=[0-9OoSsZz])[fFtJ,.](?=[0-9OoSsZzIl])/g, "/"); // slash read as f / t / J
  s = s.replace(/[Oo]/g, "0").replace(/[Il!\]\[]/g, "1").replace(/[Ss]/g, "5").replace(/[Zz]/g, "2").replace(/B/g, "8");
  if (/^\d\d$/.test(s)) s = s[0] + "/" + s[1]; // slash lost entirely ("02" → 0/2); Epic always shows one
  const m = s.match(/^(\d{1,3})\/(\d{1,3})$/);
  if (!m) return null;
  const nw = +m[1], total = +m[2];
  return nw <= total && total < 1000 ? { new: nw, total } : null;
}
// Does this word look like it could be the count (even if garbled)? e.g. "0/2", "/5", "V5", "Vs"
const countish = (t) => /\//.test(t) || /^[Vv][0-9SsZzOo]{1,3}$/.test(t.trim()) || /^[0-9Oo][0-9fFtJ,.]?[0-9SsZz]{0,2}$/.test(t.trim());

/* lines: [{ text, words: [{ text, bbox: { x0, y0, x1, y1 } }] }]
   readDigits(canvas) → string read with only "0123456789/" allowed (second, sharper look at just the numbers) */
export async function readCounts(lines, canvas, readDigits) {
  const found = {};
  const allWords = lines.flatMap((l) => (l.words || []).filter((w) => w.text && w.text.trim()));
  for (const line of lines) {
    const words = (line.words || []).filter((w) => w.text && w.text.trim());
    if (!words.length) continue;
    // the label is everything up to the first count-looking word (junk after the count is ignored)
    let ci = words.findIndex((w, i) => i > 0 && countish(w.text));
    const labelWords = ci > 0 ? words.slice(0, ci) : words;
    const key = matchCategory(labelWords.map((w) => w.text).join(" "));
    if (!key || found[key]) continue;
    let cw = ci > 0 ? words[ci] : null;
    if (!cw) {
      // the number sometimes lands on its own "line": look for a count-looking word on the same row, to the right
      const lb = labelWords[labelWords.length - 1].bbox, lh = lb.y1 - lb.y0, lc = (lb.y0 + lb.y1) / 2;
      cw = allWords.filter((w) => w.bbox.x0 > lb.x1 && Math.abs((w.bbox.y0 + w.bbox.y1) / 2 - lc) < lh * 0.6 && countish(w.text))
        .sort((p, q) => p.bbox.x0 - q.bbox.x0)[0] || null;
    }
    if (!cw) { found[key] = { unreadable: true, raw: line.text }; continue; }
    let count = parseCount(cw.text); const raws = [cw.text];
    if (readDigits && canvas) {
      // second look at just the number, zoomed in, digits only; keep whichever reads cleanly
      const b = cw.bbox, hgt = b.y1 - b.y0, pad = Math.round(hgt * 0.35);
      const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
      const x1 = Math.min(canvas.width, b.x1 + pad), y1 = Math.min(canvas.height, b.y1 + pad);
      if (x1 > x0 && y1 > y0) {
        const k = hgt < 28 ? 3 : 2; // small text gets a bigger zoom
        const digitReads = [];
        for (const [src, smooth] of [[canvas, false], [canvas.gray, true]]) {
          if (!src) continue;
          const crop = document.createElement("canvas"); crop.width = (x1 - x0) * k; crop.height = (y1 - y0) * k;
          const cx = crop.getContext("2d"); cx.imageSmoothingEnabled = smooth;
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, crop.width, crop.height);
          cx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
          const t = await readDigits(crop); raws.push(t);
          const c = parseCount(t); if (c) digitReads.push(c);
          if (c && count && c.new === count.new && c.total === count.total) break; // both looks agree
        }
        // prefer a digits-only read that agrees with the first look; otherwise the first clean digits read
        if (!count || (digitReads.length && !digitReads.some((c) => c.new === count.new && c.total === count.total))) count = digitReads[0] || count;
      }
    }
    found[key] = count || { unreadable: true, raw: [line.text, ...raws].join(" | ") };
  }
  return found;
}

/* ---------------------------------------------------- tesseract engine */
let enginePromise = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script"); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error("Couldn't load the text reader (are you online?)"));
    document.head.appendChild(s);
  });
}
export function getEngine(onStatus) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    onStatus?.("Loading the text reader… (first time only)");
    await loadScript(TESS_URL);
    const worker = await window.Tesseract.createWorker("eng", 1, {
      logger: (m) => { if (m.status && /load|init/i.test(m.status)) onStatus?.(`${m.status[0].toUpperCase()}${m.status.slice(1)}${m.progress ? ` ${Math.round(m.progress * 100)}%` : ""}`); },
    });
    const LINES = { tessedit_pageseg_mode: "6", tessedit_char_whitelist: "", preserve_interword_spaces: "1" };
    const DIGITS = { tessedit_pageseg_mode: "7", tessedit_char_whitelist: "0123456789/" };
    let mode = "";
    const setMode = async (m, p) => { if (mode !== m) { await worker.setParameters(p); mode = m; } };
    return {
      async lines(canvas) {
        await setMode("lines", LINES);
        const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
        const out = [];
        for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push({ text: l.text, words: l.words || [] });
        if (!out.length && data.lines) for (const l of data.lines) out.push({ text: l.text, words: l.words || [] });
        return out;
      },
      async digits(canvas) {
        await setMode("digits", DIGITS);
        const { data } = await worker.recognize(canvas);
        return (data.text || "").trim();
      },
      terminate: () => worker.terminate(),
    };
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

// Where the on-screen guide box sits inside the video frame (the preview uses object-fit: cover).
// box = fractions of the screen: { l, r, t, b }
export function guideRect(vw, vh, cw, ch, box) {
  const k = Math.max(cw / vw, ch / vh), dw = vw * k, dh = vh * k, ox = (dw - cw) / 2, oy = (dh - ch) / 2;
  const toV = (x, y) => [(x + ox) / k, (y + oy) / k];
  const [x0, y0] = toV(cw * box.l, ch * box.t), [x1, y1] = toV(cw * (1 - box.r), ch * (1 - box.b));
  // a little slack around the box: people rarely line it up exactly
  const px = (x1 - x0) * 0.06, py = (y1 - y0) * 0.08;
  const X0 = Math.max(0, x0 - px), Y0 = Math.max(0, y0 - py), X1 = Math.min(vw, x1 + px), Y1 = Math.min(vh, y1 + py);
  return { x: Math.round(X0), y: Math.round(Y0), w: Math.round(X1 - X0), h: Math.round(Y1 - Y0) };
}

// One full read of an image/video frame. roi = the part of the frame to read (defaults to nearly all of it).
export async function readImage(src, sw, sh, engine, opts = {}) {
  let { targetW, roi, adaptive } = typeof opts === "number" ? { targetW: opts } : opts;
  roi ||= { x: Math.round(sw * 0.04), y: Math.round(sh * 0.06), w: Math.round(sw * 0.92), h: Math.round(sh * 0.88) };
  const crop = document.createElement("canvas"); crop.width = roi.w; crop.height = roi.h;
  crop.getContext("2d").drawImage(src, roi.x, roi.y, roi.w, roi.h, 0, 0, roi.w, roi.h);
  // small camera crops get enlarged so letters are big enough to read
  const clean = preprocess(crop, crop.width, crop.height, targetW || (crop.width > 1100 ? 1400 : Math.min(2400, Math.max(1400, crop.width * ({ ...TUNE, ...(globalThis.__ocrTune || {}) }).up))), adaptive);
  const lines = await engine.lines(clean);
  return readCounts(lines, clean, (c) => engine.digits(c));
}

// A single photo gets no second look from the camera, so read it several ways and let the reads vote.
export async function readImageVoted(src, sw, sh, engine, ways = [[1200, false], [1400, false], [1700, false], [1400, true], [1800, true]]) {
  const t = new Tally();
  for (const [w, adaptive] of ways) t.add(await readImage(src, sw, sh, engine, { targetW: w, adaptive }));
  return t.result(2);
}

// Collects reads from many camera frames (or several reads of one photo). Each folder's number is
// decided by majority, so one frame catching Results and another catching Rx Request add up.
export class Tally {
  constructor() { this.votes = {}; this.frames = 0; this.seenAt = {}; }
  add(res) {
    this.frames++;
    for (const [k, v] of Object.entries(res)) {
      const m = (this.votes[k] ||= new Map());
      this.seenAt[k] ??= this.frames;
      if (v && !v.unreadable) { const s = `${v.new}/${v.total}`; m.set(s, (m.get(s) || 0) + 1); }
      else m.set("?", (m.get("?") || 0) + 1);
    }
  }
  // per folder: { new, total, votes, sure } or { unreadable }
  result(minVotes = 2) {
    const out = {};
    for (const [k, m] of Object.entries(this.votes)) {
      const ranked = [...m.entries()].filter(([s]) => s !== "?").sort((a, b) => b[1] - a[1]);
      if (!ranked.length) { out[k] = { unreadable: true }; continue; }
      const [best, n] = ranked[0], second = ranked[1]?.[1] || 0;
      const [nw, total] = best.split("/").map(Number);
      const sure = n >= minVotes && n > second;
      out[k] = sure || ranked.length === 1 ? { new: nw, total, votes: n, sure } : { unreadable: true };
    }
    return out;
  }
}
