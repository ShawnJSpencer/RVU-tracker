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
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener("resize", size);
}

export function setPalette(colors) { if (colors?.length) palette = colors; }
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function add(p) {
  parts.push(Object.assign({ x: 0, y: 0, vx: 0, vy: 0, ax: 0, ay: 0.25, drag: 0.99, life: 0, max: 120, size: 8, rot: rand(0, TAU), vr: rand(-0.2, 0.2), shape: "rect", color: pick(palette), alpha: 1, fade: true, wobble: 0, delay: 0 }, p));
  if (!running) { running = true; requestAnimationFrame(tick); }
}

function star(c, r) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.45 : r;
    c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  c.closePath(); c.fill();
}

function tick() {
  ctx.clearRect(0, 0, W, H);
  parts = parts.filter((p) => p.life < p.max + p.delay);
  for (const p of parts) {
    p.life++;
    if (p.life < p.delay) continue;
    p.vx += p.ax; p.vy += p.ay; p.vx *= p.drag; p.vy *= p.drag;
    p.x += p.vx + (p.wobble ? Math.sin(p.life / 9) * p.wobble : 0);
    p.y += p.vy; p.rot += p.vr;
    if (p.onTick) p.onTick(p);
    const t = (p.life - p.delay) / p.max;
    const a = p.fade ? Math.max(0, p.alpha * (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1)) : p.alpha;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
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
      case "emoji": case "text":
        ctx.font = `${p.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui`;
        ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(p.emoji, 0, 0); break;
    }
    ctx.restore();
  }
  if (parts.length) requestAnimationFrame(tick);
  else { running = false; ctx.clearRect(0, 0, W, H); }
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
  grandFinale: () => { BIG.fireworksShow(); setTimeout(() => BIG.emojiRain(), 500); setTimeout(() => domFx("fx-banner gold", `<b>DAY COMPLETE</b><small>Every note signed</small>`, 3200), 300); },
};

let lastSmall = "", lastBig = "";
export function celebrateNote(x = innerWidth / 2, y = innerHeight / 2) {
  ensure();
  if (reduced()) { domFx("fx-plusone", `<span>+1 note</span>`, 1600); return; }
  let k; do k = pick(Object.keys(SMALL)); while (k === lastSmall);
  lastSmall = k; SMALL[k](x, y);
}
export function celebrateDay() {
  ensure();
  if (reduced()) { domFx("fx-banner gold", `<b>ALL NOTES DONE</b>`, 2600); return; }
  let k; do k = pick(Object.keys(BIG)); while (k === lastBig);
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
