// inbox-ocr.js — read Epic In Basket counts ("Pt Advice Request 1/5") from the camera.
// Everything runs on the phone: frames never leave the device.
import { INBOX_CATS } from "./core.js";

const TESS_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";

/* ----------------------------------------------------------- clean-up */
// Photos of a monitor have a fine pixel-grid (moiré) that confuses text recognition.
// Scale → grayscale → soften twice → stretch contrast → black/white (Otsu). Mirrors what tested best.
export function preprocess(src, sw, sh, targetW = 1400) {
  const scale = targetW / sw, w = Math.round(sw * scale), h = Math.round(sh * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, sw, sh, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data, n = w * h;
  let g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  const r = Math.max(1, Math.round(w / 1000));
  g = boxBlur(boxBlur(g, w, h, r), w, h, r);
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
  const th = otsu(h2, n);
  for (let i = 0; i < n; i++) { const v = g[i] > th ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
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
// "1/5" → {new:1,total:5}. Accepts common look-alikes (O→0, l/I/|→1) but needs a slash.
export function parseCount(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/[Oo]/g, "0").replace(/[Il|!]/g, "1").replace(/\s+/g, "");
  const m = s.match(/^(\d{1,3})\/(\d{1,3})$/);
  if (!m) return null;
  const nw = +m[1], total = +m[2];
  return nw <= total ? { new: nw, total } : null;
}

/* lines: [{ text, words: [{ text, bbox: { x0, y0, x1, y1 } }] }]
   readDigits(canvas) → string read with only "0123456789/" allowed (second, sharper look at just the numbers) */
export async function readCounts(lines, canvas, readDigits) {
  const found = {};
  for (const line of lines) {
    const words = (line.words || []).filter((w) => w.text && w.text.trim());
    if (words.length < 2) continue;
    const last = words[words.length - 1];
    const label = words.slice(0, -1).map((w) => w.text).join(" ");
    const key = matchCategory(label);
    if (!key || found[key]) continue;
    let count = null;
    if (readDigits && canvas) {
      const b = last.bbox, hgt = b.y1 - b.y0, pad = Math.round(hgt * 0.35);
      const x0 = Math.max(0, b.x0 - pad), y0 = Math.max(0, b.y0 - pad);
      const x1 = Math.min(canvas.width, b.x1 + pad), y1 = Math.min(canvas.height, b.y1 + pad);
      if (x1 > x0 && y1 > y0) {
        const k = hgt < 28 ? 3 : 2; // small text gets a bigger zoom
        // try the black/white image first, then the softened gray one
        for (const [src, smooth] of [[canvas, false], [canvas.gray, true]]) {
          if (!src || count) continue;
          const crop = document.createElement("canvas"); crop.width = (x1 - x0) * k; crop.height = (y1 - y0) * k;
          const cx = crop.getContext("2d"); cx.imageSmoothingEnabled = smooth;
          cx.fillStyle = "#fff"; cx.fillRect(0, 0, crop.width, crop.height);
          cx.drawImage(src, x0, y0, x1 - x0, y1 - y0, 0, 0, crop.width, crop.height);
          count = parseCount(await readDigits(crop));
        }
      }
    }
    count ||= parseCount(last.text);
    found[key] = count || { unreadable: true };
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

// One full read of an image/video frame.
export async function readImage(src, sw, sh, engine, targetW) {
  // focus on the middle of the frame, where the list should be
  const cx = Math.round(sw * 0.04), cy = Math.round(sh * 0.06);
  const crop = document.createElement("canvas"); crop.width = sw - cx * 2; crop.height = sh - cy * 2;
  crop.getContext("2d").drawImage(src, cx, cy, crop.width, crop.height, 0, 0, crop.width, crop.height);
  const clean = preprocess(crop, crop.width, crop.height, targetW || Math.min(1400, Math.max(1000, crop.width)));
  const lines = await engine.lines(clean);
  return readCounts(lines, clean, (c) => engine.digits(c));
}

// A single photo gets no second look from the camera, so read it at three sizes and let them vote.
export async function readImageVoted(src, sw, sh, engine, widths = [1200, 1400, 1700]) {
  const reads = [];
  for (const w of widths) reads.push(await readImage(src, sw, sh, engine, w));
  const out = {};
  for (const k of new Set(reads.flatMap((r) => Object.keys(r)))) {
    const tally = new Map();
    for (const r of reads) { const v = r[k]; if (v && !v.unreadable) { const s = `${v.new}/${v.total}`; tally.set(s, (tally.get(s) || 0) + 1); } }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best && (best[1] >= 2 || tally.size === 1)) { const [n, t] = best[0].split("/").map(Number); out[k] = { new: n, total: t }; }
    else out[k] = { unreadable: true };
  }
  return out;
}
