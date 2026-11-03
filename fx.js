// fx.js — celebrations. One full-screen canvas particle engine plus a few DOM effects.

const HAPPY = ["😀", "😁", "🥳", "🤩", "😎", "🙌", "🎉", "💪", "🔥", "⭐", "🌟", "✨", "🚀", "🏆", "💯", "🦄", "🍕", "🌮", "🐶", "🐱", "🦖", "🐸", "🤪", "😜", "🥸", "🤠", "👻", "🦩", "🐙", "🍩", "🎈", "🌈", "🫶", "🙃", "😹", "🦦", "🐧", "🧁", "🍦", "🎸"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

let canvas, ctx, W = 0, H = 0, dpr = 1, parts = [], running = false, palette = ["#ff5d55", "#ffd166", "#06d6a0", "#118ab2", "#a06cd5"];

function ensure() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "fx-canvas";
  document.body.appendChild(canvas);
  ctx = canvas.getContext("2d");
  const size = () => {
    // big screens get a lighter canvas: moving confetti looks the same, and it is far less work per frame
    dpr = Math.min(window.devicePixelRatio || 1, innerWidth * innerHeight > 700000 ? 1 : 1.5);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener("resize", size);
}

export function setPalette(colors) { if (colors?.length) palette = colors; }
let privacyOn = false; // money-themed celebrations are skipped while the privacy blur is on
export function setPrivacy(on) { privacyOn = !!on; }
const MONEY_FX = ["coinPop", "coinShower"];
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function add(p) {
  if (parts.length >= MAX_PARTS) return;
  parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0.25, drag: 0.99, life: 0, max: 120, size: 8, rot: rand(0, TAU), vr: rand(-0.2, 0.2), shape: "rect", color: pick(palette), alpha: 1, fade: true, wobble: 0, delay: 0 }, p));
  if (!running) { running = true; requestAnimationFrame(tick); }
}

// Emoji are drawn once into a small cached image, then stamped each frame. Re-drawing color emoji
// with fillText every frame is what made emoji rain heavy on the computer.
const sprites = new Map();
function sprite(e) {
  let s = sprites.get(e);
  if (!s) {
    const S = 96; s = document.createElement("canvas"); s.width = s.height = S;
    const c = s.getContext("2d");
    c.font = `${S * 0.78}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui`;
    c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(e, S / 2, S / 2 + S * 0.04);
    sprites.set(e, s);
  }
  return s;
}
const MAX_PARTS = 450; // safety cap so a big effect can never bog things down

function star(c, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath(); c.fill();
}

let lastT = 0;
function tick(now) {
  // a step of 1 = one 60 fps frame; slower screens move particles further per frame instead of in slow motion
  const step = lastT ? Math.min(3, (now - lastT) / 16.7) : 1; lastT = now;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  parts = parts.filter((p) => p.life < p.max + p.delay);
  for (const p of parts) {
    for (let k = 1; k < step - 0.5; k++) { if (p.life >= p.delay) { p.vy += p.ay; p.x += p.vx; p.y += p.vy; p.rot += p.vr; } p.life++; }
    p.life++;
    if (p.life < p.delay) continue;
    p.vx += p.ax; p.vy += p.ay; p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx + (p.wobble ? Math.sin(p.life / 9) * p.wobble : 0);
    p.y += p.vy; p.rot += p.vr;
    if (p.onTick) p.onTick(p);
    if (p.y > H + 120 || p.x < -150 || p.x > W + 150) { if (p.vy > 0 || p.y > H + 400) { p.life = p.max + p.delay; continue; } }
    const t = (p.life - p.delay) / p.max;
    const a = p.fade ? Math.max(0, p.alpha * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1)) : p.alpha;
    if (a <= 0.01) continue;
    const cs = Math.cos(p.rot) * dpr, sn = Math.sin(p.rot) * dpr;
    ctx.setTransform(cs, sn, -sn, cs, p.x * dpr, p.y * dpr);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color; ctx.strokeStyle = p.color;
    switch (p.shape) {
      case "rect": ctx.scale(1, Math.cos(p.life / 6)); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); break;
      case "circle": ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, TAU); ctx.fill(); break;
      case "ring": ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, p.size * (0.2 + t), 0, TAU); ctx.stroke(); break;
      case "star": star(ctx, p.size / 2); break;
      case "spark": ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * 3, -p.vy * 3); ctx.stroke(); break;
      case "bubble": ctx.lineWidth = 2; ctx.globalAlpha = a * 0.8; ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, TAU); ctx.stroke(); ctx.globalAlpha = a * 0.25; ctx.fill(); break;
      case "balloon":
        ctx.rotate(-p.rot); ctx.beginPath(); ctx.ellipse(0, 0, p.size * 0.42, p.size / 2, 0, 0, TAU); ctx.fill();
        ctx.globalAlpha = a * 0.6; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, p.size / 2); ctx.quadraticCurveTo(6, p.size, 0, p.size * 1.5); ctx.stroke(); break;
      case "emoji": case "text": { const d = p.size * 1.28; ctx.drawImage(sprite(p.emoji), -d / 2, -d / 2, d, d); break; }
      case "streak": { ctx.lineWidth = p.size / 4; ctx.lineCap = "round"; const g = ctx.createLinearGradient(0, 0, -p.vx * 9, -p.vy * 9); g.addColorStop(0, "#fff"); g.addColorStop(0.25, p.color); g.addColorStop(1, /^#[0-9a-f]{6}$/i.test(p.color) ? p.color + "00" : "rgba(255,255,255,0)"); ctx.strokeStyle = g; ctx.rotate(-p.rot); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-p.vx * 9, -p.vy * 9); ctx.stroke(); break; }
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
  if (parts.length) requestAnimationFrame(tick);
  else { running = false; lastT = 0; ctx.clearRect(0, 0, canvas.width, canvas.height); }
}

/* ------------------------------------------------------------ helpers */
function burst(x, y, n, o = {}) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), sp = rand(o.min ?? 3, o.speed ?? 9);
    add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.lift ?? 3), size: rand(o.s0 ?? 6, o.s1 ?? 12), shape: o.shape || pick(["rect", "rect", "circle", "star"]), max: o.max ?? rand(60, 100), ay: o.ay ?? 0.22, drag: o.drag ?? 0.97, emoji: o.emoji?.(), color: o.color?.() ?? pick(palette), delay: o.delay ?? 0 });
  }
}
function firework(x, y, delay = 0, color) {
  const c = color || pick(palette);
  add({ x, y: H + 10, vx: (x - W / 2) / 120, vy: -rand(12, 16), ay: 0.2, shape: "circle", size: 5, color: "#fff", max: Math.max(1, Math.round((H + 10 - y) / 11)), fade: false, delay,
    onTick: (p) => { if (p.life - p.delay >= p.max - 1) { for (let i = 0; i < 46; i++) { const a = (i / 46) * TAU, sp = rand(3, 7); add({ x: p.x, y: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 0.08, drag: 0.97, shape: "spark", color: Math.random() < 0.3 ? "#fff" : c, max: rand(50, 80) }); } } } });
}
function rain(n, o = {}) {
  for (let i = 0; i < n; i++) {
    add({ x: rand(0, W), y: rand(-H * 0.6, -20), vx: rand(-1, 1), vy: rand(2, 5), ay: o.ay ?? 0.06, drag: 0.995, size: rand(o.s0 ?? 22, o.s1 ?? 40), shape: o.shape || "emoji", emoji: o.emoji?.(), color: o.color?.() ?? pick(palette), max: o.max ?? 260, wobble: o.wobble ?? 1.2, vr: rand(-0.04, 0.04), delay: Math.floor(rand(0, o.spread ?? 60)) });
  }
}
function rise(n, o = {}) {
  for (let i = 0; i < n; i++) {
    add({ x: rand(0, W), y: H + rand(20, 200), vx: rand(-0.6, 0.6), vy: -rand(2.5, 5), ay: -0.01, drag: 0.999, size: rand(o.s0 ?? 30, o.s1 ?? 60), shape: o.shape, emoji: o.emoji?.(), color: o.color?.() ?? pick(palette), max: o.max ?? 300, wobble: o.wobble ?? 1.5, vr: 0, rot: 0, delay: Math.floor(rand(0, o.spread ?? 50)) });
  }
}

function domFx(cls, html, ms = 2600, host = document.body) {
  const el = document.createElement("div");
  el.className = `fx-dom ${cls}`;
  el.innerHTML = html;
  host.appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}
function vibrate(p) { try { navigator.vibrate?.(p); } catch { /* not supported (iOS) */ } }
function shake(ms = 700, cls = "fx-shake") {
  const root = document.querySelector(".app");
  if (!root) return;
  root.classList.remove(cls); void root.offsetWidth; root.classList.add(cls);
  setTimeout(() => root.classList.remove(cls), ms);
}

/* ------------------------------------------------- small (each note) */
export const SMALL = {
  confettiPop: (x, y) => { burst(x, y, 70); vibrate(25); },
  plusOneGold: () => { domFx("fx-plusone", `<span>+1 note</span>`, 2300); vibrate([20, 40, 20]); },
  emojiPop: (x, y) => { burst(x, y, 14, { shape: "emoji", emoji: () => pick(HAPPY), s0: 22, s1: 34, speed: 8, lift: 4 }); vibrate(30); },
  sparkleRing: (x, y) => { add({ x, y, shape: "ring", size: 160, ay: 0, vr: 0, max: 40, color: pick(palette) }); burst(x, y, 30, { shape: "star", s0: 8, s1: 16, speed: 7, ay: 0.05 }); vibrate(20); },
  checkStamp: (x, y) => { const el = domFx("fx-stamp", "✓", 1300); el.style.left = `${x}px`; el.style.top = `${y}px`; burst(x, y, 24, { shape: "circle", s0: 4, s1: 8 }); vibrate(40); },
  miniFirework: (x, y) => { firework(Math.min(Math.max(x, 60), W - 60), Math.max(80, y - 120)); vibrate(30); },
  highFive: (x, y) => { add({ x, y: y - 20, vx: 0, vy: -5, ay: 0.16, drag: 0.98, size: 70, shape: "emoji", emoji: pick(["🙌", "👏", "🤘", "👊", "🫡"]), rot: 0, vr: 0, max: 70 }); burst(x, y, 18, { shape: "star", s0: 5, s1: 10, speed: 6 }); vibrate([20, 30, 40]); },
  confettiSwirl: (x, y) => { for (let i = 0; i < 48; i++) { const a = (i / 48) * TAU * 2, sp = 2 + i / 7; add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 0.06, drag: 0.97, size: rand(6, 11), max: rand(60, 90), delay: Math.floor(i / 4) }); } vibrate(25); },
  popcorn: (x, y) => { for (let i = 0; i < 12; i++) add({ x: x + rand(-30, 30), y, vx: rand(-3, 3), vy: -rand(7, 12), ay: 0.45, drag: 0.99, size: rand(20, 30), shape: "emoji", emoji: "🍿", max: 70, delay: Math.floor(rand(0, 26)) }); vibrate([10, 20, 10, 20, 10]); },
  shootingStar: (x, y) => { const left = Math.random() < 0.5; add({ x: left ? -40 : W + 40, y: Math.max(40, y - 220), vx: left ? 16 : -16, vy: 5, ay: 0, drag: 1, shape: "streak", size: 14, color: "#ffe9a3", rot: 0, vr: 0, max: 80, fade: false, onTick: (p) => { if (p.life % 2 === 0) add({ x: p.x, y: p.y, vx: rand(-0.6, 0.6), vy: rand(0, 1), ay: 0.04, shape: "star", size: rand(4, 8), color: pick(["#fff", "#ffe9a3", ...palette]), max: 40 }); } }); vibrate(20); },
  heartRing: (x, y) => { for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; add({ x, y, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, ay: 0, drag: 0.93, size: 24, shape: "emoji", emoji: pick(["❤️", "💛", "💙", "💚", "💜", "🧡"]), rot: 0, vr: 0, max: 55 }); } vibrate(30); },
  bullseye: (x, y) => { for (let r = 0; r < 3; r++) add({ x, y, shape: "ring", size: 60 + r * 50, ay: 0, vr: 0, max: 32, delay: r * 5, color: r === 1 ? "#fff" : pick(palette) }); add({ x, y, vx: 0, vy: -1, ay: 0, size: 44, shape: "emoji", emoji: "🎯", rot: 0, vr: 0, max: 50 }); vibrate(35); },
  coinPop: (x, y) => { burst(x, y, 16, { shape: "emoji", emoji: () => pick(["🪙", "💰", "💵"]), s0: 20, s1: 30, speed: 9, lift: 6, ay: 0.35 }); vibrate([15, 30, 15]); },
};

/* -------------------------------------------- big (all notes for day) */
export const BIG = {
  emojiRain: () => { const e = pick(HAPPY); rain(70, { emoji: () => (Math.random() < 0.75 ? e : pick(HAPPY)) }); },
  fireworksShow: () => { for (let i = 0; i < 9; i++) firework(rand(W * 0.15, W * 0.85), rand(H * 0.15, H * 0.45), i * 22); vibrate([60, 120, 60, 120, 60]); },
  confettiShower: () => rain(260, { shape: "rect", s0: 7, s1: 13, ay: 0.03, wobble: 2, max: 300, spread: 90 }),
  earthquake: () => { shake(900, "fx-quake"); burst(W / 2, H / 2, 160, { speed: 14 }); vibrate([80, 40, 80, 40, 200]); },
  goldenBanner: () => { domFx("fx-banner gold", `<b>ALL NOTES DONE</b><small>Day closed. Go home!</small>`, 3600); burst(W / 2, H / 2, 90, { shape: "star", color: () => pick(["#ffd34d", "#ffe9a3", "#fff", "#f5b301"]) }); vibrate([30, 60, 30, 60, 120]); },
  balloons: () => rise(28, { shape: "balloon", s0: 40, s1: 70 }),
  rainbowSweep: () => { domFx("fx-rainbow", "", 2200); rain(80, { shape: "star", s0: 8, s1: 16, spread: 40 }); },
  supernova: () => { domFx("fx-flash", "", 700); for (let r = 0; r < 4; r++) burst(W / 2, H / 2, 70, { speed: 6 + r * 4, shape: r % 2 ? "star" : "circle", delay: r * 8, ay: 0.02 }); },
  discoParty: () => { domFx("fx-disco", "", 3200); rain(60, { emoji: () => pick(["🪩", "💃", "🕺", "✨", "🎶", "🎵"]) }); vibrate([50, 50, 50, 50, 50, 50]); },
  bubbles: () => rise(60, { shape: "bubble", s0: 18, s1: 60, color: () => pick(palette) }),
  coinShower: () => { rain(80, { emoji: () => pick(["🪙", "💰", "💵", "💎"]), ay: 0.12 }); vibrate([20, 30, 20, 30, 20, 30]); },
  rocketLaunch: () => { domFx("fx-rocket", "🚀", 2600); setTimeout(() => { for (let i = 0; i < 5; i++) firework(rand(W * 0.2, W * 0.8), rand(H * 0.1, H * 0.3), i * 10); }, 1300); },
  trophyDrop: () => { domFx("fx-trophy", "🏆<small>Notes champion</small>", 3200); setTimeout(() => burst(W / 2, H * 0.42, 120, { shape: "star", color: () => pick(["#ffd34d", "#fff", "#f5b301"]) }), 650); vibrate([0, 600, 150]); },
  heartsFloat: () => rise(45, { emoji: () => pick(["❤️", "🧡", "💛", "💚", "💙", "💜", "🩷"]) }),
  checkCascade: () => rain(90, { emoji: () => pick(["✅", "☑️", "✔️"]), s0: 20, s1: 34 }),
  sunburst: () => { domFx("fx-sunburst", "", 2800); burst(W / 2, H / 2, 80, { shape: "star", speed: 10 }); },
  glitterStorm: () => { for (let i = 0; i < 6; i++) burst(rand(0, W), rand(0, H * 0.6), 50, { shape: "star", s0: 4, s1: 9, delay: i * 10, color: () => pick(["#fff", "#ffe9a3", ...palette]) }); },
  levelUp: () => { domFx("fx-banner level", `<b>LEVEL UP!</b><small>+100 XP · Notes cleared</small><i></i>`, 3400); burst(W / 2, H * 0.6, 90); vibrate([40, 40, 40, 40, 200]); },
  confettiCannons: () => { for (let s = 0; s < 2; s++) for (let i = 0; i < 110; i++) { const left = s === 0, a = left ? rand(-1.35, -0.75) : rand(-2.4, -1.8), sp = rand(10, 20); add({ x: left ? 0 : W, y: H, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, ay: 0.25, drag: 0.985, size: rand(7, 13), max: rand(110, 170) }); } vibrate([100, 50, 100]); },
  meteorShower: () => { for (let i = 0; i < 26; i++) add({ x: rand(-W * 0.2, W * 0.9), y: rand(-H * 0.5, -20), vx: rand(9, 14), vy: rand(6, 9), ay: 0, drag: 1, shape: "streak", size: rand(8, 16), color: pick(["#ffe9a3", "#fff", ...palette]), rot: 0, vr: 0, max: 120, delay: Math.floor(rand(0, 90)) }); domFx("fx-night", "", 3200); vibrate([30, 60, 30]); },
  petalDrift: () => rain(55, { emoji: () => pick(["🌸", "🌼", "🌷", "🍃", "🌺"]), s0: 18, s1: 30, ay: 0.02, wobble: 2.6, max: 340, spread: 110 }),
  snowDay: () => { rain(70, { emoji: () => "❄️", s0: 14, s1: 30, ay: 0.015, wobble: 1.8, max: 360, spread: 120 }); rain(90, { shape: "circle", color: () => "#ffffff", s0: 3, s1: 7, ay: 0.01, wobble: 1.2, max: 360, spread: 120 }); },
  pinata: () => { const el = domFx("fx-pinata", "🪅", 1700); setTimeout(() => { el.remove(); burst(W / 2, H * 0.35, 40, { shape: "emoji", emoji: () => pick(["🍬", "🍭", "🍫", "🧁", "🍩", "⭐"]), s0: 22, s1: 34, speed: 11, lift: 5, ay: 0.3, max: 120 }); burst(W / 2, H * 0.35, 80, { speed: 12 }); vibrate([20, 20, 120]); }, 1100); },
  neonSign: () => { domFx("fx-neon", `<b>NOTES</b><b>CLOSED</b>`, 3600); vibrate([10, 80, 10, 80, 10]); },
  aurora: () => { domFx("fx-aurora", "", 3800); rain(60, { shape: "star", s0: 3, s1: 7, color: () => pick(["#fff", "#c9f7ff", "#d9ffe8"]), ay: 0, wobble: 0.3, max: 220, spread: 80 }); },
  doveRelease: () => rise(22, { emoji: () => "🕊️", s0: 30, s1: 54, wobble: 2.4, max: 260 }),
  grandFinale: () => { BIG.fireworksShow(); setTimeout(() => BIG.emojiRain(), 500); setTimeout(() => domFx("fx-banner gold", `<b>DAY COMPLETE</b><small>Every note signed</small>`, 3200), 300); },
};

let lastSmall = "", lastBig = "";
export function celebrateNote(x = innerWidth / 2, y = innerHeight / 2) {
  ensure();
  if (reduced()) { domFx("fx-plusone", `<span>+1 note</span>`, 1600); return; }
  let k; do k = pick(Object.keys(SMALL)); while (k === lastSmall || (privacyOn && MONEY_FX.includes(k)));
  lastSmall = k; SMALL[k](x, y);
}
export function celebrateDay() {
  ensure();
  if (reduced()) { domFx("fx-banner gold", `<b>ALL NOTES DONE</b>`, 2600); return; }
  let k; do k = pick(Object.keys(BIG)); while (k === lastBig || (privacyOn && MONEY_FX.includes(k)));
  lastBig = k; BIG[k]();
}
export function celebrate(name) { ensure(); (SMALL[name] || BIG[name])?.(innerWidth / 2, innerHeight / 2); }
export const fxNames = () => ({ small: Object.keys(SMALL), big: Object.keys(BIG) });

/* tiny (each inbox item handled): smaller than a note celebration */
const TINY = {
  sparkle: (x, y) => burst(x, y, 12, { shape: "star", s0: 5, s1: 9, speed: 4, lift: 2, ay: 0.08, max: 40 }),
  pop: (x, y) => burst(x, y, 14, { shape: "circle", s0: 3, s1: 6, speed: 4.5, lift: 2, max: 36 }),
  emoji: (x, y) => add({ x, y: y - 10, vx: 0, vy: -2.2, ay: 0.02, drag: 0.99, size: 26, shape: "emoji", emoji: pick(["✅", "👍", "✨", "🙌", "😎", "💪", "🎯"]), vr: 0, rot: 0, max: 50 }),
  ring: (x, y) => add({ x, y, shape: "ring", size: 70, ay: 0, vr: 0, max: 26, color: pick(palette) }),
};
let lastTiny = "";
export function celebrateTiny(x = innerWidth / 2, y = innerHeight / 2) {
  ensure();
  vibrate(12);
  if (reduced()) return;
  let k; do k = pick(Object.keys(TINY)); while (k === lastTiny);
  lastTiny = k; TINY[k](x, y);
  if (Math.random() < 0.5) TINY.sparkle(x, y);
}
