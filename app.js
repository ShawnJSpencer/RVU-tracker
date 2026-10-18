// app.js — RVU Tracker UI
import * as C from "./core.js";
import * as FX from "./fx.js";

/* ================================================================ storage */
const K = { state: "rvu.state.v1", hist: "rvu.hist.v1", sync: "rvu.sync.v1", ui: "rvu.ui.v1", pomo: "rvu.pomo.v1", etag: "rvu.etag.v1" };
const load = (k, fb = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast("Couldn't save on this device: " + e.message); } };

const todayStr = () => C.ymd(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60; };
const FIRST_LIVE_DAY = "2026-10-17"; // day after the last imported spreadsheet day

let state = load(K.state) || C.emptyState(FIRST_LIVE_DAY);
state.settings = { ...C.defaultSettings(state.settings?.startDate || FIRST_LIVE_DAY), ...state.settings };
let hist = load(K.hist, { days: {} });
let sync = { owner: "ShawnJSpencer", repo: "RVU-tracker-data", token: "", lastSync: 0, status: "idle", message: "", ...load(K.sync, {}) };
let ui = { page: "calendar", view: "day", date: todayStr(), ...load(K.ui, {}) };
ui.date = todayStr(); // always open on today
let range = { start: state.settings.dayStart, end: state.settings.dayEnd };

const persist = () => save(K.state, state);
const persistUi = () => save(K.ui, { page: ui.page, view: ui.view, zoom: ui.zoom });
/* calendar zoom (pinch on phone/iPad, pinch or Ctrl+scroll on a trackpad, + / − keys) */
const ZMIN = 0.3, ZMAX = 3;
const zoomFor = (v = ui.view) => (ui.zoom && ui.zoom[v]) || 1;
const clampZoom = (z) => Math.min(ZMAX, Math.max(ZMIN, z));
// Smallest zoom where the hours currently shown still fill the screen (don't zoom out past them).
function minZoomFor(base) {
  const sc = $(".tl-scroll");
  if (!sc || !base) return ZMIN;
  let avail = sc.clientHeight;
  for (const h of sc.querySelectorAll(".pull-hint")) avail -= h.offsetHeight;
  return Math.max(0.05, avail / ((range.end - range.start) * base));
}
let pinchState = null, pinchEndedAt = 0;
const swipe = { active: false, axis: null, x0: 0, y0: 0, t0: 0, dx: 0, el: null }; // left/right swipe between days

/* ================================================================ utils */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }));
const r2 = (n) => (Math.round(n * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
const r1 = (n) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });
const snap = (m, step = 15) => Math.round(m / step) * step;
const uid = (date) => `${date}~u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const isHistDate = (d) => d < state.settings.startDate;
const dateLong = (d) => C.parseYmd(d).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const dateShort = (d) => C.parseYmd(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const timeOfMs = (ms) => new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");
const slotEndMs = (date, s) => { const d = C.parseYmd(date); d.setHours(0, 0, 0, 0); return d.getTime() + (s.start + s.dur) * 60000; };
let toastTimer;
function toast(msg, ms = 2400) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }
function buzz(p) { try { navigator.vibrate?.(p); } catch { /* iOS */ } }

/* ================================================================ data mutations */
function dayRec(date) { return (state.days[date] ||= { slots: {} }); }
function getSlot(date, id) {
  if (isHistDate(date)) { const s = state.days[date]?.slots?.[id]; return s && !s.deleted ? { ...s, id } : null; }
  return C.resolveDay(state, date).find((s) => s.id === id) || null;
}
function putSlot(date, slot) {
  const { gen, ...rest } = slot;
  void gen;
  dayRec(date).slots[slot.id] = { ...rest, updatedAt: Date.now() };
  changed();
}
function removeSlot(date, id) { dayRec(date).slots[id] = { deleted: true, updatedAt: Date.now() }; changed(); }
function setDayOff(date, off, label = "") {
  const d = dayRec(date);
  d.off = off; d.offAt = Date.now();
  if (off) d.offLabel = label || "Day off"; else delete d.offLabel;
}
function changed() { persist(); scheduleSync(); }

// Freeze past days so later template edits never rewrite history.
function freezePast() {
  const t = todayStr();
  let d = state.settings.startDate, n = 0;
  while (d < t && n < 4000) {
    const day = state.days[d];
    if (!day?.frozen) {
      const gen = C.generateDay(d, state.settings);
      if (gen.length || day) {
        const rec = dayRec(d);
        for (const g of gen) if (!rec.slots[g.id]) { const { gen: _g, ...rest } = g; void _g; rec.slots[g.id] = { ...rest, updatedAt: 1 }; }
        rec.frozen = true;
      }
    }
    d = C.addDays(d, 1); n++;
  }
}

/* ================================================================ stats helpers */
const stats = (date) => C.dayStats(state, hist.days, date, Date.now());
function streakInfo() { return computeStreaks(); }

/* ================================================================ theme */
const THEMES = {
  "blue-mountain": { name: "Blue Mountain", colors: ["#16537e", "#448cc2", "#81b669", "#b6d7a8", "#fce5cd"] },
  "bluey-heeler": { name: "Bluey Heeler", colors: ["#edcc6f", "#d2ebff", "#88cafc", "#404066", "#2b2c41"] },
  "tropical-keys": { name: "Tropical Keys", colors: ["#d4973b", "#48cb98", "#51ebd5", "#f1df68", "#a03f6d"] },
  "minty-mountain": { name: "Minty Mountain", colors: ["#a0f9f3", "#55e4c0", "#40a792", "#4b7669", "#495269"] },
  daywater: { name: "Daywater", colors: ["#074342", "#39795c", "#d1aa6e", "#734036", "#471f21"] },
  spring: { name: "Spring", colors: ["#226b71", "#588c73", "#d9a450", "#f2e394", "#ead7b2"] },
  "ih-no-c": { name: "IH no C", colors: ["#110057", "#FFFFFF", "#4A00E2", "#FF5D55", "#7CAFD0", "#FF0044"] },
};
function applyTheme() {
  const t = THEMES[state.settings.theme] ? state.settings.theme : "blue-mountain";
  document.documentElement.dataset.theme = t;
  const cs = getComputedStyle(document.documentElement);
  $('meta[name="theme-color"]').content = cs.getPropertyValue("--surface").trim() || "#16537e";
  FX.setPalette([...THEMES[t].colors.filter((c) => c.toLowerCase() !== "#ffffff"), "#ffd34d", "#ffffff"]);
}

/* ================================================================ routing & header */
function go(page) { closeCountPop(); ui.page = page; persistUi(); closeSheet(); render(); }
function nav(dir) {
  if (dir === "today") { ui.date = todayStr(); render(); scrollToNow(); return; }
  const n = Number(dir), d = C.parseYmd(ui.date);
  const v = ui.page === "hours" ? "week" : ui.view;
  if (v === "day") d.setDate(d.getDate() + n);
  else if (v === "week") d.setDate(d.getDate() + 7 * n);
  else if (v === "month") { d.setDate(1); d.setMonth(d.getMonth() + n); }
  else d.setFullYear(d.getFullYear() + n);
  ui.date = C.ymd(d);
  render();
}
function headerTitle() {
  const d = C.parseYmd(ui.date);
  const v = ui.page === "hours" ? "week" : ui.view;
  if (v === "day") return dateShort(ui.date) + (ui.date === todayStr() ? " · Today" : "");
  if (v === "week") {
    const s = C.parseYmd(C.weekStart(ui.date)), e = C.parseYmd(C.addDays(C.weekStart(ui.date), 6));
    const f = (x, y) => x.toLocaleDateString("en-US", y);
    return s.getMonth() === e.getMonth() ? `${f(s, { month: "short", day: "numeric" })}–${e.getDate()}, ${e.getFullYear()}` : `${f(s, { month: "short", day: "numeric" })} – ${f(e, { month: "short", day: "numeric" })}`;
  }
  if (v === "month") return `${C.MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  return String(d.getFullYear());
}

function render() {
  applyTheme();
  const cal = ui.page === "calendar";
  $("#viewSeg").hidden = !cal;
  $(".nav-date").style.visibility = cal || ui.page === "hours" ? "visible" : "hidden";
  $("#dateTitle").textContent = headerTitle();
  $$("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === ui.view));
  $$("#tabs button").forEach((b) => b.classList.toggle("on", b.dataset.go === ui.page));
  renderDaybar();
  const main = $("#main");
  const keepScroll = main.querySelector(".tl-scroll")?.scrollTop;
  if (cal) {
    if (ui.view === "day") main.innerHTML = isHistDate(ui.date) ? renderHistDay(ui.date) : renderTimeline([ui.date]);
    else if (ui.view === "week") main.innerHTML = renderTimeline(Array.from({ length: 7 }, (_, i) => C.addDays(C.weekStart(ui.date), i)));
    else if (ui.view === "month") main.innerHTML = renderMonth();
    else main.innerHTML = renderYear();
    if (ui.view === "day" || ui.view === "week") bindTimeline(keepScroll);
  } else if (ui.page === "hours") main.innerHTML = renderHours();
  else if (ui.page === "reports") { main.innerHTML = renderReports(); }
  else if (ui.page === "insights") main.innerHTML = renderInsights();
  else if (ui.page === "settings") main.innerHTML = renderSettings();
  updateSyncDot();
}

/* ================================================================ day bar */
function renderDaybar() {
  const bar = $("#daybar");
  if (!bar.dataset.popBound) { bar.dataset.popBound = "1"; bar.addEventListener("scroll", closeCountPop, { passive: true }); }
  if (ui.page !== "calendar") { bar.hidden = true; return; }
  bar.hidden = false;
  let dates;
  if (ui.view === "day") dates = [ui.date];
  else if (ui.view === "week") dates = Array.from({ length: 7 }, (_, i) => C.addDays(C.weekStart(ui.date), i));
  else if (ui.view === "month") { const y = C.yearOf(ui.date), m = C.monthOf(ui.date); dates = Array.from({ length: C.daysInMonth(y, m) }, (_, i) => `${y}-${C.pad(m)}-${C.pad(i + 1)}`); }
  else { const y = C.yearOf(ui.date); dates = []; for (let d = `${y}-01-01`; d <= `${y}-12-31`; d = C.addDays(d, 1)) dates.push(d); }
  let seen = 0, billed = 0, rvu = 0, money$ = 0, hasRate = false, overdue = 0;
  for (const d of dates) {
    const s = stats(d);
    seen += ui.view === "day" ? s.expected : s.seen; billed += s.billed; rvu += s.rvu; overdue += s.overdue || 0;
    const rate = C.dollarRate(state.settings, C.yearOf(d));
    if (rate != null) { money$ += s.rvu * rate; hasRate = true; }
  }
  const st = streakInfo();
  const allDone = seen > 0 && billed >= seen;
  let html = `
    <div class="stat ${allDone ? "done" : ""} ${overdue ? "hot" : ""}"><b>${billed}/${seen}</b><small>notes${allDone ? " ✓" : ""}</small></div>
    ${overdue ? `<div class="stat hot"><b>${overdue}</b><small>waiting</small></div>` : ""}
    <div class="stat"><b>${r2(rvu)}</b><small>RVU</small></div>
    <div class="stat"><b>${hasRate ? money(money$) : "—"}</b><small>earned</small></div>
    <div class="stat"><b>🔥${st.closer.current}</b><small>day streak</small></div>`;
  if (ui.view === "day" && !isHistDate(ui.date)) {
    const c = state.counters[ui.date] || {};
    html += `
      <button class="counter" data-count="msg" title="Tap to add or clear">💬 <b>${c.msg || 0}</b></button>
      <button class="counter" data-count="rx" title="Tap to add or clear">💊 <b>${c.rx || 0}</b></button>
      <button class="counter" data-count="call" title="Tap to add or clear">📞 <b>${c.call || 0}</b></button>
      <button class="counter" data-daymenu="1" title="Day options">⋯</button>`;
  }
  bar.innerHTML = html;
}
// + = one came in, − = one handled (with a tiny celebration). Received/handled totals feed the Habits tab.
function bumpCounter(key, delta) {
  const c = (state.counters[ui.date] ||= {});
  if (delta < 0 && !(c[key] > 0)) return false;
  c[key] = Math.max(0, (c[key] || 0) + delta);
  if (delta > 0) c[key + "In"] = (c[key + "In"] || 0) + 1;
  else c[key + "Done"] = (c[key + "Done"] || 0) + 1;
  c.updatedAt = Date.now();
  changed(); renderDaybar();
  const el = $(`[data-count="${key}"]`); el?.classList.add("bump");
  buzz(10);
  return true;
}
const COUNT_NAMES = { msg: "messages", rx: "Rx requests", call: "calls" };
let countPopTimer;
function closeCountPop() { $(".count-pop")?.remove(); $$(".counter.open").forEach((b) => b.classList.remove("open")); clearTimeout(countPopTimer); }
function openCountPop(key) {
  const already = $(`.count-pop[data-for="${key}"]`);
  closeCountPop();
  if (already) return;
  const btn = $(`[data-count="${key}"]`); if (!btn) return;
  btn.classList.add("open");
  const pop = document.createElement("div");
  pop.className = "count-pop"; pop.dataset.for = key;
  const val = () => state.counters[ui.date]?.[key] || 0;
  pop.innerHTML = `<button class="minus" aria-label="Handled one">−</button><b>${val()}</b><button class="plus" aria-label="Add one">+</button><small>${COUNT_NAMES[key]}</small>`;
  document.body.appendChild(pop);
  const place = () => {
    const r = btn.getBoundingClientRect(), w = pop.offsetWidth;
    const left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2));
    pop.style.left = `${left}px`; pop.style.top = `${r.bottom + 10}px`;
    pop.style.setProperty("--arrow", `${r.left + r.width / 2 - left}px`);
  };
  place();
  const refresh = () => { $("b", pop).textContent = val(); const b2 = $(`[data-count="${key}"]`); b2?.classList.add("open"); };
  const keepOpen = () => { clearTimeout(countPopTimer); countPopTimer = setTimeout(closeCountPop, 5000); };
  $(".plus", pop).onclick = (e) => { e.stopPropagation(); bumpCounter(key, 1); refresh(); keepOpen(); };
  $(".minus", pop).onclick = (e) => {
    e.stopPropagation();
    if (bumpCounter(key, -1)) { const r = e.currentTarget.getBoundingClientRect(); FX.celebrateTiny(r.left + r.width / 2, r.top + r.height / 2); }
    else toast(`No ${COUNT_NAMES[key]} waiting`, 1200);
    refresh(); keepOpen();
  };
  keepOpen();
}

/* ================================================================ timeline (day / week) */
function layoutLanes(slots) {
  // assign each slot a lane within its overlap cluster
  const out = new Map(); let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const s of cluster) {
      let li = lanes.findIndex((end) => end <= s.start);
      if (li < 0) { li = lanes.length; lanes.push(0); }
      lanes[li] = s.start + s.dur;
      out.set(s.id, { lane: li });
    }
    for (const s of cluster) out.get(s.id).lanes = lanes.length;
    cluster = []; clusterEnd = -1;
  };
  for (const s of slots) {
    if (cluster.length && s.start >= clusterEnd) flush();
    cluster.push(s); clusterEnd = Math.max(clusterEnd, s.start + s.dur);
  }
  if (cluster.length) flush();
  return out;
}
function slotLabel(s) {
  if (C.isPatient(s)) return C.TYPES[s.type].short === "Tx" ? "Therapy" : C.TYPES[s.type].short;
  if (s.type === "MTG") return s.title || "Meeting";
  if (s.type === "MD" || s.type === "APD") return s.comment || `${s.type} time`;
  return s.title || s.comment || "Blocked";
}
function slotHtml(date, s, ppm, lay, compact) {
  const top = (s.start - range.start) * ppm, h = Math.max(s.dur * ppm - 3, 14);
  const lanes = lay?.lanes || 1, lane = lay?.lane || 0;
  const overdue = C.isPatient(s) && s.status === "scheduled" && slotEndMs(date, s) <= Date.now();
  const role = C.roleOf(s);
  const cls = ["slot", s.type, s.status, overdue ? "overdue" : "", role && s.type === "MTG" ? "role-MD" : "", compact || h < 34 ? "compact" : "", h < 20 ? "tiny" : ""].join(" ");
  const codes = s.status === "billed" && s.codes?.length ? `<span class="code">${s.codes.join(" + ")}</span>` : "";
  const status = s.status === "noshow" ? " · no-show" : s.status === "canceled" ? " · canceled" : "";
  const w = `calc(${100 / lanes}% - 5px)`, l = `calc(${(100 / lanes) * lane}% + 2px)`;
  return `<div class="${cls}" data-id="${esc(s.id)}" data-date="${date}" data-m="${s.start}" data-dur="${s.dur}" data-wk="${compact ? 1 : 0}" style="top:${top}px;height:${h}px;left:${l};width:${w};right:auto" role="button" tabindex="0">
    <span class="t">${C.fmtTime(s.start)}–${C.fmtTime(s.start + s.dur)}</span>
    <span class="n">${esc(slotLabel(s))}${status} ${codes}</span></div>`;
}
function renderTimeline(dates) {
  const isWeek = dates.length > 1;
  const narrow = innerWidth < 700;
  const ppm = (isWeek ? (narrow ? 1.05 : 1.15) : (narrow ? 1.6 : 1.8)) * zoomFor(isWeek ? "week" : "day");
  const perDay = dates.map((d) => ({ d, hist: isHistDate(d), off: C.isDayOff(state, d) || !!hist.days[d]?.off, slots: isHistDate(d) ? [] : C.resolveDay(state, d) }));
  // grow range to fit anything scheduled outside it
  for (const x of perDay) for (const s of x.slots) { range.start = Math.min(range.start, Math.floor(s.start / 60) * 60); range.end = Math.max(range.end, Math.ceil((s.start + s.dur) / 60) * 60); }
  const H = (range.end - range.start) * ppm;
  const cols = perDay.map((x) => {
    const wk = [0, 6].includes(C.weekday(x.d));
    return isWeek && wk && !x.slots.length ? "minmax(26px,.35fr)" : "minmax(0,1fr)";
  });
  const tmpl = `44px ${cols.join(" ")}`;
  const today = todayStr();
  let head = "";
  if (isWeek) {
    head = `<div class="tl-head" style="grid-template-columns:${tmpl}"><div></div>` + perDay.map((x) => {
      const s = stats(x.d);
      const wk = [0, 6].includes(C.weekday(x.d));
      const name = wk && !x.slots.length ? C.DAY_SHORT[C.weekday(x.d)][0] : C.DAY_SHORT[C.weekday(x.d)];
      return `<button class="h ${x.d === today ? "today" : ""}" data-goday="${x.d}">${name}<b>${C.parseYmd(x.d).getDate()}</b><small>${x.off ? "off" : s.expected ? `${s.billed}/${s.expected}` : "&nbsp;"}</small></button>`;
    }).join("") + `</div>`;
  }
  let gutter = "", lines = "";
  for (let m = range.start; m <= range.end; m += 30) {
    const y = (m - range.start) * ppm;
    if (m % 60 === 0 && m < range.end) gutter += `<span data-m="${m}" style="top:${y + (m === range.start ? 8 : 0)}px">${C.fmtTime(m, { compact: true })}</span>`;
    lines += `<div class="tl-line ${m % 60 ? "half" : ""}" data-m="${m}" style="top:${y}px"></div>`;
  }
  const colsHtml = perDay.map((x) => {
    const wk = [0, 6].includes(C.weekday(x.d));
    let inner = lines;
    if (x.hist) {
      const s = stats(x.d);
      inner += x.off || s.seen ? `<div class="slot BLK ${s.pending ? "overdue" : ""} ${isWeek ? "compact" : ""}" data-goday="${x.d}" style="top:4px;left:3px;right:3px;height:${Math.min(H - 8, 140)}px">
        <span class="n">${x.off ? esc(hist.days[x.d]?.label || "Off") : `${s.seen} pts`}</span><span class="n">${x.off ? "" : r2(s.rvu) + " RVU"}</span>${s.pending ? `<span class="n">${s.pending} open</span>` : ""}</div>` : "";
    } else if (x.off) {
      inner += `<div class="slot BLK offblock ${isWeek ? "compact" : ""}" data-goday="${x.d}" data-full="1" style="top:4px;left:3px;right:3px;height:${H - 8}px"><span class="n">🏖️<br>${esc(state.days[x.d]?.offLabel || "Day off")}</span>${isWeek ? "" : `<button class="btn sm" data-daymenu="1">Change</button>`}</div>`;
    } else {
      const lay = layoutLanes(x.slots);
      inner += x.slots.map((s) => slotHtml(x.d, s, ppm, lay.get(s.id), isWeek)).join("");
    }
    if (x.d === today && !x.off) inner += `<div class="now-line" style="top:${(nowMin() - range.start) * ppm}px"></div>`;
    return `<div class="tl-col ${wk ? "weekend" : ""} ${x.off ? "off" : ""}" data-date="${x.d}">${inner}</div>`;
  }).join("");
  const canEarlier = range.start > 300, canLater = range.end < 22 * 60;
  return `<div class="tl-wrap" data-ppm="${ppm}">
    ${head}
    <div class="tl-scroll">
      <div class="pull-ind top">↓ Pull to open earlier slots</div>
      ${canEarlier ? `<div class="pull-hint"><button data-extend="-60">▲ ${C.fmtTime(range.start - 60, { compact: true })}</button></div>` : ""}
      <div class="tl-inner" style="grid-template-columns:${tmpl};height:${H}px">
        <div class="tl-gutter">${gutter}</div>${colsHtml}
      </div>
      ${canLater ? `<div class="pull-hint"><button data-extend="60">▼ ${C.fmtTime(range.end + 60, { compact: true })}</button></div>` : ""}
      <div class="pull-ind bottom">↑ Pull to open later slots</div>
    </div></div>`;
}

let didInitialScroll = false;
function scrollToNow() {
  const sc = $(".tl-scroll"), wrap = $(".tl-wrap");
  if (!sc || !wrap) return;
  const ppm = Number(wrap.dataset.ppm);
  const target = (Math.max(range.start, Math.min(nowMin(), range.end)) - range.start) * ppm - sc.clientHeight / 3;
  sc.scrollTop = Math.max(0, target);
}
function extendRange(delta) {
  if (delta < 0) range.start = Math.max(300, range.start + delta);
  else range.end = Math.min(22 * 60, range.end + delta);
  buzz(15);
  const sc = $(".tl-scroll"); const prev = sc?.scrollTop || 0;
  render();
  const sc2 = $(".tl-scroll");
  if (sc2) sc2.scrollTop = delta < 0 ? 0 : (delta > 0 ? sc2.scrollHeight : prev);
}

// Re-lays the timeline out at a new scale in place (no re-render), so a pinch stays smooth.
function applyPpm(ppm) {
  const wrap = $(".tl-wrap"), inner = $(".tl-inner");
  if (!inner) return;
  wrap.dataset.ppm = ppm;
  const H = (range.end - range.start) * ppm;
  inner.style.height = `${H}px`;
  for (const el of inner.querySelectorAll(".tl-line[data-m]")) el.style.top = `${(el.dataset.m - range.start) * ppm}px`;
  for (const el of inner.querySelectorAll(".tl-gutter span[data-m]")) { const m = Number(el.dataset.m); el.style.top = `${(m - range.start) * ppm + (m === range.start ? 8 : 0)}px`; }
  for (const el of inner.querySelectorAll(".slot[data-m]")) {
    const h = Math.max(el.dataset.dur * ppm - 3, 14);
    el.style.top = `${(el.dataset.m - range.start) * ppm}px`; el.style.height = `${h}px`;
    el.classList.toggle("compact", el.dataset.wk === "1" || h < 34); el.classList.toggle("tiny", h < 20);
  }
  for (const el of inner.querySelectorAll("[data-full]")) el.style.height = `${H - 8}px`;
  const nl = $(".now-line"); if (nl) nl.style.top = `${(nowMin() - range.start) * ppm}px`;
}
// Zoom to `z`, keeping the time under screen position `clientY` where it is.
function zoomTimelineTo(z, clientY, minute) {
  const sc = $(".tl-scroll"), inner = $(".tl-inner"), wrap = $(".tl-wrap");
  if (!sc || !inner) return;
  const v = ui.view === "week" ? "week" : "day";
  const ppm0 = Number(wrap.dataset.ppm), base = ppm0 / zoomFor(v);
  const zmin = minZoomFor(base);
  z = Math.min(Math.max(ZMAX, zmin), Math.max(zmin, z));
  const scTop = sc.getBoundingClientRect().top;
  if (minute == null) minute = range.start + (clientY - inner.getBoundingClientRect().top) / ppm0;
  (ui.zoom ||= {})[v] = z;
  applyPpm(base * z);
  sc.scrollTop = inner.offsetTop + (minute - range.start) * base * z - (clientY - scTop);
}
let zoomSaveTimer;
function commitZoom(showToast = true) {
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = setTimeout(() => { persistUi(); if (!pinchState) render(); }, 250);
  if (showToast) toast(`🔍 ${Math.round(zoomFor(ui.view === "week" ? "week" : "day") * 100)}%`, 900);
}

function bindTimeline(keepScroll) {
  const sc = $(".tl-scroll"), inner = $(".tl-inner"), wrap = $(".tl-wrap");
  if (!sc) return;
  {
    // keep the shown hours filling the screen (e.g. after rotating or switching views)
    const v = ui.view === "week" ? "week" : "day", ppm0 = Number(wrap.dataset.ppm), base = ppm0 / zoomFor(v), zmin = minZoomFor(base);
    if (zoomFor(v) < zmin - 1e-6) { (ui.zoom ||= {})[v] = zmin; applyPpm(base * zmin); }
  }
  if (keepScroll != null) sc.scrollTop = keepScroll;
  else if (!didInitialScroll || ui.date === todayStr()) { scrollToNow(); didInitialScroll = true; }

  /* elastic pull: past the top opens earlier slots, past the bottom opens later ones */
  const indTop = $(".pull-ind.top", sc), indBot = $(".pull-ind.bottom", sc);
  let ty0 = null, tx0 = 0, pull = 0, edge = null;
  const THRESH = 70;
  sc.addEventListener("touchstart", (e) => {
    if (drag.active) return;
    ty0 = e.touches[0].clientY; tx0 = e.touches[0].clientX; pull = 0;
    // both can be true when the whole day fits on screen; the drag direction picks one
    edge = { top: sc.scrollTop <= 0, bottom: sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1 };
  }, { passive: true });
  sc.addEventListener("touchmove", (e) => {
    if (drag.active) { e.preventDefault(); return; }
    if (pinchState || e.touches.length > 1 || ty0 == null || !edge) return;
    const dy = e.touches[0].clientY - ty0;
    if (swipe.axis === "x") return; // sideways swipe changes the day instead
    if (typeof edge === "object" && (Math.abs(dy) < 10 || Math.abs(e.touches[0].clientX - tx0) > Math.abs(dy))) return;
    if (typeof edge === "object") { edge = dy > 0 && edge.top ? "top" : dy < 0 && edge.bottom ? "bottom" : edge.top || edge.bottom ? edge : null; if (typeof edge === "object") return; }
    if ((edge === "top" && dy > 0) || (edge === "bottom" && dy < 0)) {
      pull = dy * 0.45;
      inner.classList.add("pulling");
      inner.style.transform = `translateY(${pull}px)`;
      const ind = edge === "top" ? indTop : indBot;
      ind.classList.add("show");
      const ready = Math.abs(pull) > THRESH;
      ind.classList.toggle("ready", ready);
      ind.textContent = edge === "top"
        ? (ready ? `Release for ${C.fmtTime(range.start - 60, { compact: true })} slots` : "↓ Pull to open earlier slots")
        : (ready ? `Release for slots until ${C.fmtTime(range.end + 60, { compact: true })}` : "↑ Pull to open later slots");
      if (e.cancelable) e.preventDefault();
    }
  }, { passive: false });
  sc.addEventListener("touchend", () => {
    if (!pinchState && pull && Math.abs(pull) > THRESH) {
      const dir = pull > 0 ? -60 : 60;
      if ((dir < 0 && range.start > 300) || (dir > 0 && range.end < 22 * 60)) { inner.style.transform = ""; extendRange(dir); return; }
    }
    inner.classList.remove("pulling"); inner.style.transform = ""; indTop.classList.remove("show"); indBot.classList.remove("show");
    ty0 = null; pull = 0; edge = null;
  });
  let wheelAcc = 0, wheelTimer;
  sc.addEventListener("wheel", (e) => {
    if (e.ctrlKey) return;
    const atTop = sc.scrollTop <= 0 && e.deltaY < 0, atBot = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1 && e.deltaY > 0;
    if (!atTop && !atBot) { wheelAcc = 0; return; }
    wheelAcc += e.deltaY;
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => (wheelAcc = 0), 400);
    const ind = atTop ? indTop : indBot; ind.classList.add("show");
    setTimeout(() => ind.classList.remove("show"), 600);
    if (Math.abs(wheelAcc) > 420) { wheelAcc = 0; extendRange(atTop ? -60 : 60); }
  }, { passive: true });

  /* pinch to zoom (two fingers on phone / iPad) */
  sc.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2 || drag.active) return;
    const [a, b] = e.touches, mid = (a.clientY + b.clientY) / 2;
    const ppm0 = Number(wrap.dataset.ppm);
    pinchState = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, z0: zoomFor(ui.view === "week" ? "week" : "day"), minute: range.start + (mid - inner.getBoundingClientRect().top) / ppm0 };
    ty0 = null; pull = 0; edge = null;
    inner.classList.remove("pulling"); inner.style.transform = ""; indTop.classList.remove("show"); indBot.classList.remove("show");
  }, { passive: true });
  let pinchRaf = 0;
  sc.addEventListener("touchmove", (e) => {
    if (!pinchState || e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    const z = pinchState.z0 * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinchState.d0;
    const mid = (a.clientY + b.clientY) / 2;
    cancelAnimationFrame(pinchRaf);
    pinchRaf = requestAnimationFrame(() => zoomTimelineTo(z, mid, pinchState?.minute));
  }, { passive: false });
  const endPinch = (e) => {
    if (!pinchState || e.touches.length >= 2) return;
    pinchState = null; pinchEndedAt = Date.now();
    commitZoom();
  };
  sc.addEventListener("touchend", endPinch);
  sc.addEventListener("touchcancel", endPinch);
  /* trackpad pinch / Ctrl+scroll on a computer */
  sc.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomTimelineTo(zoomFor(ui.view === "week" ? "week" : "day") * Math.exp(-e.deltaY * 0.01), e.clientY);
    commitZoom(false);
  }, { passive: false });
  /* Safari on a Mac sends gesture events for trackpad pinches */
  if (!("ontouchstart" in window)) {
    let gz0 = 1;
    sc.addEventListener("gesturestart", (e) => { e.preventDefault(); gz0 = zoomFor(ui.view === "week" ? "week" : "day"); });
    sc.addEventListener("gesturechange", (e) => { e.preventDefault(); zoomTimelineTo(gz0 * e.scale, e.clientY); });
    sc.addEventListener("gestureend", (e) => { e.preventDefault(); commitZoom(); });
  }

  /* tap empty space → add; press-and-hold a slot → drag in 15-minute steps */
  inner.addEventListener("pointerdown", (e) => { if (!pinchState) onSlotPointerDown(e, Number(wrap.dataset.ppm)); });
  inner.addEventListener("click", (e) => {
    if (drag.justDropped) { drag.justDropped = false; return; }
    const g = e.target.closest("[data-goday]");
    if (g) { ui.date = g.dataset.goday; ui.view = "day"; persistUi(); render(); return; }
    const slot = e.target.closest(".slot[data-id]");
    if (slot) { openSlotSheet(slot.dataset.date, slot.dataset.id, slot); return; }
    const col = e.target.closest(".tl-col");
    if (!col || col.classList.contains("off")) return;
    const y = e.clientY - col.getBoundingClientRect().top;
    const m = Math.max(0, snap(range.start + y / Number(wrap.dataset.ppm) - 15));
    openAddSheet(col.dataset.date, m);
  });
}

/* ---------------------------------------------------------------- drag */
const drag = { active: false, justDropped: false };
function onSlotPointerDown(e, ppm) {
  const el = e.target.closest(".slot[data-id]");
  if (!el || e.button > 0) return;
  const date = el.dataset.date, s = getSlot(date, el.dataset.id);
  if (!s) return;
  const start = { x: e.clientX, y: e.clientY }, touch = e.pointerType !== "mouse";
  const cols = $$(".tl-col").map((c) => ({ date: c.dataset.date, rect: c.getBoundingClientRect(), off: c.classList.contains("off") }));
  const homeCol = cols.find((c) => c.date === date);
  let timer = null, newStart = s.start, newDate = date;
  const begin = () => {
    if (pinchState) { cleanup(); return; }
    drag.active = true; el.classList.add("dragging"); buzz(12);
    el.setPointerCapture?.(e.pointerId);
  };
  if (touch) timer = setTimeout(begin, 380);
  const move = (ev) => {
    const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
    if (!drag.active) {
      if (touch && Math.hypot(dx, dy) > 8) { clearTimeout(timer); cleanup(); }
      else if (!touch && Math.hypot(dx, dy) > 5) begin();
      if (!drag.active) return;
    }
    newStart = Math.max(300, Math.min(22 * 60 - s.dur, snap(s.start + dy / ppm)));
    const over = cols.find((c) => ev.clientX >= c.rect.left && ev.clientX < c.rect.right && !c.off && !isHistDate(c.date)) || homeCol;
    newDate = over.date;
    el.style.top = `${(newStart - range.start) * ppm}px`;
    el.style.transform = `translateX(${over.rect.left - homeCol.rect.left}px) scale(1.03)`;
    $(".t", el).textContent = `${C.fmtTime(newStart)}–${C.fmtTime(newStart + s.dur)}`;
  };
  const up = () => {
    clearTimeout(timer);
    if (drag.active) {
      drag.active = false; drag.justDropped = true;
      setTimeout(() => (drag.justDropped = false), 350);
      if (newDate !== date) { removeSlot(date, s.id); putSlot(newDate, { ...s, id: uid(newDate), start: newStart }); }
      else if (newStart !== s.start) putSlot(date, { ...s, start: newStart });
      if (newDate !== date || newStart !== s.start) toast(`Moved to ${C.fmtTime(newStart)}${newDate !== date ? " " + dateShort(newDate) : ""}`);
      render();
    }
    cleanup();
  };
  function cleanup() { removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); }
  addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
}

/* ================================================================ history day (imported) */
function renderHistDay(date) {
  const s = stats(date), h = hist.days[date];
  const off = h?.off;
  const chips = Object.entries(s.codes).sort().map(([c, n]) => `<span class="chip"><b>${esc(c)}</b> × ${n}</span>`).join("");
  const filled = Object.entries(state.days[date]?.slots || {}).filter(([, x]) => !x.deleted && x.histFill);
  return `<div class="page"><div class="card hist-day">
    <h2 style="margin-top:0">${dateLong(date)}</h2>
    <p class="muted">Imported from your spreadsheet${C.yearOf(date) >= 2025 ? "" : ""}.</p>
    ${off ? `<div class="banner">🏖️ Day off (X in the spreadsheet)</div>` : !h && !filled.length ? `<div class="empty"><span class="e">🗓️</span>Nothing recorded this day.</div>` : `
      <div class="kpis">
        <div class="kpi"><small>Patients</small><b>${s.seen}</b></div>
        <div class="kpi"><small>Notes billed</small><b>${s.billed}</b></div>
        <div class="kpi"><small>No-shows</small><b>${s.noshow ?? "—"}</b></div>
        <div class="kpi hero"><small>RVU</small><b>${r2(s.rvu)}</b><em>${money(C.dollarRate(state.settings, C.yearOf(date)) != null ? s.rvu * C.dollarRate(state.settings, C.yearOf(date)) : null)}</em></div>
      </div>
      <div class="chips">${chips || '<span class="muted">No codes</span>'}</div>`}
    ${Array.from({ length: s.pending }, (_, i) => `<button class="pending-note" data-histfill="${date}">⏳ Open note ${i + 1} — tap when it's done</button>`).join("")}
    ${filled.length ? `<h3>Finished in the app</h3>` + filled.map(([id, x]) => `<button class="entry" data-slot="${esc(id)}" data-date="${date}"><span class="when">${x.billedAt ? timeOfMs(x.billedAt) : ""}</span><span class="what">${esc((x.codes || []).join(" + "))}</span></button>`).join("") : ""}
    ${off ? "" : `<div class="row" style="margin-top:12px"><button class="btn sm" data-histadd="${date}">+ Add a visit to this day</button></div>`}
  </div></div>`;
}

/* ================================================================ month view */
function renderMonth() {
  const y = C.yearOf(ui.date), m = C.monthOf(ui.date);
  const first = `${y}-${C.pad(m)}-01`;
  let d = C.weekStart(first);
  const today = todayStr();
  let cells = C.DAY_SHORT.map((n) => `<div class="dow">${n}</div>`).join("");
  let tot = { rvu: 0, seen: 0, ns: 0, cx: 0, days: 0, pending: 0 };
  for (let i = 0; i < 42; i++) {
    const inMonth = C.monthOf(d) === m;
    if (!inMonth && i >= 35) break;
    const s = stats(d);
    const off = C.isDayOff(state, d) || s.off;
    if (inMonth) { tot.rvu += s.rvu; tot.seen += s.seen; tot.ns += s.noshow || 0; tot.cx += s.canceled || 0; tot.days += s.working ? 1 : 0; tot.pending += s.pending; }
    const wk = [0, 6].includes(C.weekday(d));
    const pct = s.seen ? Math.round((s.billed / s.seen) * 100) : 0;
    const overdue = (s.overdue || 0) > 0 && d <= today;
    const label = off ? esc(state.days[d]?.offLabel || hist.days[d]?.label || "Off") : "";
    cells += `<button class="mcell ${inMonth ? "" : "other"} ${wk ? "weekend" : ""} ${d === today ? "today" : ""} ${off ? "off" : ""} ${overdue ? "overdue" : ""}" data-goday="${d}">
      <span class="d">${C.parseYmd(d).getDate()}</span>
      ${off ? `<span class="p">🏖️ ${label}</span>` : s.seen ? `<span class="p">${s.billed}/${s.seen} notes</span>` : ""}
      ${s.rvu ? `<span class="r">${r1(s.rvu)}<small> RVU</small></span>` : ""}
      ${s.seen ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ""}
    </button>`;
    d = C.addDays(d, 1);
  }
  const rate = C.dollarRate(state.settings, y);
  return `<div class="page">
    <div class="month-sum">
      <div class="kpi hero"><small>RVU</small><b>${r2(tot.rvu)}</b><em>${rate != null ? money(tot.rvu * rate) : "no $/RVU rate for " + y}</em></div>
      <div class="kpi"><small>Patients</small><b>${tot.seen}</b><em>${tot.days} working days</em></div>
      <div class="kpi"><small>Avg RVU / day</small><b>${tot.days ? r2(tot.rvu / tot.days) : "—"}</b></div>
      <div class="kpi"><small>No-shows · cancels</small><b>${tot.ns} · ${tot.cx}</b></div>
      ${tot.pending ? `<div class="kpi" style="border-color:var(--accent)"><small>Open notes</small><b>${tot.pending}</b></div>` : ""}
    </div>
    <div class="month" id="monthGrid">${cells}</div></div>`;
}

/* ================================================================ year view */
function renderYear() {
  const y = C.yearOf(ui.date);
  const rate = C.dollarRate(state.settings, y);
  let yt = 0, yd = 0;
  const cards = C.MONTH_NAMES.map((name, i) => {
    const m = i + 1, dim = C.daysInMonth(y, m);
    const lead = C.weekday(`${y}-${C.pad(m)}-01`);
    let cells = Array.from({ length: lead }, () => `<i class="blank"></i>`).join(""), tot = 0, days = 0;
    for (let dd = 1; dd <= dim; dd++) {
      const d = `${y}-${C.pad(m)}-${C.pad(dd)}`, s = stats(d);
      tot += s.rvu; days += s.working ? 1 : 0;
      const off = C.isDayOff(state, d) || s.off;
      const pct = Math.min(100, Math.round((s.rvu / 24) * 100));
      cells += `<i title="${d}: ${r2(s.rvu)} RVU" style="${off ? "background:repeating-linear-gradient(135deg,var(--surface-2) 0 2px,var(--line) 2px 4px)" : s.rvu ? `background:color-mix(in srgb, var(--primary) ${20 + pct * 0.8}%, var(--surface-2))` : ""}"></i>`;
    }
    yt += tot; yd += days;
    return `<button class="ycard" data-gomonth="${y}-${C.pad(m)}-01"><h4>${name.slice(0, 3)}<span>${tot ? r1(tot) : ""}</span></h4><div class="ygrid">${cells}</div>
      <div class="foot"><span>${days ? days + " days" : ""}</span><span>${rate != null && tot ? money(tot * rate) : ""}</span></div></button>`;
  }).join("");
  return `<div class="page">
    <div class="kpis">
      <div class="kpi hero"><small>${y} RVU</small><b>${r2(yt)}</b><em>${rate != null ? money(yt * rate) : "Set a $/RVU rate for " + y + " in Settings"}</em></div>
      <div class="kpi"><small>Working days</small><b>${yd}</b></div>
      <div class="kpi"><small>Avg RVU / day</small><b>${yd ? r2(yt / yd) : "—"}</b></div>
    </div>
    <div class="year">${cards}</div></div>`;
}

/* ================================================================ sheets */
let sheetOnClose = null;
function openSheet(html, onClose) {
  const sh = $("#sheet");
  sh.innerHTML = `<div class="grab-zone" aria-label="Swipe down to close"><div class="grab"></div></div>${html}`;
  sh.style.transform = ""; sh.style.transition = ""; $("#scrim").style.opacity = "";
  sh.hidden = false; $("#scrim").hidden = false;
  sheetOnClose = onClose || null;
  sh.scrollTop = 0;
}
function closeSheet() {
  if ($("#sheet").hidden) return;
  $("#sheet").hidden = true; $("#scrim").hidden = true;
  $("#sheet").style.transform = ""; $("#sheet").style.transition = ""; $("#scrim").style.opacity = "";
  const cb = sheetOnClose; sheetOnClose = null; cb?.();
}

/* Swipe the sheet down to close it: drag the handle, or drag down anywhere while the sheet is scrolled to the top. */
(() => {
  const sh = $("#sheet"), scrim = $("#scrim");
  let y0 = 0, x0 = 0, t0 = 0, dy = 0, fromGrab = false, dragging = false, armed = false, samples = [];
  const isBottomSheet = () => innerWidth < 900;
  sh.addEventListener("touchstart", (e) => {
    if (!isBottomSheet() || e.touches.length > 1) { armed = false; return; }
    const t = e.touches[0];
    fromGrab = !!e.target.closest(".grab-zone");
    armed = fromGrab || (sh.scrollTop <= 0 && !e.target.closest("input, textarea, select"));
    y0 = t.clientY; x0 = t.clientX; t0 = performance.now(); dy = 0; dragging = false; samples = [];
  }, { passive: true });
  sh.addEventListener("touchmove", (e) => {
    if (!armed) return;
    const t = e.touches[0], d = t.clientY - y0, dx = t.clientX - x0;
    if (!dragging) {
      if (d > 6 && Math.abs(d) > Math.abs(dx) && (fromGrab || sh.scrollTop <= 0)) dragging = true;
      else if (d < -6 && !fromGrab) { armed = false; return; }
      else return;
    }
    if (e.cancelable) e.preventDefault();
    dy = Math.max(0, t.clientY - y0);
    const now = performance.now();
    samples.push([now, dy]); while (samples.length > 2 && now - samples[0][0] > 100) samples.shift();
    sh.style.transition = "none";
    sh.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(0.15, 1 - dy / (sh.offsetHeight || 600)));
  }, { passive: false });
  const end = () => {
    if (!armed) return;
    armed = false;
    if (!dragging) {
      if (fromGrab && performance.now() - t0 < 300) closeSheet(); // a quick tap on the handle closes too
      return;
    }
    dragging = false;
    // speed over the last ~100 ms, so a quick flick closes it even if it's short
    const [ta, ya] = samples[0] || [t0, 0], [tb, yb] = samples[samples.length - 1] || [performance.now(), dy];
    const v = (yb - ya) / Math.max(1, tb - ta); // px per ms
    if (dy > 110 || (v > 0.45 && dy > 30)) {
      sh.style.transition = "transform .22s cubic-bezier(.4,0,1,1)";
      sh.style.transform = "translateY(105%)";
      scrim.style.transition = "opacity .22s"; scrim.style.opacity = "0";
      setTimeout(() => { closeSheet(); scrim.style.transition = ""; }, 220);
    } else {
      sh.style.transition = "transform .25s cubic-bezier(.2,1.2,.4,1)";
      sh.style.transform = "translateY(0)";
      scrim.style.opacity = "";
    }
  };
  sh.addEventListener("touchend", end);
  sh.addEventListener("touchcancel", end);
})();

// ---- add sheet
function openAddSheet(date, minute) {
  openSheet(`<h3>Add at ${C.fmtTime(minute)}</h3><div class="sub">${dateLong(date)}</div>
    <div class="actions">
      <button class="btn" data-add="NP">🆕 New patient · 90m</button>
      <button class="btn" data-add="FU">🔁 Follow-up · 45m</button>
      <button class="btn" data-add="TH">💬 Therapy · 45m</button>
      <button class="btn" data-add="MD">🏥 Medical Director time</button>
      <button class="btn" data-add="APD">🎓 APD time</button>
      <button class="btn" data-add="MTG">👥 Meeting</button>
      <button class="btn" data-add="BLK">⛔ Block / admin</button>
    </div>`);
  $$("[data-add]", $("#sheet")).forEach((b) => b.onclick = () => {
    const type = b.dataset.add;
    const s = { id: uid(date), start: minute, dur: C.TYPES[type].dur, type, status: "scheduled" };
    if (type === "MTG") { s.title = "Meeting"; s.role = "MD"; }
    putSlot(date, s); render();
    openSlotSheet(date, s.id);
  });
}

// ---- slot sheet
function openSlotSheet(date, id, anchorEl) {
  const s = getSlot(date, id);
  if (!s) return;
  if (C.isPatient(s)) return openPatientSheet(date, s, anchorEl);
  return openOtherSheet(date, s);
}

function visibleCodes(type, selected) {
  const base = C.CODE_PICKS[type] || [];
  return [...new Set([...base, ...(state.settings.extraCodes || []), ...selected])];
}
function codeRvuText(date, code) {
  const v = C.rvuTable(state.settings, C.yearOf(date))[code];
  return typeof v === "number" ? `${v} RVU` : "no RVU set";
}

function openPatientSheet(date, s, anchorEl) {
  const sel = new Set(s.codes?.length ? s.codes : (C.CODE_PICKS[s.type]?.length === 1 ? C.CODE_PICKS[s.type] : []));
  const day = isHistDate(date) ? [] : C.resolveDay(state, date);
  const next = day.filter((x) => C.isPatient(x) && x.start === s.start + s.dur && x.status === "scheduled" && x.id !== s.id)[0];
  const billed = s.status === "billed";
  const draw = () => {
    const codes = visibleCodes(s.type, [...sel]);
    const rvu = [...sel].reduce((t, c) => t + C.codeRvu(state.settings, C.yearOf(date), c), 0);
    const when = billed ? `Note done ${s.billedAt ? timeOfMs(s.billedAt) + " " + (C.ymd(new Date(s.billedAt)) === date ? "same day" : dateShort(C.ymd(new Date(s.billedAt)))) : ""}` : s.status === "noshow" ? "No-show" : s.status === "canceled" ? "Canceled" : "Note not done yet";
    openSheet(`
      <h3>${C.TYPES[s.type].label} · ${s.histFill ? "imported day" : `${C.fmtTime(s.start)}–${C.fmtTime(s.start + s.dur)}`}</h3>
      <div class="sub">${dateShort(date)} · ${when}</div>
      <section><div class="typeseg">${["NP", "FU", "TH"].map((t) => `<button data-type="${t}" class="${s.type === t ? "on" : ""}">${C.TYPES[t].label}</button>`).join("")}</div></section>
      <section>
        <label class="lbl">Billing code</label>
        <div class="code-grid">${codes.map((c) => `<button class="code-btn ${sel.has(c) ? "on" : ""}" data-code="${esc(c)}"><b>${esc(c)}</b><small>${esc(C.CODE_HINTS[c] || "")}${C.CODE_HINTS[c] ? " · " : ""}${codeRvuText(date, c)}</small></button>`).join("")}
          <button class="code-btn" data-othercode="1"><b>+</b><small>Other code…</small></button></div>
        <div id="otherBox" hidden style="margin-top:8px" class="row">
          <input id="otherCode" placeholder="CPT code, e.g. 90833" maxlength="7" style="flex:2;text-transform:uppercase">
          <input id="otherRvu" placeholder="RVU (optional)" inputmode="decimal" style="flex:1">
          <label class="check"><input type="checkbox" id="otherKeep" checked> Keep visible</label>
          <button class="btn sm primary" id="otherAdd">Add</button>
        </div>
        <div class="rvu-preview">${sel.size ? `${[...sel].join(" + ")} = ${r2(rvu)} RVU` : "Pick the code(s) you billed"}</div>
        <button class="big-done" id="doneBtn" ${sel.size ? "" : "disabled"}>${billed ? "✓ Update codes" : "✓ Note done"}</button>
      </section>
      <section>
        <label class="lbl">Didn't happen?</label>
        <div class="actions">
          <button class="btn ${s.status === "canceled" ? "on" : ""}" data-status="canceled">🚫 Canceled</button>
          <button class="btn ${s.status === "noshow" ? "on" : ""}" data-status="noshow">👻 No-show</button>
          ${billed ? `<button class="btn" data-status="scheduled">↩︎ Mark note not done</button>` : ""}
        </div>
      </section>
      ${s.histFill ? `<section><button class="btn danger" id="delSlot">Delete</button></section>` : `
      <section>
        <label class="lbl">Slot</label>
        <div class="actions">
          ${s.type === "NP" ? `<button class="btn" id="splitBtn">✂️ Split into 2 F/U</button>` : ""}
          ${s.type !== "NP" && next ? `<button class="btn" id="mergeBtn">🔗 Combine with ${C.fmtTime(next.start)} → NP</button>` : ""}
          <button class="btn danger" id="delSlot">🗑️ Delete slot</button>
        </div>
        <div class="row" style="margin-top:10px">
          <div class="stepper"><button class="btn sm" data-mv="-15">−15</button><b>${C.fmtTime(s.start)}</b><button class="btn sm" data-mv="15">+15</button></div>
          <input type="date" id="moveDate" value="${date}" style="width:auto" min="${state.settings.startDate}">
        </div>
      </section>`}
      <section>
        <label class="lbl">Private note (optional — no patient identifiers)</label>
        <input id="slotComment" value="${esc(s.comment || "")}" placeholder="e.g. ran long, interpreter">
      </section>`);
    const sh = $("#sheet");
    $$("[data-type]", sh).forEach((b) => b.onclick = () => changeType(b.dataset.type));
    $$("[data-code]", sh).forEach((b) => b.onclick = () => { const c = b.dataset.code; sel.has(c) ? sel.delete(c) : sel.add(c); buzz(8); draw(); });
    $("[data-othercode]", sh).onclick = () => { $("#otherBox").hidden = false; $("#otherCode").focus(); };
    $("#otherAdd", sh).onclick = () => {
      const code = $("#otherCode").value.trim().toUpperCase();
      if (!/^[0-9A-Z]{4,6}$/.test(code)) { toast("Enter a CPT/HCPCS code"); return; }
      const rv = parseFloat($("#otherRvu").value);
      const st = state.settings, yr = C.yearOf(date);
      const tblYear = Object.keys(st.rvu).map(Number).filter((y) => y <= yr).sort((a, b) => b - a)[0] ?? Math.min(...Object.keys(st.rvu).map(Number));
      if (!isNaN(rv)) st.rvu[tblYear][code] = rv;
      else if (!(code in st.rvu[tblYear])) st.rvu[tblYear][code] = null;
      if ($("#otherKeep").checked && !st.extraCodes.includes(code)) st.extraCodes.push(code);
      st.updatedAt = Date.now(); changed();
      sel.add(code); draw();
    };
    $("#doneBtn", sh).onclick = () => finishNote(date, s, [...sel], anchorEl);
    $$("[data-status]", sh).forEach((b) => b.onclick = () => {
      const st = b.dataset.status;
      const nextStatus = s.status === st ? "scheduled" : st;
      const upd = { ...s, status: nextStatus, comment: $("#slotComment").value.trim() };
      if (nextStatus !== "billed") { delete upd.billedAt; delete upd.codes; }
      if (s.histFill && nextStatus !== "billed") { removeSlot(date, s.id); closeSheet(); render(); return; }
      putSlot(date, upd); closeSheet(); render();
      if (nextStatus === "noshow" || nextStatus === "canceled") toast(nextStatus === "noshow" ? "Marked no-show" : "Marked canceled");
    });
    $("#delSlot", sh).onclick = () => { if (s.status === "billed" && !confirm("This note is marked done. Delete it anyway?")) return; removeSlot(date, s.id); closeSheet(); render(); };
    $("#splitBtn", sh)?.addEventListener("click", () => {
      removeSlot(date, s.id);
      putSlot(date, { id: `${s.id}a`, start: s.start, dur: 45, type: "FU", status: "scheduled" });
      putSlot(date, { id: `${s.id}b`, start: s.start + 45, dur: 45, type: "FU", status: "scheduled" });
      closeSheet(); render(); toast("Split into two follow-ups");
    });
    $("#mergeBtn", sh)?.addEventListener("click", () => {
      removeSlot(date, next.id);
      putSlot(date, { ...s, type: "NP", dur: 90 });
      closeSheet(); render(); toast("Combined into a new-patient slot");
    });
    $$("[data-mv]", sh).forEach((b) => b.onclick = () => { s.start = Math.max(300, Math.min(22 * 60 - s.dur, s.start + Number(b.dataset.mv))); putSlot(date, { ...s }); render(); draw(); });
    $("#moveDate", sh)?.addEventListener("change", (e) => {
      const nd = e.target.value;
      if (!nd || nd === date || isHistDate(nd)) return;
      removeSlot(date, s.id); const ns = { ...s, id: uid(nd) }; putSlot(nd, ns);
      closeSheet(); ui.date = nd; render(); toast(`Moved to ${dateShort(nd)}`);
    });
    $("#slotComment", sh).onchange = (e) => { s.comment = e.target.value.trim(); putSlot(date, { ...s }); };
  };
  function changeType(t) {
    if (t === s.type) return;
    if (t === "NP" && s.type !== "NP") {
      // a NP needs 90 minutes — absorb the next back-to-back follow-up if there is one
      if (next) removeSlot(date, next.id);
      s.dur = 90;
    } else if (s.type === "NP") s.dur = 45;
    s.type = t;
    if (!s.codes?.length) { sel.clear(); if (C.CODE_PICKS[t]?.length === 1) sel.add(C.CODE_PICKS[t][0]); }
    putSlot(date, { ...s }); render(); draw();
  }
  draw();
}

function finishNote(date, s, codes, anchorEl) {
  if (!codes.length) return;
  const before = stats(date);
  const wasBilled = s.status === "billed";
  const upd = { ...s, codes, status: "billed", billedAt: wasBilled && s.billedAt ? s.billedAt : Date.now(), comment: $("#slotComment")?.value.trim() || s.comment || "" };
  putSlot(date, upd);
  closeSheet(); render();
  if (wasBilled) { toast("Codes updated"); return; }
  const after = stats(date);
  const el = anchorEl && document.body.contains(anchorEl) ? anchorEl : $(`.slot[data-id="${CSS.escape(s.id)}"]`);
  const r = el?.getBoundingClientRect();
  FX.celebrateNote(r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight / 2);
  showProgress(date, before, after);
  if (after.expected > 0 && after.billed >= after.expected && before.billed < before.expected) setTimeout(() => FX.celebrateDay(), 1300);
  pomoNoteDone();
}

// ---- non-patient sheet (meetings, MD/APD time, blocks)
function openOtherSheet(date, s) {
  const draw = () => {
    const role = C.roleOf(s);
    openSheet(`
      <h3>${s.type === "MTG" ? "👥 Meeting" : s.type === "MD" ? "🏥 Medical Director time" : s.type === "APD" ? "🎓 APD time" : "⛔ Blocked"}</h3>
      <div class="sub">${dateShort(date)} · ${C.fmtTime(s.start)}–${C.fmtTime(s.start + s.dur)} · ${C.fmtDuration(s.dur)}${s.status === "canceled" ? " · canceled" : ""}</div>
      ${s.type === "MTG" || s.type === "BLK" ? `<section><label class="lbl">Title</label><input id="oTitle" value="${esc(s.title || "")}"></section>` : ""}
      ${s.type === "MTG" ? `<section><label class="lbl">Counts toward</label><div class="pills">
        <button data-role="MD" class="${role === "MD" ? "on" : ""}">Medical Director</button>
        <button data-role="APD" class="${role === "APD" ? "on" : ""}">APD</button>
        <button data-role="" class="${!role ? "on" : ""}">Neither</button></div></section>` : ""}
      ${s.type === "MD" || s.type === "APD" ? `<section><label class="lbl">Role</label><div class="pills">
        <button data-type2="MD" class="${s.type === "MD" ? "on" : ""}">Medical Director</button>
        <button data-type2="APD" class="${s.type === "APD" ? "on" : ""}">Associate Program Director</button></div></section>` : ""}
      <section><label class="lbl">${role ? "What did you do? (shows in the Friday email)" : "Note"}</label>
        <textarea id="oComment" rows="2" placeholder="${role ? "e.g. GME meeting, schedule review" : ""}">${esc(s.comment || "")}</textarea></section>
      <section><label class="lbl">Time</label>
        <div class="row">
          <div class="stepper"><button class="btn sm" data-st="-15">−</button><b>${C.fmtTime(s.start)}</b><button class="btn sm" data-st="15">+</button></div>
          <div class="stepper"><button class="btn sm" data-du="-15">−</button><b>${C.fmtDuration(s.dur).replace(" minutes", " min")}</b><button class="btn sm" data-du="15">+</button></div>
          <input type="date" id="oDate" value="${date}" style="width:auto">
        </div></section>
      <section><div class="actions">
        <button class="btn ${s.status === "canceled" ? "on" : ""}" id="oCancel">${s.status === "canceled" ? "↩︎ Not canceled" : "🚫 Canceled this time"}</button>
        <button class="btn danger" id="oDel">🗑️ Delete</button>
        <button class="btn primary" id="oDone">Done</button>
      </div></section>`);
    const sh = $("#sheet");
    const commit = () => { putSlot(date, { ...s }); render(); };
    $("#oTitle", sh)?.addEventListener("input", (e) => { s.title = e.target.value; });
    $("#oTitle", sh)?.addEventListener("change", commit);
    $("#oComment", sh).addEventListener("input", (e) => { s.comment = e.target.value; });
    $("#oComment", sh).addEventListener("change", commit);
    $$("[data-role]", sh).forEach((b) => b.onclick = () => { s.role = b.dataset.role || null; commit(); draw(); });
    $$("[data-type2]", sh).forEach((b) => b.onclick = () => { s.type = b.dataset.type2; commit(); draw(); });
    $$("[data-st]", sh).forEach((b) => b.onclick = () => { s.start = Math.max(300, Math.min(22 * 60 - 15, s.start + Number(b.dataset.st))); commit(); draw(); });
    $$("[data-du]", sh).forEach((b) => b.onclick = () => { s.dur = Math.max(15, Math.min(600, s.dur + Number(b.dataset.du))); commit(); draw(); });
    $("#oDate", sh).onchange = (e) => { const nd = e.target.value; if (!nd || nd === date) return; removeSlot(date, s.id); putSlot(nd, { ...s, id: uid(nd) }); closeSheet(); render(); toast(`Moved to ${dateShort(nd)}`); };
    $("#oCancel", sh).onclick = () => { s.status = s.status === "canceled" ? "scheduled" : "canceled"; commit(); draw(); };
    $("#oDel", sh).onclick = () => { removeSlot(date, s.id); closeSheet(); render(); };
    $("#oDone", sh).onclick = () => { s.comment = $("#oComment").value.trim(); if ($("#oTitle")) s.title = $("#oTitle").value.trim(); commit(); closeSheet(); };
  };
  draw();
}

// ---- day menu (time off, reset)
function openDayMenu(date) {
  const off = C.isDayOff(state, date);
  openSheet(`<h3>${dateLong(date)}</h3>
    ${off ? `<div class="banner">🏖️ ${esc(state.days[date]?.offLabel || "Day off")}</div><button class="btn primary block" id="dmOn">Back at work this day</button>` : `
    <section><label class="lbl">Mark this day off</label>
      <div class="pills" id="dmLabels">${["Vacation", "Holiday", "Sick", "Conference", "Day off"].map((l, i) => `<button class="${i === 0 ? "on" : ""}">${l}</button>`).join("")}</div>
      <div class="row" style="margin-top:8px"><label class="muted" style="font-weight:800">Through</label><input type="date" id="dmTo" value="${date}" min="${date}" style="width:auto"></div>
      <button class="btn primary block" id="dmOff" style="margin-top:10px">🏖️ Mark off</button></section>`}
    <section><div class="actions">
      <button class="btn" id="dmMd">🏥 Log MD time</button>
      <button class="btn" id="dmApd">🎓 Log APD time</button>
      ${!isHistDate(date) ? `<button class="btn danger" id="dmReset">↺ Reset day to template</button>` : ""}
    </div></section>`);
  const sh = $("#sheet");
  let label = "Vacation";
  $$("#dmLabels button", sh).forEach((b) => b.onclick = () => { label = b.textContent; $$("#dmLabels button", sh).forEach((x) => x.classList.toggle("on", x === b)); });
  $("#dmOff", sh)?.addEventListener("click", () => markRangeOff(date, $("#dmTo").value || date, label));
  $("#dmOn", sh)?.addEventListener("click", () => { setDayOff(date, false); changed(); closeSheet(); render(); });
  $("#dmMd", sh).onclick = () => openLogSheet("MD", date);
  $("#dmApd", sh).onclick = () => openLogSheet("APD", date);
  $("#dmReset", sh)?.addEventListener("click", () => {
    if (!confirm("Reset this day to your template? Codes and changes for this day will be cleared.")) return;
    const rec = dayRec(date);
    for (const id of Object.keys(rec.slots)) rec.slots[id] = { deleted: true, updatedAt: Date.now() };
    for (const g of C.generateDay(date, state.settings)) { const { gen, ...rest } = g; void gen; rec.slots[g.id] = { ...rest, updatedAt: Date.now() + 1 }; }
    changed(); closeSheet(); render();
  });
}
function markRangeOff(from, to, label) {
  let n = 0;
  for (let d = from; d <= to; d = C.addDays(d, 1)) {
    const wd = C.weekday(d);
    if ((wd === 0 || wd === 6) && from !== to && !C.resolveDay(state, d).length) continue;
    setDayOff(d, true, label); n++;
  }
  changed(); closeSheet(); render(); toast(`🏖️ ${n} day${n === 1 ? "" : "s"} marked ${label.toLowerCase()}`);
}

// ---- quick log of MD / APD time
function openLogSheet(role, date = todayStr()) {
  const opts = []; for (let m = 6 * 60; m <= 20 * 60; m += 15) opts.push(m);
  const now = snap(nowMin()) - 60;
  openSheet(`<h3>${role === "MD" ? "🏥 Log Medical Director time" : "🎓 Log APD time"}</h3>
    <div class="field"><label>Date</label><input type="date" id="lgDate" value="${date}"></div>
    <div class="row"><div class="field grow"><label>Start</label><select id="lgStart">${opts.map((m) => `<option value="${m}" ${m === Math.max(360, Math.min(1200, now)) ? "selected" : ""}>${C.fmtTime(m)}</option>`).join("")}</select></div>
    <div class="field grow"><label>Length</label><select id="lgDur">${[15, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 360, 480].map((m) => `<option value="${m}" ${m === 60 ? "selected" : ""}>${C.fmtDuration(m)}</option>`).join("")}</select></div></div>
    <div class="field"><label>What did you do?</label><input id="lgText" placeholder="e.g. GME meeting"></div>
    <button class="btn primary block" id="lgSave">Save</button>`);
  $("#lgSave").onclick = () => {
    const d = $("#lgDate").value || date;
    const s = { id: uid(d), type: role, start: Number($("#lgStart").value), dur: Number($("#lgDur").value), status: "scheduled", comment: $("#lgText").value.trim() };
    putSlot(d, s); closeSheet(); render(); toast(`Logged ${C.fmtDuration(s.dur)} of ${role} time`);
  };
}

/* ================================================================ progress toast */
let progTimer;
function showProgress(date, before, after) {
  const el = $("#progressToast");
  const total = Math.max(after.expected, after.billed, 1);
  const segs = Array.from({ length: total }, (_, i) => `<span class="pseg ${i < before.billed ? "full" : i < after.billed ? "new" : ""}"></span>`).join("");
  const done = after.billed >= after.expected;
  el.innerHTML = `<div class="ptop"><span>${date === todayStr() ? "Today's notes" : dateShort(date)}</span><b>${after.billed} / ${after.expected}</b></div><div class="ptrack">${segs}</div>`;
  el.classList.toggle("complete", done);
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  clearTimeout(progTimer);
  progTimer = setTimeout(() => el.classList.remove("show"), done ? 3400 : 2600);
}

/* ================================================================ live refresh (glow + now line) */
function tick() {
  if (ui.page !== "calendar" || drag.active) return;
  if (ui.view === "day" || ui.view === "week") {
    const wrap = $(".tl-wrap"); if (!wrap) return;
    const ppm = Number(wrap.dataset.ppm);
    const nl = $(".now-line"); if (nl) nl.style.top = `${(nowMin() - range.start) * ppm}px`;
    let changedAny = false;
    for (const el of $$(".slot[data-id]")) {
      const s = getSlot(el.dataset.date, el.dataset.id);
      if (!s) continue;
      const od = C.isPatient(s) && s.status === "scheduled" && slotEndMs(el.dataset.date, s) <= Date.now();
      if (od !== el.classList.contains("overdue")) { el.classList.toggle("overdue", od); changedAny = true; }
    }
    if (changedAny) renderDaybar();
  }
}
let lastDay = todayStr();
setInterval(() => {
  const t = todayStr();
  if (t !== lastDay) { lastDay = t; freezePast(); changed(); if (ui.page === "calendar") { ui.date = t; render(); } }
  tick();
}, 20000);

/* ================================================================ streaks & analytics */
function liveDates() {
  const out = [], t = todayStr();
  for (let d = state.settings.startDate; d <= t; d = C.addDays(d, 1)) out.push(d);
  return out;
}
function computeStreaks() {
  const t = todayStr();
  const res = { closer: { current: 0, best: 0 }, morning: { current: 0, best: 0 }, quick: { current: 0, best: 0 } };
  const days = [];
  for (const d of liveDates()) {
    if (C.isDayOff(state, d)) continue;
    const slots = C.resolveDay(state, d).filter((s) => C.isPatient(s) && s.status !== "canceled" && s.status !== "noshow");
    if (!slots.length) continue;
    const eod = C.parseYmd(d); eod.setHours(23, 59, 59, 999);
    const allDone = slots.every((s) => s.status === "billed" && (s.billedAt || 0) <= eod.getTime());
    const am = slots.filter((s) => s.start < 12 * 60), pm = slots.filter((s) => s.start >= 12 * 60);
    const pmStart = pm.length ? Math.min(...pm.map((s) => s.start)) : 13 * 60;
    const cut = C.parseYmd(d); cut.setHours(0, 0, 0, 0);
    const amDone = am.length ? am.every((s) => s.status === "billed" && s.billedAt <= cut.getTime() + pmStart * 60000) : null;
    const quick = slots.every((s) => s.status === "billed" && s.billedAt - slotEndMs(d, s) <= 60 * 60000);
    days.push({ d, allDone, amDone, quick, inProgress: d === t && !allDone });
  }
  const run = (key, skipNull) => {
    let cur = 0, best = 0, streak = 0;
    for (const x of days) {
      const v = x[key];
      if (v == null && skipNull) continue;
      if (v) { streak++; best = Math.max(best, streak); }
      else if (!x.inProgress) streak = 0;
    }
    cur = streak;
    return { current: cur, best };
  };
  res.closer = run("allDone");
  res.morning = run("amDone", true);
  res.quick = run("quick");
  return res;
}

function billedLive() {
  const out = [];
  for (const d of liveDates()) for (const s of C.resolveDay(state, d)) {
    if (C.isPatient(s) && s.status === "billed" && s.billedAt) out.push({ d, s, lagMin: (s.billedAt - slotEndMs(d, s)) / 60000, hour: new Date(s.billedAt).getHours() + new Date(s.billedAt).getMinutes() / 60 });
  }
  return out;
}

function barChart(values, labels, { h = 160, color = "var(--primary)", fmt = (v) => r1(v), highlight = -1 } = {}) {
  // fixed-width bars so text never stretches; the card scrolls sideways when there are many
  const bw = values.length > 24 ? 30 : 44, w = Math.max(300, values.length * bw), max = Math.max(...values, 0.0001);
  const every = bw >= 40 ? 1 : Math.ceil(values.length / Math.max(1, Math.floor(w / 46)));
  let bars = "";
  values.forEach((v, i) => {
    const bh = (v / max) * (h - 40);
    const x = i * bw + bw * 0.14, y = h - 20 - bh, cx = x + bw * 0.36;
    bars += `<rect x="${x}" y="${y}" width="${bw * 0.72}" height="${Math.max(bh, v ? 2 : 0)}" rx="6" fill="${i === highlight ? "var(--accent)" : color}"><title>${esc(labels[i])}: ${fmt(v)}</title></rect>`;
    if (v && bw >= 40) bars += `<text x="${cx}" y="${y - 5}" text-anchor="middle">${fmt(v)}</text>`;
    if (labels[i] && i % every === 0) bars += `<text x="${cx}" y="${h - 5}" text-anchor="middle">${esc(labels[i])}</text>`;
  });
  return `<div style="overflow-x:auto"><svg class="chart" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="width:${w}px;max-width:none">${bars}</svg></div>`;
}

function renderInsights() {
  const st = computeStreaks();
  const B = billedLive();
  const hrsFmt = (m) => (Math.abs(m) < 60 ? `${Math.round(m)} min` : `${r1(m / 60)} hr`);
  let body = `<h2>Habits & streaks</h2>
    <div class="streaks">
      <div class="streak"><span class="fire">🔥</span><small>Day closer</small><b>${st.closer.current}</b><p>days in a row with every note done by midnight · best ${st.closer.best}</p></div>
      <div class="streak"><span class="fire">🌅</span><small>Morning sweep</small><b>${st.morning.current}</b><p>days with AM notes done before the first PM patient · best ${st.morning.best}</p></div>
      <div class="streak"><span class="fire">⚡</span><small>Speed closer</small><b>${st.quick.current}</b><p>days with every note done within an hour of the visit · best ${st.quick.best}</p></div>
    </div>`;
  if (B.length < 3) {
    body += `<div class="card empty"><span class="e">🌱</span>Your note-timing analytics will grow here.<br>Every time you tap <b>Note done</b>, the app records when — after a few days you'll see when you finish notes fastest.</div>`;
  } else {
    const lags = B.map((x) => x.lagMin).sort((a, b) => a - b);
    const median = lags[Math.floor(lags.length / 2)];
    const sameDay = B.filter((x) => C.ymd(new Date(x.s.billedAt)) === x.d).length / B.length;
    const within1h = B.filter((x) => x.lagMin <= 60).length / B.length;
    const hours = Array.from({ length: 18 }, (_, i) => i + 6);
    const hc = hours.map((hh) => B.filter((x) => Math.floor(x.hour) === hh).length);
    const peak = hours[hc.indexOf(Math.max(...hc))];
    const wdLag = [1, 2, 3, 4, 5].map((wd) => { const xs = B.filter((x) => C.weekday(x.d) === wd); return xs.length ? xs.reduce((t, x) => t + Math.max(0, x.lagMin), 0) / xs.length / 60 : 0; });
    const typeLag = ["NP", "FU", "TH"].map((t) => { const xs = B.filter((x) => x.s.type === t); return xs.length ? xs.reduce((t2, x) => t2 + Math.max(0, x.lagMin), 0) / xs.length / 60 : 0; });
    const amLag = B.filter((x) => x.s.start < 720), pmLag = B.filter((x) => x.s.start >= 720);
    const avg = (xs) => (xs.length ? xs.reduce((t, x) => t + Math.max(0, x.lagMin), 0) / xs.length : 0);
    const bestWd = wdLag.indexOf(Math.min(...wdLag.filter((v) => v > 0)));
    const worstWd = wdLag.indexOf(Math.max(...wdLag));
    const insights = [
      ["⏰", `You close the most notes between <b>${C.fmtTime(peak * 60, { compact: true })}–${C.fmtTime((peak + 1) * 60, { compact: true })}</b>. That's your natural note window — protect it.`],
      ["⏱️", `Typical time from end of visit to note done: <b>${hrsFmt(median)}</b> (median).`],
      ["📅", `<b>${Math.round(sameDay * 100)}%</b> of notes are finished the same day; <b>${Math.round(within1h * 100)}%</b> within an hour.`],
      bestWd >= 0 && wdLag[worstWd] > 0 ? ["🏆", `Fastest day: <b>${C.DAY_NAMES[bestWd + 1]}</b> (${r1(wdLag[bestWd])} hr avg). Slowest: <b>${C.DAY_NAMES[worstWd + 1]}</b> (${r1(wdLag[worstWd])} hr).`] : null,
      amLag.length && pmLag.length ? ["🌗", `Morning visits wait <b>${hrsFmt(avg(amLag))}</b> on average; afternoon visits wait <b>${hrsFmt(avg(pmLag))}</b>.`] : null,
      typeLag[0] && typeLag[1] ? ["🆕", `New-patient notes take <b>${r1(typeLag[0])} hr</b> to close vs <b>${r1(typeLag[1])} hr</b> for follow-ups${typeLag[0] > typeLag[1] * 1.5 ? " — try blocking 20 minutes right after each NP" : ""}.`] : null,
    ].filter(Boolean);
    body += `<div class="kpis">
        <div class="kpi hero"><small>Notes tracked</small><b>${B.length}</b></div>
        <div class="kpi"><small>Median wait</small><b>${hrsFmt(median)}</b></div>
        <div class="kpi"><small>Same day</small><b>${Math.round(sameDay * 100)}%</b></div>
        <div class="kpi"><small>Within 1 hr</small><b>${Math.round(within1h * 100)}%</b></div>
      </div>
      <div class="card">${insights.map(([i, t]) => `<div class="insight"><i>${i}</i><div>${t}</div></div>`).join("")}</div>
      <div class="card"><h3 style="margin-top:0">When you finish notes</h3>${barChart(hc, hours.map((hh) => C.fmtTime(hh * 60, { compact: true }).replace("m", "")), { fmt: (v) => v, highlight: hours.indexOf(peak) })}</div>
      <div class="card"><h3 style="margin-top:0">Average hours until note done, by weekday</h3>${barChart(wdLag, ["Mon", "Tue", "Wed", "Thu", "Fri"], { color: "var(--accent-2)" })}</div>
      <div class="card"><h3 style="margin-top:0">By visit type (hours)</h3>${barChart(typeLag, ["New pt", "Follow-up", "Therapy"], { color: "var(--th)" })}</div>`;
  }
  // inbox tallies
  const last30 = Array.from({ length: 30 }, (_, i) => C.addDays(todayStr(), -29 + i));
  const tally = last30.map((d) => state.counters[d] || {});
  const sum = (k) => tally.reduce((t, c) => t + (c[k] || 0), 0);
  const inOf = (c, k) => c[k + "In"] ?? c[k] ?? 0; // older days only stored the count
  const sumIn = (k) => tally.reduce((t, c) => t + inOf(c, k), 0);
  const tallyDays = tally.filter((c) => inOf(c, "msg") + inOf(c, "rx") + inOf(c, "call") > 0).length;
  body += `<div class="card"><h3 style="margin-top:0">In-basket tally · last 30 days</h3>
    ${tallyDays ? `<div class="kpis">${[["msg", "💬 Messages"], ["rx", "💊 Rx requests"], ["call", "📞 Calls"]].map(([k, l]) => `<div class="kpi"><small>${l}</small><b>${sumIn(k)}</b><em>${r1(sumIn(k) / tallyDays)}/day · ${sum(k + "Done")} handled</em></div>`).join("")}</div>
    ${barChart(tally.map((c) => inOf(c, "msg") + inOf(c, "rx") + inOf(c, "call")), last30.map((d) => String(C.parseYmd(d).getDate())), { color: "var(--apd)", fmt: (v) => v })}`
    : `<p class="muted">Tap 💬 💊 📞 in the Day view: + when one comes in, − when you've handled it. Totals show up here.</p>`}</div>`;
  const pomo = load(K.pomo, { log: [] });
  const wk = (pomo.log || []).filter((x) => x.d >= C.weekStart(todayStr()));
  body += `<div class="card"><h3 style="margin-top:0">🍅 Focus sessions</h3><p>${wk.length} this week · ${(pomo.log || []).length} total · ${wk.reduce((t, x) => t + (x.notes || 0), 0)} notes closed during sessions this week</p></div>`;
  return `<div class="page">${body}</div>`;
}

/* ================================================================ reports */
const REPORT_GROUPS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["half", "6 months"], ["season", "School vs summer"], ["year", "Year"]];
let rep = { group: "month", year: String(new Date().getFullYear()) };
function allDatesForReports() {
  const hd = Object.keys(hist.days).sort();
  const start = hd[0] || state.settings.startDate, end = todayStr();
  const out = [];
  for (let d = start; d <= end; d = C.addDays(d, 1)) out.push(d);
  return out;
}
function groupKey(g, d) {
  const y = C.yearOf(d), m = C.monthOf(d);
  switch (g) {
    case "day": return [d, `${C.DAY_SHORT[C.weekday(d)]} ${C.fmtUsDate(d)}`];
    case "week": { const ws = C.addDays(C.weekStart(d), 1); return [ws, `Week of ${C.fmtUsDate(ws)}`]; }
    case "month": return [`${y}-${C.pad(m)}`, `${C.MONTH_SHORT[m - 1]} ${y}`];
    case "half": return m <= 6 ? [`${y}-1`, `${y} Jan–Jun`] : [`${y}-2`, `${y} Jul–Dec`];
    // Same split as the spreadsheet: school months (Jan–May + Sep–Dec) vs summer (Jun–Aug) of each year
    case "season": return m >= 6 && m <= 8 ? [`${y}-2`, `${y} Summer (Jun–Aug)`] : [`${y}-1`, `${y} School months (Sep–May)`];
    default: return [String(y), String(y)];
  }
}
function reportRows() {
  const rows = new Map();
  for (const d of allDatesForReports()) {
    if (rep.year !== "all" && d.slice(0, 4) !== rep.year) continue;
    const s = stats(d);
    if (!s.seen && !s.noshow && !s.canceled && !s.off) continue;
    const [key, label] = groupKey(rep.group, d);
    const r = rows.get(key) || { key, label, days: 0, seen: 0, np: 0, fu: 0, th: 0, cx: 0, cxKnown: false, ns: 0, nsKnown: false, rvu: 0, income: 0, incomeKnown: false, incomeMissing: false, months: new Set(), off: 0 };
    if (s.off) r.off++;
    r.days += s.working ? 1 : 0; r.seen += s.seen; r.rvu += s.rvu;
    if (s.working) r.months.add(d.slice(0, 7));
    r.np += (s.codes["90792"] || 0) + (s.codes["99205"] || 0);
    r.fu += ["99212", "99213", "99214", "99215"].reduce((t, c) => t + (s.codes[c] || 0), 0);
    r.th += ["90832", "90834", "90837", "90846", "90847"].reduce((t, c) => t + (s.codes[c] || 0), 0);
    if (s.canceled != null) { r.cx += s.canceled; r.cxKnown = true; }
    if (s.noshow != null) { r.ns += s.noshow; r.nsKnown = r.nsKnown || s.source === "live" || d >= "2022-12-01"; }
    const rate = C.dollarRate(state.settings, C.yearOf(d));
    if (rate != null) { r.income += s.rvu * rate; r.incomeKnown = true; } else if (s.rvu) r.incomeMissing = true;
    rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => a.key.localeCompare(b.key));
}
function renderReports() {
  const years = [...new Set(allDatesForReports().map((d) => d.slice(0, 4)))].sort();
  if (rep.year !== "all" && !years.includes(rep.year)) rep.year = years[years.length - 1];
  const rows = reportRows();
  const T = rows.reduce((t, r) => ({ days: t.days + r.days, seen: t.seen + r.seen, np: t.np + r.np, fu: t.fu + r.fu, th: t.th + r.th, cx: t.cx + r.cx, ns: t.ns + r.ns, rvu: t.rvu + r.rvu, income: t.income + r.income, months: new Set([...t.months, ...r.months]), incomeKnown: t.incomeKnown || r.incomeKnown }), { days: 0, seen: 0, np: 0, fu: 0, th: 0, cx: 0, ns: 0, rvu: 0, income: 0, months: new Set(), incomeKnown: false });
  const curYear = new Date().getFullYear();
  const yr = rep.year === "all" ? curYear : Number(rep.year);
  const rate = C.dollarRate(state.settings, yr);
  const avgMonth = T.months.size ? T.rvu / T.months.size : 0;
  const showMonthAvg = ["half", "season", "year"].includes(rep.group);
  const nsRate = (ns, seen) => (seen + ns ? `${Math.round((ns / (seen + ns)) * 100)}%` : "—");
  const table = `<div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>${REPORT_GROUPS.find((g) => g[0] === rep.group)[1]}</th><th>Working days</th><th>Patients</th><th>NP</th><th>F/U</th><th>Therapy</th><th>Cancels</th><th>No-shows</th><th>No-show %</th><th>RVU</th><th>RVU / day</th>${showMonthAvg ? "<th>Avg RVU / month</th>" : ""}<th>$ / RVU</th><th>Income</th></tr></thead><tbody>
      ${rows.map((r) => {
        const yrs = new Set([...r.months].map((m) => m.slice(0, 4)));
        const rateTxt = yrs.size === 1 ? (C.dollarRate(state.settings, Number([...yrs][0])) != null ? "$" + C.dollarRate(state.settings, Number([...yrs][0])) : "—") : yrs.size ? "mixed" : "—";
        return `<tr><td>${esc(r.label)}${r.off && !r.days ? " 🏖️" : ""}</td><td>${r.days}</td><td>${r.seen}</td><td>${r.np}</td><td>${r.fu}</td><td>${r.th}</td><td>${r.cxKnown ? r.cx : "—"}</td><td>${r.nsKnown ? r.ns : "—"}</td><td>${r.nsKnown ? nsRate(r.ns, r.seen) : "—"}</td><td>${r2(r.rvu)}</td><td>${r.days ? r2(r.rvu / r.days) : "—"}</td>${showMonthAvg ? `<td>${r.months.size ? r2(r.rvu / r.months.size) : "—"}</td>` : ""}<td>${rateTxt}</td><td>${r.incomeKnown ? money(r.income) + (r.incomeMissing ? "*" : "") : "—"}</td></tr>`;
      }).join("")}
      <tr class="total"><td>Total</td><td>${T.days}</td><td>${T.seen}</td><td>${T.np}</td><td>${T.fu}</td><td>${T.th}</td><td>${T.cx}</td><td>${T.ns}</td><td>${nsRate(T.ns, T.seen)}</td><td>${r2(T.rvu)}</td><td>${T.days ? r2(T.rvu / T.days) : "—"}</td>${showMonthAvg ? `<td>${r2(avgMonth)}</td>` : ""}<td></td><td>${T.incomeKnown ? money(T.income) : "—"}</td></tr>
    </tbody></table></div>`;
  const chartRows = rows.slice(-36);
  return `<div class="page">
    <h2>Reports</h2>
    <div class="controls">
      <div class="pills">${REPORT_GROUPS.map(([k, l]) => `<button data-rgroup="${k}" class="${rep.group === k ? "on" : ""}">${l}</button>`).join("")}</div>
      <select id="rYear">${rep.group === "day" || rep.group === "week" ? "" : `<option value="all" ${rep.year === "all" ? "selected" : ""}>All years</option>`}${years.map((y) => `<option ${rep.year === y ? "selected" : ""}>${y}</option>`).join("")}</select>
    </div>
    <div class="kpis">
      <div class="kpi hero"><small>Total RVU</small><b>${r2(T.rvu)}</b><em>${T.incomeKnown ? money(T.income) : "no $/RVU rate on file"}</em></div>
      <div class="kpi"><small>Working days</small><b>${T.days}</b><em>${T.seen} patients</em></div>
      <div class="kpi"><small>Avg RVU / day</small><b>${T.days ? r2(T.rvu / T.days) : "—"}</b></div>
      <div class="kpi"><small>Avg RVU / month</small><b>${r2(avgMonth)}</b></div>
      <div class="kpi"><small>No-shows</small><b>${T.ns}</b><em>${nsRate(T.ns, T.seen)} · ${T.cx} cancels</em></div>
      ${rate != null && rep.year !== "all" ? `<div class="kpi"><small>Annual pace ${yr}</small><b>${money(avgMonth * 12 * rate)}</b><em>avg month × 12 × $${rate}</em></div>` : ""}
    </div>
    ${chartRows.length > 1 ? `<div class="card"><h3 style="margin-top:0">RVU by ${REPORT_GROUPS.find((g) => g[0] === rep.group)[1].toLowerCase()}</h3>${barChart(chartRows.map((r) => r.rvu), chartRows.map((r) => rep.group === "month" ? C.MONTH_SHORT[Number(r.key.slice(5, 7)) - 1] + (rep.year === "all" ? " '" + r.key.slice(2, 4) : "") : rep.group === "day" ? String(Number(r.key.slice(8))) : rep.group === "week" ? r.key.slice(5).replace("-", "/") : rep.group === "season" ? (r.key.endsWith("2") ? "Sum " : "Sch ") + r.key.slice(2, 4) : rep.group === "half" ? (r.key.endsWith("1") ? "H1 " : "H2 ") + r.key.slice(2, 4) : r.label), { fmt: (v) => Math.round(v) })}</div>` : ""}
    ${table}
    <p class="help">Imported years count "X" days as days off and don't include cancellations (the spreadsheet didn't track them). No-shows were tracked from Dec 2022 on. Income uses each year's $/RVU rate (Settings → Billing).${rows.some((r) => r.incomeMissing) ? " * Some days in this row have no rate on file." : ""}</p>
  </div>`;
}

/* ================================================================ MD / APD hours */
function renderHours() {
  const ws = C.weekStart(ui.date);
  const e = C.weekRoleEntries(state, ui.date);
  const block = (role, icon) => {
    const items = e[role];
    const total = items.reduce((t, x) => t + x.dur, 0);
    return `<div class="card role-block"><h3 style="margin-top:0">${icon} ${C.ROLE_NAMES[role]}<span class="muted">${C.fmtDuration(total)}</span></h3>
      ${items.length ? items.map((x) => { const sl = C.resolveDay(state, x.date).find((s) => s.start === x.start && C.roleOf(s) === role && s.status !== "canceled"); return `<button class="entry" data-slot="${esc(sl?.id || "")}" data-date="${x.date}">
        <span class="when">${C.DAY_SHORT[C.weekday(x.date)]} ${C.fmtUsDate(x.date).slice(0, 5)}<br><span class="muted">${C.fmtTime(x.start)}</span></span>
        <span class="what">${x.text ? esc(x.text) : `<span class="muted">No description yet — tap to add one</span>`}</span>
        <span class="dur">${C.fmtDuration(x.dur).replace(" minutes", " min")}</span></button>`; }).join("") : `<p class="muted">Nothing logged this week.</p>`}
      <button class="btn sm" data-log="${role}" style="margin-top:8px">+ Log ${role} time</button></div>`;
  };
  const text = C.weekSummaryText(state, ui.date);
  const isCurrent = ws === C.weekStart(todayStr());
  return `<div class="page">
    <h2>MD / APD hours</h2>
    ${block("MD", "🏥")}${block("APD", "🎓")}
    <div class="card"><h3 style="margin-top:0">📧 Friday email</h3>
      <p class="help">${isCurrent ? "This goes" : "This week's version went"} to <b>${esc(state.settings.email)}</b> automatically every Friday at 4:00 PM. Recurring meetings count toward Medical Director unless you mark them canceled.</p>
      <pre class="email">${esc(text)}</pre>
      <div class="row" style="margin-top:10px">
        <button class="btn sm" id="copyEmail">📋 Copy</button>
        <button class="btn sm" id="sendNow">📨 Send this week's email now</button>
      </div>
    </div></div>`;
}

/* ================================================================ settings */
function renderSettings() {
  const st = state.settings;
  const upcomingOff = Object.entries(state.days).filter(([d, x]) => x.off && d >= C.addDays(todayStr(), -7)).sort(([a], [b]) => a.localeCompare(b));
  const rvuYears = Object.keys(st.rvu).sort();
  const timeOpts = (sel) => { let o = ""; for (let m = 5 * 60; m <= 21 * 60; m += 15) o += `<option value="${m}" ${m === sel ? "selected" : ""}>${C.fmtTime(m)}</option>`; return o; };
  return `<div class="page">
    <h2>Settings</h2>

    <div class="card"><h3 style="margin-top:0">🎨 Theme</h3>
      <div class="swatches">${Object.entries(THEMES).map(([k, t]) => `<button class="swatch ${st.theme === k ? "on" : ""}" data-theme-pick="${k}"><span class="dots">${t.colors.map((c) => `<i style="background:${c}"></i>`).join("")}</span>${t.name}</button>`).join("")}</div>
    </div>

    <div class="card" id="syncCard"><h3 style="margin-top:0">🔄 Sync (GitHub)</h3>
      <p class="help">Status: <b>${esc(sync.status === "ok" ? "Synced " + (sync.lastSync ? timeOfMs(sync.lastSync) : "") : sync.message || sync.status)}</b></p>
      <div class="row"><div class="field grow"><label>Owner</label><input id="syOwner" value="${esc(sync.owner)}"></div><div class="field grow"><label>Private data repo</label><input id="syRepo" value="${esc(sync.repo)}"></div></div>
      <div class="field"><label>Access token (stays on this device)</label><input id="syToken" type="password" value="${esc(sync.token)}" placeholder="github_pat_…" autocomplete="off"></div>
      <div class="row"><button class="btn primary sm" id="sySave">Save & sync now</button>${sync.token ? `<button class="btn sm danger" id="syForget">Forget token on this device</button>` : ""}</div>
      <details class="help" style="margin-top:10px"><summary><b>How to make a token (one time per device)</b></summary><ol>
        <li>On github.com go to <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
        <li>Name it "RVU Tracker". Pick the longest expiration offered.</li>
        <li>Repository access: <b>Only select repositories → RVU-tracker-data</b>.</li>
        <li>Permissions → Repository: <b>Contents: Read and write</b> and <b>Actions: Read and write</b> (the second one powers "Send email now").</li>
        <li>Generate, copy, paste it above. You can reuse the same token on your iPhone, iPad and computer.</li></ol></details>
    </div>

    <div class="card"><h3 style="margin-top:0">🏖️ Time off</h3>
      ${upcomingOff.length ? upcomingOff.map(([d, x]) => `<div class="row" style="justify-content:space-between;padding:4px 0"><span><b>${dateShort(d)}</b> · ${esc(x.offLabel || "Day off")}</span><button class="btn sm" data-unoff="${d}">Remove</button></div>`).join("") : `<p class="muted">No upcoming days off.</p>`}
      <div class="off-grid">
        <div class="field"><label>From</label><input type="date" id="offFrom" value="${todayStr()}"></div>
        <div class="field"><label>Through</label><input type="date" id="offTo" value="${todayStr()}"></div>
        <div class="field full"><label>Reason</label><select id="offLabel">${["Vacation", "Holiday", "Sick", "Conference", "Day off"].map((l) => `<option>${l}</option>`).join("")}</select></div>
      </div>
      <button class="btn primary sm" id="offAdd" style="margin-top:10px">Mark off</button>
      <p class="help">Weekends are skipped when you mark a range. Days off don't count as working days in reports.</p>
    </div>

    <div class="card"><h3 style="margin-top:0">🗓️ Weekly template</h3>
      <p class="help">Applies to today and future days that you haven't changed. Past days stay as they were.</p>
      ${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<div class="tpl-day"><b>${C.DAY_NAMES[wd]}</b>
        ${(st.template[wd] || []).map(([m, t], i) => `<div class="tpl-row"><select data-tpl-time="${wd}:${i}">${timeOpts(m)}</select>
          <select data-tpl-type="${wd}:${i}">${["NP", "FU", "TH"].map((x) => `<option value="${x}" ${x === t ? "selected" : ""}>${C.TYPES[x].label}</option>`).join("")}</select>
          <button class="btn sm danger" data-tpl-del="${wd}:${i}">✕</button></div>`).join("")}
        <button class="btn sm" data-tpl-add="${wd}">+ slot</button></div>`).join("")}
    </div>

    <div class="card"><h3 style="margin-top:0">🔁 Recurring meetings</h3>
      ${st.meetings.map((m, i) => `<div class="mtg-row">
        <input data-mtg="${i}:title" value="${esc(m.title)}">
        <div class="row">
          <select data-mtg="${i}:weekday">${[1, 2, 3, 4, 5].map((w) => `<option value="${w}" ${w === m.weekday ? "selected" : ""}>${C.DAY_NAMES[w]}</option>`).join("")}</select>
          <select data-mtg="${i}:start">${timeOpts(m.start)}</select>
          <select data-mtg="${i}:end">${timeOpts(m.end)}</select>
          <select data-mtg="${i}:role"><option value="MD" ${m.role === "MD" ? "selected" : ""}>Counts as MD</option><option value="APD" ${m.role === "APD" ? "selected" : ""}>Counts as APD</option><option value="" ${!m.role ? "selected" : ""}>Not counted</option></select>
        </div>
        <div class="row">${[1, 2, 3, 4, 5].map((n) => `<label class="check"><input type="checkbox" data-mtg-nth="${i}:${n}" ${m.nths.includes(n) ? "checked" : ""}>${["1st", "2nd", "3rd", "4th", "5th"][n - 1]}</label>`).join("")}</div>
        <div class="row"><label class="check"><input type="checkbox" data-mtg="${i}:clearsTemplate" ${m.clearsTemplate ? "checked" : ""}> Removes patient slots it overlaps</label>
        <label class="check"><input type="checkbox" data-mtg="${i}:disabled" ${m.disabled ? "checked" : ""}> Paused</label>
        <button class="btn sm danger" data-mtg-del="${i}">Delete</button></div></div>`).join("")}
      <button class="btn sm" id="mtgAdd">+ Recurring meeting</button>
      <p class="help">To skip one meeting, tap it on the calendar and choose "Canceled this time".</p>
    </div>

    <div class="card"><h3 style="margin-top:0">💵 Billing</h3>
      <div class="field"><label>Codes shown on every visit (besides the defaults)</label><input id="extraCodes" value="${esc(st.extraCodes.join(", "))}" placeholder="e.g. G2211, 90833"></div>
      <h3>$ per RVU</h3>
      <div class="rvu-grid">${Array.from(new Set([...Object.keys(st.dollars), ...Object.keys(hist.days).map((d) => d.slice(0, 4)), String(new Date().getFullYear())])).sort().map((y) => `<label>${y}<input data-dollar="${y}" inputmode="decimal" value="${st.dollars[y] ?? ""}" placeholder="—"></label>`).join("")}</div>
      ${rvuYears.map((y, i) => `<h3>RVU values ${y}${rvuYears[i + 1] ? "–" + (Number(rvuYears[i + 1]) - 1) : "+"}</h3>
        <div class="rvu-grid">${Object.entries(st.rvu[y]).sort().map(([c, v]) => `<label>${esc(c)}<input data-rvu="${y}:${esc(c)}" inputmode="decimal" value="${v ?? ""}" placeholder="—"></label>`).join("")}</div>`).join("")}
      <div class="row" style="margin-top:10px"><button class="btn sm" id="rvuNewYear">+ New RVU table starting a new year</button></div>
    </div>

    <div class="card"><h3 style="margin-top:0">🕗 Calendar</h3>
      <div class="row"><div class="field grow"><label>Day view starts</label><select id="dayStart">${timeOpts(st.dayStart)}</select></div>
      <div class="field grow"><label>Day view ends</label><select id="dayEnd">${timeOpts(st.dayEnd)}</select></div></div>
      <div class="field"><label>Friday email goes to</label><input id="emailTo" value="${esc(st.email)}"></div>
      <p class="help">The template starts on ${dateShort(st.startDate)}; days before that come from your spreadsheet.</p>
    </div>

    <div class="card"><h3 style="margin-top:0">🎉 Celebrations</h3>
      <p class="help">One of these plays at random after each note:</p>
      <div class="pills">${FX.fxNames().small.map((n) => `<button data-fx="${n}">${n.replace(/([A-Z])/g, " $1").toLowerCase()}</button>`).join("")}</div>
      <p class="help">…and one of these when the whole day is done:</p>
      <div class="pills">${FX.fxNames().big.map((n) => `<button data-fx="${n}">${n.replace(/([A-Z])/g, " $1").toLowerCase()}</button>`).join("")}</div>
    </div>

    <div class="card"><h3 style="margin-top:0">💾 Data</h3>
      <div class="row"><button class="btn sm" id="exportBtn">Download a backup</button>
      <label class="btn sm">Restore a backup<input type="file" id="importFile" accept="application/json" hidden></label></div>
      <p class="help">History: ${Object.keys(hist.days).length} imported days${Object.keys(hist.days).length ? "" : " — add your token above to load them"}.</p>
    </div>
    <p class="help" style="text-align:center">RVU Tracker · Spencer edition</p>
  </div>`;
}

function bindSettings(e) {
  const t = e.target, st = state.settings;
  const bump = () => { st.updatedAt = Date.now(); changed(); };
  if (t.dataset.themePick) { st.theme = t.closest("[data-theme-pick]").dataset.themePick; bump(); render(); return true; }
  const tp = t.closest("[data-theme-pick]"); if (tp) { st.theme = tp.dataset.themePick; bump(); render(); return true; }
  if (t.dataset.tplAdd) { const wd = t.dataset.tplAdd; const list = (st.template[wd] ||= []); const last = list[list.length - 1]; list.push([last ? last[0] + C.TYPES[last[1]].dur : 480, "FU"]); bump(); render(); return true; }
  if (t.dataset.tplDel) { const [wd, i] = t.dataset.tplDel.split(":"); st.template[wd].splice(Number(i), 1); bump(); render(); return true; }
  if (t.dataset.mtgDel) { if (confirm("Delete this recurring meeting?")) { st.meetings.splice(Number(t.dataset.mtgDel), 1); bump(); render(); } return true; }
  if (t.id === "mtgAdd") { st.meetings.push({ id: "m" + Date.now().toString(36), title: "New meeting", weekday: 2, nths: [1], start: 720, end: 780, role: "MD", clearsTemplate: false }); bump(); render(); return true; }
  if (t.dataset.fx) { FX.celebrate(t.dataset.fx); return true; }
  if (t.dataset.unoff) { setDayOff(t.dataset.unoff, false); changed(); render(); return true; }
  if (t.id === "offAdd") { const f = $("#offFrom").value, to = $("#offTo").value || f; if (f && to >= f) markRangeOff(f, to, $("#offLabel").value); return true; }
  if (t.id === "rvuNewYear") {
    const y = prompt("New RVU values take effect starting which year?", String(new Date().getFullYear() + 1));
    if (y && /^\d{4}$/.test(y)) { const prev = C.rvuTable(st, Number(y)); st.rvu[y] = { ...prev }; bump(); render(); }
    return true;
  }
  if (t.id === "sySave") {
    sync.owner = $("#syOwner").value.trim(); sync.repo = $("#syRepo").value.trim(); sync.token = $("#syToken").value.trim();
    save(K.sync, sync); syncNow(true); return true;
  }
  if (t.id === "syForget") { sync.token = ""; save(K.sync, sync); render(); return true; }
  if (t.id === "exportBtn") {
    const blob = new Blob([JSON.stringify({ state, history: hist }, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `rvu-tracker-backup-${todayStr()}.json`; a.click();
    return true;
  }
  return false;
}
function onSettingsChange(e) {
  const t = e.target, st = state.settings;
  const bump = () => { st.updatedAt = Date.now(); changed(); };
  if (t.dataset.tplTime || t.dataset.tplType) {
    const [wd, i] = (t.dataset.tplTime || t.dataset.tplType).split(":");
    const row = st.template[wd][Number(i)];
    if (t.dataset.tplTime) row[0] = Number(t.value); else row[1] = t.value;
    st.template[wd].sort((a, b) => a[0] - b[0]); bump(); render(); return;
  }
  if (t.dataset.mtg) {
    const [i, k] = t.dataset.mtg.split(":"); const m = st.meetings[Number(i)];
    if (t.type === "checkbox") m[k] = t.checked;
    else if (["weekday", "start", "end"].includes(k)) m[k] = Number(t.value);
    else if (k === "role") m.role = t.value || null;
    else m[k] = t.value;
    bump(); return;
  }
  if (t.dataset.mtgNth) {
    const [i, n] = t.dataset.mtgNth.split(":").map(Number); const m = st.meetings[i];
    m.nths = t.checked ? [...new Set([...m.nths, n])].sort() : m.nths.filter((x) => x !== n); bump(); return;
  }
  if (t.dataset.dollar) { const v = parseFloat(t.value); if (isNaN(v)) delete st.dollars[t.dataset.dollar]; else st.dollars[t.dataset.dollar] = v; bump(); return; }
  if (t.dataset.rvu) { const [y, c] = t.dataset.rvu.split(":"); const v = parseFloat(t.value); st.rvu[y][c] = isNaN(v) ? null : v; bump(); return; }
  if (t.id === "extraCodes") { st.extraCodes = [...new Set(t.value.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))]; bump(); return; }
  if (t.id === "dayStart") { st.dayStart = Number(t.value); range.start = st.dayStart; bump(); return; }
  if (t.id === "dayEnd") { st.dayEnd = Number(t.value); range.end = st.dayEnd; bump(); return; }
  if (t.id === "emailTo") { st.email = t.value.trim(); bump(); return; }
  if (t.id === "importFile" && t.files?.[0]) {
    t.files[0].text().then((txt) => {
      const data = JSON.parse(txt);
      if (data.state) state = C.mergeStates(data.state, state);
      if (data.history?.days) { hist = data.history; save(K.hist, hist); }
      changed(); render(); toast("Backup restored");
    }).catch((err) => toast("Couldn't read that file: " + err.message));
  }
}

/* ================================================================ GitHub sync */
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
async function gh(path, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}/${path}`, {
    ...opts, cache: "no-store",
    headers: { Authorization: `Bearer ${sync.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(opts.headers || {}) },
  });
  return res;
}
async function pullFile(path) {
  const res = await gh(`contents/${path}`);
  if (res.status === 404) return { data: null, sha: null };
  if (!res.ok) throw new Error(`${res.status} ${(await res.json().catch(() => ({}))).message || res.statusText}`);
  const j = await res.json();
  let text;
  if (j.content && j.encoding === "base64") text = b64decode(j.content);
  else { const raw = await gh(`contents/${path}`, { headers: { Accept: "application/vnd.github.raw+json" } }); text = await raw.text(); }
  return { data: JSON.parse(text), sha: j.sha };
}
async function pushFile(path, obj, sha, message) {
  const res = await gh(`contents/${path}`, { method: "PUT", body: JSON.stringify({ message, content: b64encode(JSON.stringify(obj)), ...(sha ? { sha } : {}) }) });
  if (!res.ok) { const err = new Error(`${res.status} ${(await res.json().catch(() => ({}))).message || ""}`); err.status = res.status; throw err; }
  return (await res.json()).content.sha;
}
let syncTimer, syncing = false, syncAgain = false;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 2500); }
function updateSyncDot() {
  const d = $("#syncDot");
  d.className = "sync-dot " + (!sync.token ? "" : sync.status === "busy" ? "busy" : sync.status === "ok" ? "ok" : sync.status === "error" ? "err" : "");
  d.title = !sync.token ? "Not syncing — add your GitHub token in Settings" : sync.status === "ok" ? `Synced ${timeOfMs(sync.lastSync)}` : sync.message || sync.status;
}
async function syncNow(manual = false) {
  if (!sync.token) { if (manual) toast("Add a token first"); updateSyncDot(); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true; sync.status = "busy"; updateSyncDot();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: remote, sha } = await pullFile("data.json");
      const merged = C.mergeStates(remote, state);
      const changedLocal = JSON.stringify(merged) !== JSON.stringify(state);
      const changedRemote = !remote || JSON.stringify(merged) !== JSON.stringify(remote);
      state = merged; persist();
      if (changedRemote) {
        try { await pushFile("data.json", state, sha, `Update from ${navigator.platform || "device"} ${new Date().toISOString()}`); }
        catch (e) { if (e.status === 409 || e.status === 422) continue; throw e; }
      }
      if (changedLocal && $("#sheet").hidden && !drag.active) render();
      break;
    }
    if (!Object.keys(hist.days).length || manual) {
      const h = await pullFile("history.json");
      if (h.data?.days) { hist = h.data; save(K.hist, hist); }
    }
    sync.status = "ok"; sync.lastSync = Date.now(); sync.message = "";
    if (manual) { toast("Synced ✓"); render(); }
  } catch (e) {
    sync.status = "error";
    sync.message = /401|Bad credentials/.test(e.message) ? "Token rejected — make a new one" : /404/.test(e.message) ? "Repo not found — check owner/repo and token access" : navigator.onLine ? `Sync error: ${e.message}` : "Offline — will sync when you're back online";
    if (manual) toast(sync.message, 4000);
  } finally {
    save(K.sync, sync); syncing = false; updateSyncDot();
    if (ui.page === "settings" && manual) render();
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
async function sendEmailNow() {
  if (!sync.token) { toast("Add your GitHub token in Settings first"); return; }
  await syncNow();
  const res = await gh("actions/workflows/weekly-email.yml/dispatches", { method: "POST", body: JSON.stringify({ ref: "main", inputs: { force: "true", week_of: ui.date } }) });
  if (res.status === 204) toast("📨 Sending — it'll arrive in a minute or two", 3500);
  else toast(`Couldn't start the email job (${res.status}). Does your token have Actions: Read and write?`, 5000);
}

/* ================================================================ pomodoro */
const POMO_MODES = [["focus", "Focus", 25], ["sprint", "Note sprint", 15], ["short", "Break", 5], ["long", "Long break", 15]];
let pomo = { mode: "focus", minutes: 25, endsAt: 0, remaining: 25 * 60, running: false, notes: 0, ...load(K.pomo + ".live", {}) };
let pomoTimer;
function pomoSave() { save(K.pomo + ".live", pomo); }
function pomoLeft() { return pomo.running ? Math.max(0, Math.round((pomo.endsAt - Date.now()) / 1000)) : pomo.remaining; }
function pomoNoteDone() { if (pomo.running && (pomo.mode === "focus" || pomo.mode === "sprint")) { pomo.notes++; pomoSave(); } }
function openPomo() {
  const draw = () => {
    const left = pomoLeft(), total = pomo.minutes * 60;
    const C2 = 2 * Math.PI * 104, off = C2 * (1 - left / total);
    const pend = stats(todayStr()).pending;
    const log = load(K.pomo, { log: [] }).log.filter((x) => x.d === todayStr());
    openSheet(`<div class="pomo">
      <h3>${pomo.mode === "short" || pomo.mode === "long" ? "☕ Break time" : "🍅 Focus timer"}</h3>
      <div class="pills modes">${POMO_MODES.map(([k, l, m]) => `<button data-pm="${k}" data-min="${m}" class="${pomo.mode === k ? "on" : ""}">${l} · ${m}</button>`).join("")}</div>
      <svg viewBox="0 0 240 240"><defs><linearGradient id="pg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#ff5d55"/><stop offset=".5" stop-color="#ffd166"/><stop offset="1" stop-color="#06d6a0"/></linearGradient></defs>
        <circle class="ring-bg" cx="120" cy="120" r="104" fill="none" stroke-width="16"/>
        <circle class="ring" id="pRing" cx="120" cy="120" r="104" fill="none" stroke="url(#pg)" stroke-width="16" stroke-linecap="round" transform="rotate(-90 120 120)" stroke-dasharray="${C2}" stroke-dashoffset="${off}"/>
        <text class="time" id="pTime" x="120" y="128" text-anchor="middle">${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}</text>
        <text class="lbl2" x="120" y="160" text-anchor="middle">${pomo.running ? (pomo.notes ? `${pomo.notes} note${pomo.notes > 1 ? "s" : ""} closed` : "go go go!") : pend ? `${pend} note${pend > 1 ? "s" : ""} waiting today` : "no notes waiting 🎉"}</text></svg>
      <div class="row" style="justify-content:center;margin:8px 0">
        <button class="btn sm" data-adj="-5">−5</button>
        <button class="btn primary" id="pGo" style="min-width:120px">${pomo.running ? "Pause" : left < total ? "Resume" : "Start"}</button>
        <button class="btn sm" data-adj="5">+5</button>
        <button class="btn sm" id="pReset">Reset</button></div>
      <div class="tomatoes">${"🍅".repeat(log.filter((x) => x.mode !== "short" && x.mode !== "long").length) || "<span class='muted' style='font-size:13px'>Finished sessions today show up here</span>"}</div>
      </div>`);
    const sh = $("#sheet");
    $$("[data-pm]", sh).forEach((b) => b.onclick = () => { pomo = { ...pomo, mode: b.dataset.pm, minutes: Number(b.dataset.min), remaining: Number(b.dataset.min) * 60, running: false, notes: 0 }; pomoSave(); draw(); pomoUi(); });
    $$("[data-adj]", sh).forEach((b) => b.onclick = () => { const d = Number(b.dataset.adj); pomo.minutes = Math.max(1, pomo.minutes + d); if (pomo.running) pomo.endsAt += d * 60000; else pomo.remaining = Math.max(60, pomo.remaining + d * 60); pomoSave(); draw(); });
    $("#pGo", sh).onclick = () => {
      if (pomo.running) { pomo.remaining = pomoLeft(); pomo.running = false; }
      else { pomo.endsAt = Date.now() + pomoLeft() * 1000; pomo.running = true; buzz(20); ensureAudio(); }
      pomoSave(); draw(); pomoUi();
    };
    $("#pReset", sh).onclick = () => { pomo.running = false; pomo.remaining = pomo.minutes * 60; pomo.notes = 0; pomoSave(); draw(); pomoUi(); };
  };
  draw();
  clearInterval(pomoTimer);
  pomoTimer = setInterval(() => {
    if ($("#sheet").hidden || !$("#pTime")) { clearInterval(pomoTimer); return; }
    const left = pomoLeft(), total = pomo.minutes * 60, C2 = 2 * Math.PI * 104;
    $("#pTime").textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`;
    $("#pRing").setAttribute("stroke-dashoffset", C2 * (1 - left / total));
  }, 500);
}
let audioCtx;
function ensureAudio() { try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch { /* no audio */ } }
function chime() {
  try {
    ensureAudio();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = "triangle"; o.frequency.value = f; o.connect(g); g.connect(audioCtx.destination);
      const t = audioCtx.currentTime + i * 0.14;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.start(t); o.stop(t + 0.55);
    });
  } catch { /* no audio */ }
}
function pomoUi() {
  const pill = $("#pomoPill"), fab = $("#pomoFab");
  if (pomo.running) {
    const left = pomoLeft();
    pill.hidden = false; pill.textContent = `🍅 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
    fab.classList.add("running");
    if (left <= 0) pomoFinish();
  } else { pill.hidden = true; fab.classList.remove("running"); }
}
function pomoFinish() {
  const log = load(K.pomo, { log: [] });
  log.log.push({ d: todayStr(), mode: pomo.mode, min: pomo.minutes, notes: pomo.notes, at: Date.now() });
  save(K.pomo, log);
  const focus = pomo.mode === "focus" || pomo.mode === "sprint";
  const notes = pomo.notes;
  pomo = { ...pomo, running: false, remaining: pomo.minutes * 60, notes: 0 };
  pomoSave(); pomoUi(); chime(); buzz([200, 100, 200, 100, 400]);
  FX.celebrate(focus ? "confettiCannons" : "bubbles");
  toast(focus ? `🍅 Session done${notes ? ` — ${notes} note${notes > 1 ? "s" : ""} closed!` : "!"} Take a break.` : "Break's over — back to it 💪", 5000);
  try { if (document.hidden && Notification.permission === "granted") new Notification("RVU Tracker", { body: focus ? "Focus session done!" : "Break's over" }); } catch { /* no notifications */ }
  if (!$("#sheet").hidden && $("#pTime")) openPomo();
}
setInterval(pomoUi, 1000);

/* ================================================================ events */
document.addEventListener("click", (e) => {
  const t = e.target;
  const goEl = t.closest("[data-go]"); if (goEl) { go(goEl.dataset.go); return; }
  const navEl = t.closest("[data-nav]"); if (navEl) { nav(navEl.dataset.nav); return; }
  const vEl = t.closest("[data-view]"); if (vEl && vEl.closest("#viewSeg")) { ui.view = vEl.dataset.view; persistUi(); render(); return; }
  if (t.closest("#scrim")) { closeSheet(); return; }
  if (t.closest("#pomoFab") || t.closest("#pomoPill")) { openPomo(); return; }
  const ext = t.closest("[data-extend]"); if (ext) { extendRange(Number(ext.dataset.extend)); return; }
  if (t.closest("[data-daymenu]")) { openDayMenu(ui.date); return; }
  if (t.closest(".count-pop")) return;
  const cnt = t.closest("[data-count]"); if (cnt) { openCountPop(cnt.dataset.count); return; }
  if ($(".count-pop")) closeCountPop();
  const gd = t.closest("#main [data-goday]"); if (gd && ui.page === "calendar" && !t.closest(".tl-inner")) { ui.date = gd.dataset.goday; ui.view = "day"; persistUi(); render(); return; }
  const gm = t.closest("[data-gomonth]"); if (gm) { ui.date = gm.dataset.gomonth; ui.view = "month"; persistUi(); render(); return; }
  const hf = t.closest("[data-histfill]"); if (hf) { const d = hf.dataset.histfill; openPatientSheet(d, { id: uid(d), type: "FU", start: 720, dur: 0, status: "scheduled", histFill: true }, hf); return; }
  const ha = t.closest("[data-histadd]"); if (ha) { const d = ha.dataset.histadd; openPatientSheet(d, { id: uid(d), type: "FU", start: 720, dur: 45, status: "scheduled" }, ha); return; }
  const sl = t.closest("#main [data-slot]"); if (sl && sl.dataset.slot) { openSlotSheet(sl.dataset.date, sl.dataset.slot); return; }
  const lg = t.closest("[data-log]"); if (lg) { openLogSheet(lg.dataset.log, ui.page === "hours" && C.weekStart(ui.date) !== C.weekStart(todayStr()) ? C.addDays(C.weekStart(ui.date), 1) : todayStr()); return; }
  if (t.closest("#copyEmail")) { navigator.clipboard?.writeText(C.weekSummaryText(state, ui.date)).then(() => toast("Copied")); return; }
  if (t.closest("#sendNow")) { sendEmailNow(); return; }
  const rg = t.closest("[data-rgroup]"); if (rg) { rep.group = rg.dataset.rgroup; if ((rep.group === "day" || rep.group === "week") && rep.year === "all") rep.year = String(new Date().getFullYear()); render(); return; }
  if (ui.page === "settings" && bindSettings(e)) return;
});
// Safari can still zoom on a fast double tap; block it everywhere except text fields
document.addEventListener("dblclick", (e) => { if (!/input|textarea|select/i.test(e.target.tagName)) e.preventDefault(); }, { passive: false });
document.addEventListener("gesturestart", (e) => { if (e.target.closest?.(".tl-scroll")) e.preventDefault(); }, { passive: false });
let lastTouchEnd = 0, tapStart = null;
document.addEventListener("touchstart", (e) => { const t = e.touches[0]; tapStart = e.touches.length === 1 ? [t.clientX, t.clientY] : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  const ct = e.changedTouches[0];
  const moved = !tapStart || !ct || Math.hypot(ct.clientX - tapStart[0], ct.clientY - tapStart[1]) > 10;
  if (e.touches.length || pinchState || now - pinchEndedAt < 400 || moved) { lastTouchEnd = 0; return; }
  if (now - lastTouchEnd < 350 && e.target.closest("button, .mcell, .ycard, [data-goday], [data-nav]")) { e.preventDefault(); e.target.closest("button, .mcell, .ycard, [data-goday], [data-nav]").click(); }
  lastTouchEnd = now;
}, { passive: false });
document.addEventListener("change", (e) => {
  if (e.target.id === "rYear") { rep.year = e.target.value; render(); return; }
  if (ui.page === "settings") onSettingsChange(e);
});
// hold a counter to subtract one
/* iPhone home-screen apps report a viewport that's short by the status-bar height, leaving a strip at the bottom.
   Measure the shortfall and let the layout reach the real bottom of the screen. */
function fixIosGap() {
  let gap = 0;
  if (navigator.standalone === true) {
    const landscape = matchMedia("(orientation: landscape)").matches;
    const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
    gap = Math.round(full - innerHeight);
    if (gap < 0 || gap > 120) gap = 0;
  }
  document.documentElement.style.setProperty("--gapfix", `${gap}px`);
}
fixIosGap();
addEventListener("resize", fixIosGap);
addEventListener("orientationchange", () => setTimeout(fixIosGap, 300));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if ($("#sheet").hidden && ui.page === "calendar" && (ui.view === "day" || ui.view === "week") && !/input|select|textarea/i.test(e.target.tagName) && ["+", "=", "-", "_", "0"].includes(e.key)) {
    const sc = $(".tl-scroll"); if (!sc) return;
    const r = sc.getBoundingClientRect(), cy = r.top + r.height / 2;
    const z = e.key === "0" ? 1 : zoomFor(ui.view) * (e.key === "-" || e.key === "_" ? 0.8 : 1.25);
    zoomTimelineTo(z, cy); commitZoom(); return;
  }
  if ($("#sheet").hidden && !/input|select|textarea/i.test(e.target.tagName) && ui.page === "calendar") {
    if (e.key === "ArrowLeft") nav(-1); else if (e.key === "ArrowRight") nav(1); else if (e.key === "t") nav("today");
    else if ("dwmy".includes(e.key)) { ui.view = { d: "day", w: "week", m: "month", y: "year" }[e.key]; persistUi(); render(); }
  }
});
// swipe left/right on month & year to change period
/* Swipe left/right on the calendar: next/previous day (week, month or year in those views).
   The page follows your finger, then slides out while the new one slides in. */
document.addEventListener("touchstart", (e) => {
  swipe.active = false; swipe.axis = null;
  if (e.touches.length !== 1 || ui.page !== "calendar" || !$("#sheet").hidden || drag.active || pinchState) return;
  if (!e.target.closest("#main") || e.target.closest("input, select, textarea")) return;
  const t = e.touches[0];
  Object.assign(swipe, { active: true, axis: null, x0: t.clientX, y0: t.clientY, t0: performance.now(), dx: 0, samples: [], el: $("#main").firstElementChild });
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!swipe.active) return;
  if (e.touches.length > 1 || pinchState || drag.active) { snapSwipeBack(); return; }
  const t = e.touches[0], dx = t.clientX - swipe.x0, dy = t.clientY - swipe.y0;
  if (!swipe.axis) {
    if (Math.hypot(dx, dy) < 10) return;
    swipe.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    if (swipe.axis === "y") { swipe.active = false; return; }
  }
  if (e.cancelable) e.preventDefault();
  swipe.dx = dx;
  const now = performance.now();
  swipe.samples.push([now, dx]); while (swipe.samples.length > 2 && now - swipe.samples[0][0] > 100) swipe.samples.shift();
  if (swipe.el) { swipe.el.style.transition = "none"; swipe.el.style.transform = `translateX(${dx}px)`; swipe.el.style.opacity = String(1 - Math.min(0.45, Math.abs(dx) / innerWidth)); }
}, { passive: false });
function snapSwipeBack() {
  const el = swipe.el;
  swipe.active = false; swipe.axis = null;
  if (!el) return;
  el.style.transition = "transform .25s cubic-bezier(.2,1.2,.4,1), opacity .2s";
  el.style.transform = ""; el.style.opacity = "";
}
const swipeEnd = () => {
  if (!swipe.active || swipe.axis !== "x") { swipe.active = false; swipe.axis = null; return; }
  const dx = swipe.dx, s0 = swipe.samples[0], s1 = swipe.samples[swipe.samples.length - 1];
  const v = s0 && s1 ? (s1[1] - s0[1]) / Math.max(1, s1[0] - s0[0]) : 0;
  if (!(Math.abs(dx) > 80 || (Math.abs(v) > 0.4 && Math.abs(dx) > 30))) { snapSwipeBack(); return; }
  const dir = dx < 0 ? 1 : -1, el = swipe.el, W = innerWidth;
  swipe.active = false; swipe.axis = null;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const go = () => {
    nav(dir); buzz(8);
    const nel = $("#main").firstElementChild;
    if (!nel || reduce) return;
    nel.style.transition = "none"; nel.style.transform = `translateX(${dir * W * 0.35}px)`; nel.style.opacity = "0";
    void nel.offsetWidth;
    nel.style.transition = "transform .22s cubic-bezier(.2,.9,.3,1), opacity .18s";
    nel.style.transform = ""; nel.style.opacity = "";
  };
  if (!el || reduce) { go(); return; }
  el.style.transition = "transform .14s ease-in, opacity .14s";
  el.style.transform = `translateX(${-dir * W}px)`; el.style.opacity = "0";
  setTimeout(go, 130);
};
document.addEventListener("touchend", swipeEnd);
document.addEventListener("touchcancel", () => snapSwipeBack());

document.addEventListener("visibilitychange", () => { if (!document.hidden) { syncNow(); tick(); if (todayStr() !== lastDay) { lastDay = todayStr(); freezePast(); ui.date = lastDay; render(); } } });
addEventListener("online", () => syncNow());
setInterval(() => { if (!document.hidden) syncNow(); }, 90000);
let resizeT; addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (ui.page === "calendar") render(); }, 200); });

/* ================================================================ boot */
freezePast(); persist();
render();
pomoUi();
syncNow();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.__rvu = { state: () => state, hist: () => hist, C, FX }; // handy for debugging
