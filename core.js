// core.js — shared schedule, billing, merge and summary logic.
// Used by the web app AND by the weekly-email job in the private data repo,
// so both always agree on what a day's schedule looks like.

export const VERSION = 1;

/* ------------------------------------------------------------------ dates */
export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
export const weekday = (s) => parseYmd(s).getDay(); // 0 = Sunday
export const nthOfMonth = (s) => Math.floor((parseYmd(s).getDate() - 1) / 7) + 1;
export const weekStart = (s) => addDays(s, -weekday(s)); // Sunday-based week
export const yearOf = (s) => Number(s.slice(0, 4));
export const monthOf = (s) => Number(s.slice(5, 7));
export const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

export function fmtTime(min, { compact = false } = {}) {
  const h = Math.floor(min / 60), m = min % 60;
  const ap = h >= 12 ? "pm" : "am";
  const h12 = ((h + 11) % 12) + 1;
  if (compact && m === 0) return `${h12}${ap}`;
  return `${h12}:${pad(m)}${ap}`;
}
export function fmtDuration(min) {
  if (min < 60) return `${min} minutes`;
  const h = min / 60;
  const txt = Number.isInteger(h) ? String(h) : String(Math.round(h * 100) / 100);
  return `${txt} hour${h === 1 ? "" : "s"}`;
}
export function fmtUsDate(s) { const [y, m, d] = s.split("-"); return `${m}/${d}/${y}`; }

/* ---------------------------------------------------------- slot types */
export const TYPES = {
  NP:  { label: "New Patient",   short: "NP",  dur: 90, patient: true },
  FU:  { label: "Follow-up",     short: "F/U", dur: 45, patient: true },
  TH:  { label: "Therapy",       short: "Tx",  dur: 45, patient: true },
  MTG: { label: "Meeting",       short: "Mtg", dur: 60, patient: false },
  MD:  { label: "Medical Director",            short: "MD",  dur: 60, patient: false, role: "MD" },
  APD: { label: "Associate Program Director",  short: "APD", dur: 60, patient: false, role: "APD" },
  BLK: { label: "Blocked / admin",             short: "Blk", dur: 60, patient: false },
};
export const ROLE_NAMES = { MD: "Medical Director", APD: "Associate Program Director" };
export const isPatient = (s) => !!TYPES[s.type]?.patient;
export const roleOf = (s) => s.role || TYPES[s.type]?.role || null;

/* ------------------------------------------------- defaults & templates */
// minutes after midnight
const T = (h, m = 0) => h * 60 + m;
export const DEFAULT_TEMPLATE = {
  0: [],
  1: [[T(8), "FU"], [T(8, 45), "FU"], [T(9, 30), "NP"], [T(11), "FU"], [T(12, 45), "FU"], [T(13, 30), "FU"], [T(14, 15), "FU"], [T(15), "FU"], [T(15, 45), "FU"]],
  2: [[T(8), "FU"], [T(8, 45), "FU"], [T(9, 30), "FU"], [T(10, 15), "FU"], [T(11), "FU"], [T(13, 15), "FU"], [T(14), "FU"], [T(14, 45), "FU"], [T(15, 30), "FU"]],
  3: [[T(8), "FU"], [T(8, 45), "FU"], [T(9, 30), "FU"], [T(10, 15), "FU"], [T(11), "FU"], [T(12, 45), "NP"], [T(14, 15), "FU"], [T(15), "FU"], [T(15, 45), "FU"]],
  4: [[T(8), "FU"], [T(8, 45), "FU"], [T(9, 30), "NP"], [T(11), "FU"], [T(13), "FU"], [T(13, 45), "FU"], [T(14, 30), "FU"], [T(15, 15), "FU"]],
  5: [[T(8), "FU"], [T(8, 45), "FU"], [T(9, 30), "FU"], [T(10, 15), "FU"], [T(11), "FU"]],
  6: [],
};

// weekday: 0=Sun … 6=Sat; nths: which occurrence(s) in the month
export const DEFAULT_MEETINGS = [
  { id: "uvc",   title: "UVC Psych Prescriber Meeting",          weekday: 2, nths: [1],    start: T(12),     end: T(13), role: "MD", clearsTemplate: false },
  { id: "staff", title: "Psych Staff Meeting",                   weekday: 2, nths: [2],    start: T(13),     end: T(14), role: "MD", clearsTemplate: true },
  { id: "obhs",  title: "Outpatient Behavioral Health Services", weekday: 4, nths: [2, 4], start: T(12, 30), end: T(13), role: "MD", clearsTemplate: false },
  { id: "case",  title: "Psych Prescriber Case Review",          weekday: 2, nths: [3],    start: T(12),     end: T(13), role: "MD", clearsTemplate: false },
  { id: "bhmd",  title: "Outpatient BH Clinic Medical Directors", weekday: 3, nths: [3],   start: T(12, 30), end: T(13), role: "MD", clearsTemplate: false },
];

// wRVU tables from the spreadsheet. A table applies from its year onward
// until a newer table starts. null = no RVU value on record.
export const DEFAULT_RVU = {
  2020: {
    "90792": 3.25, "99205": 3.17, "99354": 2.33,
    "99212": 0.48, "99213": 0.97, "99214": 1.5, "99215": 2.11,
    "90833": 1.5, "90836": 1.9, "90838": 2.5, "90785": null,
    "99221": 1.92, "99222": 2.61, "99223": 3.86, "99231": 0.76, "99232": 1.39, "99233": 2,
    "99238": 1.28, "99239": 1.9, "99356": 1.71, "99441": null, "99442": null, "99443": null,
  },
  2022: {
    "90792": 4.16, "99205": 3.5, "99354": 2.33,
    "99212": 0.7, "99213": 1.3, "99214": 1.92, "99215": 2.8,
    "90833": 1.5, "90836": 1.9, "90838": 2.5, "90785": 0.33,
    "90834": 2.24, "90837": null, "90832": null, "90846": 2.51, "90847": null,
    "G2211": 0.33,
    "99221": 1.92, "99222": 2.61, "99223": 3.86, "99231": 0.76, "99232": 1.39, "99233": 2,
    "99235": null, "99236": 6.18, "99238": 1.28, "99239": 1.9, "99356": 1.71,
  },
};
export const DEFAULT_DOLLARS = { 2025: 82.6, 2026: 86.73 };

// The codes shown by default for each visit type. Any other CPT code can be added
// from "Other code…" and is then remembered in settings.extraCodes.
export const CODE_PICKS = { NP: ["90792"], FU: ["99214", "99215"], TH: ["90834"] };
export const CODE_HINTS = {
  "90792": "Psych diagnostic eval w/ medical", "99205": "New pt, high MDM",
  "99212": "Est pt, straightforward", "99213": "Est pt, low MDM", "99214": "Est pt, moderate MDM", "99215": "Est pt, high MDM",
  "90832": "Psychotherapy 16–37 min", "90834": "Psychotherapy 38–52 min", "90837": "Psychotherapy 53+ min",
  "90833": "Add-on therapy 16–37", "90836": "Add-on therapy 38–52", "90838": "Add-on therapy 53+",
  "90785": "Interactive complexity", "G2211": "Visit complexity add-on", "90846": "Family tx w/o patient", "90847": "Family tx w/ patient",
};

export function defaultSettings(startDate) {
  return {
    theme: "blue-mountain",
    startDate,                       // template-generated days begin here
    template: structuredClone(DEFAULT_TEMPLATE),
    meetings: structuredClone(DEFAULT_MEETINGS),
    rvu: structuredClone(DEFAULT_RVU),
    dollars: structuredClone(DEFAULT_DOLLARS),
    email: "shawn@spencerfam.com",
    extraCodes: [],                  // codes you've chosen to keep visible in the picker
    dayStart: T(8), dayEnd: T(17),
    updatedAt: 0,
  };
}

export function emptyState(startDate) {
  return { version: VERSION, settings: defaultSettings(startDate), days: {}, counters: {} };
}

/* ------------------------------------------------------------ RVU math */
export function rvuTable(settings, year) {
  const years = Object.keys(settings.rvu).map(Number).sort((a, b) => a - b);
  let pick = years[0];
  for (const y of years) if (y <= year) pick = y;
  return settings.rvu[pick] || {};
}
export function codeRvu(settings, year, code) {
  const v = rvuTable(settings, year)[code];
  return typeof v === "number" ? v : 0;
}
export function slotRvu(settings, date, slot) {
  if (slot.status !== "billed") return 0;
  return (slot.codes || []).reduce((t, c) => t + codeRvu(settings, yearOf(date), c), 0);
}
export const dollarRate = (settings, year) => settings.dollars?.[year] ?? null;

/* ------------------------------------------------- schedule generation */
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

export function generateDay(date, settings) {
  if (!settings.startDate || date < settings.startDate) return [];
  const wd = weekday(date), nth = nthOfMonth(date);
  const meetings = (settings.meetings || []).filter((m) => m.weekday === wd && (m.nths || []).includes(nth) && !m.disabled);
  const slots = [];
  (settings.template?.[wd] || []).forEach(([start, type], i) => {
    const end = start + TYPES[type].dur;
    if (meetings.some((m) => m.clearsTemplate && overlaps(start, end, m.start, m.end))) return;
    slots.push({ id: `${date}~t${i}`, start, dur: TYPES[type].dur, type, status: "scheduled", gen: true });
  });
  for (const m of meetings) {
    slots.push({ id: `${date}~m~${m.id}`, start: m.start, dur: m.end - m.start, type: "MTG", role: m.role, title: m.title, status: "scheduled", gen: true });
  }
  return slots;
}

// Resolve the full list of slots for a date: generated slots overlaid with stored edits.
export function resolveDay(state, date) {
  const day = state.days[date];
  const out = new Map();
  if (!day?.frozen) for (const s of generateDay(date, state.settings)) out.set(s.id, s);
  for (const [id, s] of Object.entries(day?.slots || {})) {
    if (s.deleted) out.delete(id);
    else out.set(id, { ...(out.get(id) || {}), ...s, id });
  }
  return [...out.values()].sort((a, b) => a.start - b.start || (isPatient(b) - isPatient(a)));
}
export const isDayOff = (state, date) => !!state.days[date]?.off;

/* ---------------------------------------------------------- day stats */
// Live (app-tracked) day statistics.
export function liveDayStats(state, date, nowMs = Date.now()) {
  const slots = isDayOff(state, date) ? [] : resolveDay(state, date);
  const pts = slots.filter(isPatient);
  // seen     = visits that have started (or were billed)
  // expected = every visit on the day that wasn't canceled / no-show (today's "x of y" denominator)
  // upcoming = visits that haven't started yet
  const st = { date, source: "live", seen: 0, expected: 0, upcoming: 0, billed: 0, pending: 0, overdue: 0, canceled: 0, noshow: 0, rvu: 0, codes: {}, off: isDayOff(state, date) };
  const dayStart = parseYmd(date); dayStart.setHours(0, 0, 0, 0);
  const t0 = dayStart.getTime();
  for (const s of pts) {
    if (s.status === "canceled") { st.canceled++; continue; }
    if (s.status === "noshow") { st.noshow++; continue; }
    st.expected++;
    if (s.status === "billed") {
      st.seen++; st.billed++;
      st.rvu += slotRvu(state.settings, date, s);
      for (const c of s.codes || []) st.codes[c] = (st.codes[c] || 0) + 1;
    } else if (t0 + s.start * 60000 <= nowMs) {
      st.seen++; st.pending++;
      if (t0 + (s.start + s.dur) * 60000 <= nowMs) st.overdue++;
    } else st.upcoming++;
  }
  st.working = st.seen > 0;
  return st;
}

// Imported spreadsheet days: { p: patients, c: {code: n}, ns: no-shows, off: true, pb: patients billed }
export function historyDayStats(state, hist, date) {
  const h = hist?.[date];
  if (!h) return null;
  const st = { date, source: "history", seen: 0, billed: 0, pending: 0, overdue: 0, canceled: null, noshow: h.ns ?? null, rvu: 0, codes: {}, off: !!h.off };
  if (h.off) { st.working = false; return st; }
  st.seen = h.p || 0;
  for (const [c, n] of Object.entries(h.c || {})) {
    st.codes[c] = n;
    st.rvu += n * codeRvu(state.settings, yearOf(date), c);
  }
  st.billed = h.pb ?? st.seen;
  // Notes finished in the app for days that were imported as "seen but not billed",
  // or visits added by hand to an imported day.
  for (const s of Object.values(state.days[date]?.slots || {})) {
    if (s.deleted || !isPatient(s)) continue;
    if (!s.histFill) st.seen++;
    if (s.status === "billed") {
      st.billed++;
      st.rvu += slotRvu(state.settings, date, s);
      for (const c of s.codes || []) st.codes[c] = (st.codes[c] || 0) + 1;
    }
  }
  st.pending = Math.max(0, st.seen - st.billed);
  st.overdue = st.pending;
  st.expected = st.seen;
  st.working = st.seen > 0;
  return st;
}

export function dayStats(state, hist, date, nowMs) {
  if (date < state.settings.startDate) return historyDayStats(state, hist, date) || { date, source: "none", seen: 0, expected: 0, billed: 0, pending: 0, overdue: 0, canceled: 0, noshow: 0, rvu: 0, codes: {}, working: false };
  return liveDayStats(state, date, nowMs);
}

/* ------------------------------------------------------------- merging */
// Last-write-wins per slot, per day flag and per settings object. Deterministic ids
// for template/meeting slots mean two devices editing the same day merge cleanly.
export function mergeStates(a, b) {
  if (!a) return structuredClone(b);
  if (!b) return structuredClone(a);
  const out = { version: VERSION, settings: (b.settings?.updatedAt || 0) > (a.settings?.updatedAt || 0) ? b.settings : a.settings, days: {}, counters: {} };
  const dates = new Set([...Object.keys(a.days || {}), ...Object.keys(b.days || {})]);
  for (const d of dates) {
    const x = a.days?.[d] || {}, y = b.days?.[d] || {};
    const day = { slots: {} };
    const offSrc = (y.offAt || 0) > (x.offAt || 0) ? y : x;
    if (offSrc.offAt) { day.off = !!offSrc.off; day.offAt = offSrc.offAt; if (offSrc.offLabel) day.offLabel = offSrc.offLabel; }
    if (x.frozen || y.frozen) day.frozen = true;
    const ids = new Set([...Object.keys(x.slots || {}), ...Object.keys(y.slots || {})]);
    for (const id of ids) {
      const s1 = x.slots?.[id], s2 = y.slots?.[id];
      day.slots[id] = !s1 ? s2 : !s2 ? s1 : (s2.updatedAt || 0) > (s1.updatedAt || 0) ? s2 : s1;
    }
    out.days[d] = day;
  }
  const cdates = new Set([...Object.keys(a.counters || {}), ...Object.keys(b.counters || {})]);
  for (const d of cdates) {
    const x = a.counters?.[d], y = b.counters?.[d];
    out.counters[d] = !x ? y : !y ? x : (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x;
  }
  return out;
}

/* ------------------------------------------------- weekly role summary */
// Returns { MD: [{date, start, dur, text}], APD: [...] } for Sun..Sat of the week containing `date`.
export function weekRoleEntries(state, anyDateInWeek) {
  const start = weekStart(anyDateInWeek);
  const out = { MD: [], APD: [] };
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    if (isDayOff(state, d)) continue;
    for (const s of resolveDay(state, d)) {
      const role = roleOf(s);
      if (!role || !out[role] || s.status === "canceled") continue;
      out[role].push({ date: d, start: s.start, dur: s.dur, text: (s.comment || s.title || "").trim() });
    }
  }
  for (const r of Object.keys(out)) out[r].sort((p, q) => p.date.localeCompare(q.date) || p.start - q.start);
  return out;
}

export function weekSummaryText(state, anyDateInWeek) {
  const e = weekRoleEntries(state, anyDateInWeek);
  const ws = weekStart(anyDateInWeek);
  const lines = [`MD / APD hours for the week of ${fmtUsDate(addDays(ws, 1))}`, ""];
  for (const role of ["MD", "APD"]) {
    const items = e[role];
    const total = items.reduce((t, x) => t + x.dur, 0);
    lines.push(ROLE_NAMES[role]);
    if (!items.length) lines.push("No hours logged this week");
    for (const x of items) {
      const text = x.text ? ` - ${x.text}` : "";
      lines.push(`${DAY_NAMES[weekday(x.date)]} ${fmtUsDate(x.date)} @ ${fmtTime(x.start)} for ${fmtDuration(x.dur)}${text}`);
    }
    lines.push(`Total: ${fmtDuration(total)}`, "");
  }
  return lines.join("\n").trim() + "\n";
}
