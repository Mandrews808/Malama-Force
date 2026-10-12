import CONFIG from "./firebase-config.js";
import {
  r2, attainment, points, tierRate, evalDeal, dealParts, summarize,
  encodeSetup, decodeSetup, parseMoney, tiForQuota, fastStart,
} from "./engine.js";

const LS_KEY = "payout-state-v1";
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => { n = Number(n) || 0; const v = Math.round(Math.abs(n)); return (n < 0 && v ? "−" : "") + "$" + v.toLocaleString("en-US"); };
const pct = (n) => (Number(n) || 0).toFixed(2) + "%";
const plus = (n) => ((Number(n) || 0) < 0 ? "−" : "+") + Math.abs(Number(n) || 0).toFixed(2) + "%";
const inputMoney = (n) => (Number(n) ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");
const uid = () => "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------------------------------------------------------------- state
let state = loadLocal();
const ui = { tab: "payout", draft: null, user: null, syncReady: false, sync: null, syncStatus: null, armed: null, busy: false };

function loadLocal() {
  try { const raw = localStorage.getItem(LS_KEY); if (raw) { const s = JSON.parse(raw); if (s && s.plan) return s; } } catch {}
  return null;
}
function saveLocal() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch {} }

/** Change state, save it here and to the cloud, redraw. */
function commit(mutate, opts = {}) {
  mutate(state);
  state.updatedAt = Date.now();
  saveLocal();
  if (ui.sync && ui.user) ui.sync.push(state);
  if (!opts.quiet) render();
}

// ---------------------------------------------------------------- labels (from the plan, with generic fallbacks)
function L() {
  const p = (state && state.plan) || {};
  const l = p.labels || {};
  return {
    target: l.target || "target incentive",
    band: l.band || "Quota band",
    bonus: (p.bonus && p.bonus.label) || "New-logo bonus",
    newLogo: l.newLogo || "New logo",
    split: (p.split && p.split.label) || "Split deal",
    startPay: (p.split && p.split.startLabel) || "Paid at start",
    rc: l.rc || "roll call",
    bonusSales: l.bonusSales || "bonus-eligible sales",
  };
}
const fmtRate = (x) => `${r2(x * 100)}%`;
const fmtX = (x) => `${(Number(x) || 0).toFixed(1)}x`;

// ---------------------------------------------------------------- months
function fiscalMonths() {
  const start = (state && state.plan && state.plan.fiscalStart) || `${new Date().getFullYear()}-01`;
  let [y, m] = start.split("-").map(Number);
  const out = [];
  for (let i = 0; i < 12; i++) {
    const ym = `${y}-${String(m).padStart(2, "0")}`;
    out.push([ym, new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" })]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function defaultMonth() {
  const d = new Date(), ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const ms = fiscalMonths();
  return ms.some(([v]) => v === ym) ? ym : ms[0][0];
}
const monthLabel = (ym) => { const f = fiscalMonths().find(([v]) => v === ym); return f ? f[1] : (ym || "No month"); };

// ---------------------------------------------------------------- render: shell
function render() {
  const main = $("#main");
  document.body.classList.toggle("welcome-mode", !state);
  renderHeader();
  if (!state) { main.innerHTML = renderWelcome(); return; }
  main.innerHTML = ui.tab === "numbers" ? renderNumbers() : renderPayout();
  document.querySelectorAll(".tabbar [data-tab]").forEach((b) => b.setAttribute("aria-current", String(b.dataset.tab === ui.tab)));
}

function renderHeader() {
  const asOf = state && state.numbers && state.numbers.asOf;
  $("#asof").textContent = state ? (asOf ? `Numbers as of ${asOf}` : (state.plan.name || "")) : "";
  const dot = $("#syncdot");
  if (!CONFIG || !state) { dot.hidden = true; return; }
  dot.hidden = false;
  const ok = ui.user && ui.syncStatus && ui.syncStatus.ok;
  dot.className = "syncdot " + (ok ? "on" : ui.user ? "warn" : "off");
  dot.title = ok ? "Synced" : ui.user ? "Not synced yet" : "Sync is off: sign in on the Numbers tab";
  dot.textContent = ok ? "Synced" : ui.user ? "Syncing…" : "Not synced";
}

// ---------------------------------------------------------------- render: welcome
function renderWelcome() {
  const signIn = CONFIG ? (ui.user
    ? `<p class="note">Signed in as <b>${esc(ui.user.email)}</b>. Nothing is saved to your account yet, so load your plan below and it will sync to your other devices.</p>`
    : `<section class="card">
        <h2>Already set up on another device?</h2>
        <p class="note">Sign in and your plan, numbers and deals load from your account.</p>
        ${authForm()}
      </section>`) : "";
  return `<div class="welcome">
    <div class="wl-mark" aria-hidden="true">${markSvg()}</div>
    <h1>Payout</h1>
    <p class="lede">See what every deal pays before it reaches your check.</p>
    ${signIn}
    <section class="card">
      <h2>Load your plan</h2>
      <p class="note">Paste the setup code Claude gave you. It holds your plan's rates and your current numbers, and it only lives on your devices${CONFIG ? " and in your own account" : ""}.</p>
      <label class="sr" for="setupCode">Setup code</label>
      <textarea id="setupCode" rows="5" placeholder="PAYOUT1.…" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <p class="err" id="setupErr" role="alert"></p>
      <button class="btn primary wide" data-act="load-setup">Load plan</button>
    </section>
  </div>`;
}

function authForm() {
  return `<form class="auth" data-form="auth" novalidate>
    <label for="authEmail">Email</label>
    <input id="authEmail" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false">
    <label for="authPw">Password</label>
    <input id="authPw" type="password" autocomplete="current-password">
    <p class="err" id="authErr" role="alert"></p>
    <div class="row-btns">
      <button class="btn primary" type="submit" data-act="sign-in">Sign in</button>
      <button class="btn" type="button" data-act="sign-up">Create account</button>
    </div>
    <button class="linkbtn" type="button" data-act="reset-pw">Forgot password?</button>
  </form>`;
}

// ---------------------------------------------------------------- render: payout tab
function renderPayout() {
  const s = summarize(state), lb = L(), n = state.numbers;
  const hasDeals = s.closed.length || s.pipeline.length;
  const hero = `<section class="hero" aria-live="polite">
    <div class="label">Coming to you</div>
    <div class="big">${money(s.closedTotal)}</div>
    <p class="hero-sub">${s.closed.length ? `From ${s.closed.length} closed deal${s.closed.length === 1 ? "" : "s"} not yet in your ${esc(lb.rc)}` : "Add a closed deal to see what it pays"}</p>
    ${(s.owed && s.closedTotal) || s.pipeline.length ? `<dl class="hero-rows">
      ${s.owed && s.closedTotal ? `<div><dt>After repaying the ${money(s.owed)} you owe back</dt><dd>${money(s.afterOwed)}</dd></div>` : ""}
      ${s.pipeline.length ? `<div><dt>Pipeline if every deal closes</dt><dd>${money(s.pipelineAll)}</dd></div>` : ""}
    </dl>` : ""}
  </section>`;

  const closed = `<section class="block">
    <div class="sec-head"><h2>Closed, waiting to post</h2><button class="btn primary" data-act="add">Add deal</button></div>
    ${s.closed.length ? s.closed.map(({ d, e }) => dealCard(d, e)).join("")
      : `<p class="empty">${hasDeals ? "No closed deals right now." : "No deals yet. Tap Add deal and enter your roll call to see what it pays."}</p>`}
  </section>`;

  const pipe = s.pipeline.length ? `<section class="block">
    <div class="sec-head"><h2>Pipeline</h2></div>
    <div class="plist">${s.pipeline.map(({ d, e }) => `<button class="prow" data-act="edit" data-id="${esc(d.id)}">
        <span class="pn"><b>${esc(d.name || "Untitled deal")}</b><small>${esc(monthLabel(d.month))}${e.split ? " · " + esc(lb.split) : ""}${d.newLogo ? " · " + esc(lb.newLogo) : ""} · ${money(e.share)}</small></span>
        <span class="pa">If won<b>${money(e.total)}</b></span></button>`).join("")}</div>
    <p class="hint">Each figure is that deal on its own, on top of your closed deals.</p>
  </section>` : "";

  const posted = s.posted.length ? `<details class="block posted"><summary>Posted to your ${esc(lb.rc)} <span>${s.posted.length}</span></summary>
    ${s.posted.map((d) => `<div class="prow static"><span class="pn"><b>${esc(d.name || "Untitled deal")}</b><small>${esc(monthLabel(d.month))} · ${money(dealParts(d, state.plan).share)}</small></span>
      <span class="pbtns"><button class="btn small" data-act="unpost" data-id="${esc(d.id)}">Move back</button>
      <button class="btn small danger" data-act="delete" data-id="${esc(d.id)}">${ui.armed === "del:" + d.id ? "Tap again" : "Delete"}</button></span></div>`).join("")}
  </details>` : "";

  return hero + bandCard(s, n) + fastStartCard(s) + closed + pipe + posted;
}

function lineItems(e) {
  const lb = L(), ti = Number(state.numbers.ti) || 0, rows = [];
  if (e.atSign) rows.push([`${lb.band} lift`, `${pct(e.aBefore)} → ${pct(e.aAfter)} of quota${e.split ? ", at-sign part" : ""}`,
    (ti ? money(e.bandPay) + " · " : "") + plus(e.bandPct) + " " + esc(lb.target)]);
  if (e.bonus) {
    const b = state.plan.bonus || {};
    const rate = e.stepFrac === 0 ? fmtRate(b.rate) : e.stepFrac === 1 ? fmtRate(b.stepRate ?? b.rate) : `${fmtRate(b.rate)}–${fmtRate(b.stepRate ?? b.rate)}`;
    rows.push([`${lb.bonus} · ${rate}`, `On your full ${money(e.share)}`, money(e.bonus)]);
  }
  if (e.startPay) rows.push([`${lb.startPay} · ${fmtRate(state.plan.split.startRate)}`, `On the ${money(e.atStart)} at start, paid when the client starts`, money(e.startPay)]);
  e.extras.forEach((x) => rows.push([`${x.label} · ${fmtRate(x.rate)}`, `On ${money(x.amount)}`, money(x.pay)]));
  return rows.map(([t, sub, v]) => `<li><span>${esc(t)}<small>${esc(sub)}</small></span><b>${v}</b></li>`).join("");
}

function dealCard(d, e) {
  const lb = L();
  const parts = [`${money(e.share)} your ${esc(lb.rc)}`];
  if (e.split) parts.push(`${money(e.atSign)} at sign`, `${money(e.atStart)} at start`);
  return `<article class="deal">
    <div class="deal-head">
      <div class="dh"><h3>${esc(d.name || "Untitled deal")}</h3>
        <div class="chips"><span class="chip">${esc(monthLabel(d.month))}</span>${e.split ? `<span class="chip">${esc(lb.split)}</span>` : ""}${d.newLogo ? `<span class="chip accent">${esc(lb.newLogo)}</span>` : ""}</div></div>
      <button class="btn small" data-act="edit" data-id="${esc(d.id)}">Edit</button>
    </div>
    <p class="rcline">${parts.join(" · ")}</p>
    <ul class="lines">${lineItems(e)}</ul>
    <div class="deal-total"><span>Deal pays</span><b>${money(e.total)}</b></div>
    ${e.large ? `<p class="flag">Over the ${money(state.plan.largeDeal)} large deal threshold. Commission is advanced on the first ${money(state.plan.largeDeal)} and the rest pays when the client starts.</p>` : ""}
    <div class="deal-foot"><button class="btn small" data-act="post" data-id="${esc(d.id)}">It posted to my ${esc(lb.rc)}</button></div>
  </article>`;
}

function fastStartCard(s) {
  const f = fastStart(state, s); if (!f) return "";
  const head = `<div class="card-head"><h2>${esc(f.label)} · ${esc(f.period)}</h2><span class="muted">${money(f.amount)} at stake</span></div>`;
  if (!f.quota) return `<section class="card">${head}
    <p class="note">Add your ${esc(f.period)} sales quota on the Numbers tab (your YTD sales quota at the end of ${esc(f.endLabel)}) to track this bonus.</p></section>`;
  const w = Math.min(100, f.byEnd / f.quota * 100), wp = Math.min(100, f.withPipe / f.quota * 100);
  const msg = f.met
    ? `On track for ${money(f.amount)}: your closed deals get you to ${money(f.byEnd)} of ${money(f.quota)} by the end of ${esc(f.endLabel)}.`
    : `You need ${money(f.need)} more sales by the end of ${esc(f.endLabel)} to earn ${money(f.amount)}.`;
  const pipeMsg = !f.met && f.withPipe > f.byEnd
    ? (f.metWithPipe ? ` Pipeline deals set to post by then would cover it.` : ` Pipeline deals set to post by then would leave ${money(f.needWithPipe)} to go.`) : "";
  return `<section class="card">${head}
    <div class="meter" aria-hidden="true"><i class="pipe" style="width:${wp.toFixed(2)}%"></i><i style="width:${w.toFixed(2)}%"></i></div>
    <p class="fs-msg${f.met ? " ok" : ""}">${msg}${pipeMsg}</p>
    <p class="hint">${f.q1Earned ? `${esc(f.q1Label)} bonus of ${money(f.q1Amount)} earned.` : `${esc(f.q1Label)} bonus not earned.`} Change that on the Numbers tab.${f.note ? " " + esc(f.note) : ""}</p>
  </section>`;
}

function bandCard(s, n) {
  const lb = L(), q = Number(n.quota) || 0, ti = Number(n.ti) || 0, tiers = state.plan.tiers;
  if (!q) return `<section class="card"><h2>${esc(lb.band)}</h2><p class="empty">Add your annual quota on the Numbers tab.</p></section>`;
  const bounds = tiers.filter((t) => t.to != null).map((t) => t.to);
  const MAX = (bounds[bounds.length - 1] || 100) + 25;
  const pos = (a) => (Math.max(0, Math.min(MAX, a)) / MAX * 100).toFixed(3);
  let prev = 0;
  const segs = tiers.map((t, i) => {
    const top = t.to == null ? MAX : t.to, w = (top - prev) / MAX * 100, mid = (prev + top) / 2 / MAX * 100;
    prev = top;
    return { w, mid, rate: t.rate, cls: "t" + Math.min(i + 1, 4) };
  });
  const aNow = attainment(s.ytd, q), aClosed = attainment(s.cumClosed, q), aAll = attainment(s.cumAll, q);
  const pNow = points(aNow, tiers), pClosed = points(aClosed, tiers);
  const per10 = 10000 / q * 100 * tierRate(aClosed, tiers);
  const next = bounds.find((b) => aClosed < b);
  const nextRate = next != null ? tierRate(next, tiers) : null;
  const b = state.plan.bonus || {};
  const tiStr = (p) => pct(p) + (ti ? ` (${money(ti * p / 100)})` : "");
  return `<section class="card">
    <div class="card-head"><h2>${esc(lb.band)}</h2><span class="muted">of ${money(q)} annual quota</span></div>
    <div class="band" aria-hidden="true">
      ${segs.map((g) => `<i class="${g.cls}" style="width:${g.w.toFixed(3)}%"></i>`).join("")}
      <span class="mk" style="left:${pos(aNow)}%"></span>
      ${aClosed !== aNow ? `<span class="mk closed" style="left:${pos(aClosed)}%"></span>` : ""}
      ${aAll !== aClosed ? `<span class="mk pipe" style="left:${pos(aAll)}%"></span>` : ""}
    </div>
    <div class="ticks" aria-hidden="true"><span style="left:0">0%</span>${bounds.map((v) => `<span style="left:${(v / MAX * 100).toFixed(3)}%">${v}%</span>`).join("")}
      ${segs.map((g) => `<span class="x" style="left:${g.mid.toFixed(3)}%">${fmtX(g.rate)}</span>`).join("")}</div>
    <div class="legend"><span><i></i>Now <b>${pct(aNow)}</b></span>${aClosed !== aNow ? `<span><i class="closed"></i>With closed deals <b>${pct(aClosed)}</b></span>` : ""}${aAll !== aClosed ? `<span><i class="pipe"></i>If pipeline closes <b>${pct(aAll)}</b></span>` : ""}</div>
    <dl class="facts">
      <div><dt>${esc(lb.target)} earned</dt><dd>${aClosed !== aNow ? pct(pNow) + " → " : ""}${tiStr(pClosed)}</dd></div>
      <div><dt>Next $10K of ${esc(lb.rc)} adds</dt><dd>${pct(per10)} of ${esc(lb.target)}${ti ? " · " + money(ti * per10 / 100) : ""}</dd></div>
      ${next != null ? `<div><dt>${fmtX(nextRate)} starts at ${next}%</dt><dd>${money(next / 100 * q - s.cumClosed)} more</dd></div>` : `<div><dt>Rate</dt><dd>Top band</dd></div>`}
      ${b.rate && b.stepAt != null ? (() => { const base = b.stepOn === "bonus" ? s.bonusClosed : s.cumClosed;
        return `<div><dt>${esc(lb.bonus)} rate</dt><dd>${base >= b.stepAt ? fmtRate(b.stepRate) : `${fmtRate(b.rate)} · ${fmtRate(b.stepRate)} after ${money(b.stepAt - base)} more${b.stepOn === "bonus" ? ` ${esc(lb.bonusSales)}` : ""}`}</dd></div>`; })() : ""}
      ${Number(n.logoTarget) || Number(n.logos) ? `<div><dt>Logos</dt><dd>${s.logos !== (Number(n.logos) || 0) ? (Number(n.logos) || 0) + " → " : ""}${s.logos}${Number(n.logoTarget) ? " of " + Number(n.logoTarget) : ""}</dd></div>` : ""}
    </dl>
  </section>`;
}

// ---------------------------------------------------------------- render: numbers tab
const BASE_FIELDS = [
  ["quota", "Annual quota", "money", "Your annual sales quota."],
  ["ti", "Target incentive @ 100%", "money", "What you earn at 100% of quota."],
  ["ytdRC", "YTD sales", "money", "Year-to-date sales that count toward your quota."],
  ["bonusYTD", "YTD bonus-eligible sales", "money", "Sales that already earned the new-logo bonus this year."],
  ["owed", "Owed back before next check", "money", "YTD payments minus YTD earnings, from a no-start or audit."],
  ["fsH1Quota", "Fast Start sales quota", "money", "Your YTD sales quota at the end of the Fast Start period."],
  ["fsQ1Earned", "Earned the first Fast Start bonus", "bool", ""],
  ["logos", "Logos so far", "int", ""],
  ["logoTarget", "Logo target", "int", ""],
  ["asOf", "Numbers as of", "text", "So you know when you last updated them."],
];
function numFields() {
  const p = state.plan, over = p.fields || {};
  return BASE_FIELDS.filter(([k]) => (k !== "bonusYTD" || (p.bonus && p.bonus.stepOn === "bonus")) && ((k !== "fsH1Quota" && k !== "fsQ1Earned") || p.fastStart))
    .map(([k, label, type, hint]) => [k, (over[k] && over[k].label) || label, type, (over[k] && over[k].hint) || hint]);
}

function renderNumbers() {
  const n = state.numbers, p = state.plan, lb = L();
  const field = ([k, label, type, hint]) => {
    if (type === "bool") return `<label class="toggle full"><input type="checkbox" id="n-${k}" data-num="${k}" data-type="bool"${n[k] ? " checked" : ""}><span><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}</span></label>`;
    if (k === "ti" && p.tiTable) { const band = tiForQuota(n.quota, p); if (band) hint = `Your ${money(band.from)}${band.to ? "–" + money(band.to) : "+"} quota band sets this at ${money(band.ti)}. It updates when you change your quota.`; }
    const v = type === "money" ? inputMoney(n[k]) : type === "int" ? (Number(n[k]) ? String(Number(n[k])) : "") : (n[k] || "");
    return `<div class="field${type === "text" ? " full" : ""}"><label for="n-${k}">${esc(label)}</label>
      <div class="${type === "money" ? "money" : ""}"><input id="n-${k}" data-num="${k}" data-type="${type}" type="text" inputmode="${type === "text" ? "text" : type === "int" ? "numeric" : "decimal"}" autocomplete="off" value="${esc(v)}"></div>
      ${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
  };
  let prev = 0;
  const tierRows = p.tiers.map((t) => {
    const from = prev; prev = t.to == null ? prev : t.to;
    return `<tr><td>${from ? from + ".01" : "0"}${t.to == null ? "%+" : " – " + t.to + "%"}</td><td class="n">${fmtX(t.rate)}</td><td class="n">${t.to == null ? `+${r2(t.rate * 5)}% per 5%` : pct(points(t.to, p.tiers)).replace(".00", "")}</td></tr>`;
  }).join("");
  return `<section class="card">
      <h2>Your numbers</h2>
      <p class="note">Update these from Rollcall and the Earnings Estimator each week. Changes save when you leave a field.</p>
      <div class="fields">${numFields().map(field).join("")}</div>
    </section>
    ${syncCard()}
    <section class="card">
      <h2>${esc(p.name || "Your plan")}</h2>
      ${p.updated ? `<p class="hint">${esc(p.updated)}</p>` : ""}
      <div class="tw"><table><thead><tr><th>${esc(lb.band)} attainment</th><th class="n">Rate</th><th class="n">${esc(lb.target)} at top</th></tr></thead><tbody>${tierRows}</tbody></table></div>
      ${(p.tiTable || []).length ? `<div class="tw"><table><thead><tr><th>Quota band</th><th class="n">${esc(lb.target)} @ 100%</th></tr></thead><tbody>${p.tiTable.map((r, i, a) => `<tr${tiForQuota(n.quota, p) && tiForQuota(n.quota, p).from === r.from ? ' class="mine"' : ""}><td>${money(r.from)}${a[i + 1] ? " – " + money(a[i + 1].from - 1) : "+"}</td><td class="n">${money(r.ti)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      ${(p.notes || []).length ? `<ul class="notes">${p.notes.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="card">
      <h2>Setup code</h2>
      <p class="note">Your whole plan, numbers and deals in one code. Keep a copy somewhere private as a backup.</p>
      <div class="row-btns"><button class="btn" data-act="copy-setup">Copy setup code</button><button class="btn" data-act="show-load">Load a setup code</button></div>
      <div id="loadBox" hidden>
        <label class="sr" for="setupCode">Setup code</label>
        <textarea id="setupCode" rows="4" placeholder="PAYOUT1.…" autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
        <p class="err" id="setupErr" role="alert"></p>
        <button class="btn ${ui.armed === "replace" ? "danger " : ""}wide" data-act="replace-setup">${ui.armed === "replace" ? "Tap again to replace your numbers and deals" : "Load code"}</button>
      </div>
      <textarea id="copyArea" class="sr" aria-hidden="true" tabindex="-1" readonly></textarea>
    </section>`;
}

function syncCard() {
  if (!CONFIG) return `<section class="card"><h2>Sync</h2><p class="note">Sync isn't connected yet, so your numbers are saved on this device only.</p></section>`;
  if (!ui.syncReady) return `<section class="card"><h2>Sync</h2><p class="note">Connecting…</p></section>`;
  if (!ui.user) return `<section class="card"><h2>Sync</h2><p class="note">Sign in to keep your iPhone and iPad in step.</p>${authForm()}</section>`;
  const st = ui.syncStatus;
  const when = st && st.ok ? `Last synced ${new Date(st.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : st && !st.ok ? "Couldn't reach your account. Changes will sync when you're back online." : "Syncing…";
  return `<section class="card"><h2>Sync</h2><p class="note">Signed in as <b>${esc(ui.user.email)}</b>. ${esc(when)}</p>
    <button class="btn" data-act="sign-out">Sign out</button></section>`;
}

// ---------------------------------------------------------------- deal sheet
function openSheet(id) {
  const d = id ? (state.deals || []).find((x) => x.id === id) : null;
  ui.draft = d ? JSON.parse(JSON.stringify(d))
    : { id: uid(), name: "", status: "closed", month: defaultMonth(), rc: 0, split: false, newLogo: true, extras: {}, createdAt: Date.now(), isNew: true };
  ui.armed = null;
  renderSheet();
  const sh = $("#sheet"); sh.hidden = false;
  document.body.classList.add("sheet-open");
  setTimeout(() => { const f = $("#d-name"); if (f && !d) f.focus(); }, 60);
}
function closeSheet() { ui.draft = null; $("#sheet").hidden = true; $("#sheet").innerHTML = ""; document.body.classList.remove("sheet-open"); }

function renderSheet() {
  const d = ui.draft, lb = L(), p = state.plan;
  const sp = p.split;
  $("#sheet").innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-labelledby="sheetTitle">
    <header class="sheet-head">
      <button class="linkbtn" data-act="cancel">Cancel</button>
      <h2 id="sheetTitle">${d.isNew ? "Add deal" : "Edit deal"}</h2>
      <button class="linkbtn strong" data-act="save">Save</button>
    </header>
    <form class="sheet-body" data-form="deal" novalidate>
      <div class="field full"><label for="d-name">Deal name</label><input id="d-name" type="text" autocomplete="off" value="${esc(d.name)}" placeholder="Client or opportunity"></div>
      <div class="field full"><span class="flabel">Status</span>
        <div class="seg" role="radiogroup" aria-label="Status">
          <button type="button" role="radio" aria-checked="${d.status !== "pipeline"}" data-status="closed">Closed, not posted</button>
          <button type="button" role="radio" aria-checked="${d.status === "pipeline"}" data-status="pipeline">Still in pipeline</button>
        </div></div>
      <div class="field"><label for="d-month">${d.status === "pipeline" ? "Expected to post" : "Posts in"}</label>
        <select id="d-month">${fiscalMonths().map(([v, t]) => `<option value="${v}"${v === d.month ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>
      <div class="field"><label for="d-rc">Your ${esc(lb.rc)}</label>
        <div class="money"><input id="d-rc" type="text" inputmode="decimal" autocomplete="off" value="${esc(inputMoney(d.rc))}" placeholder="0"></div>
        <span class="hint">Your split. Type 119.8k or 119,800.</span></div>
      ${sp ? `<label class="toggle"><input type="checkbox" id="d-split"${d.split ? " checked" : ""}><span><b>${esc(lb.split)}</b><small>${fmtRate(sp.atSignShare)} at sign moves your ${esc(lb.band)}. The rest pays ${fmtRate(sp.startRate)} ${esc(lb.startPay)} when the client starts.</small></span></label>` : ""}
      <label class="toggle"><input type="checkbox" id="d-logo"${d.newLogo ? " checked" : ""}><span><b>${esc(lb.newLogo)}</b><small>Earns ${esc(lb.bonus).toLowerCase()} on your full ${esc(lb.rc)}.</small></span></label>
      ${(p.extras || []).length ? `<details class="more"${(p.extras || []).some((x) => Number((d.extras || {})[x.key])) ? " open" : ""}><summary>More: ${p.extras.map((x) => esc(x.label.toLowerCase())).join(", ")}</summary>
        <div class="fields">${p.extras.map((x) => `<div class="field"><label for="d-x-${esc(x.key)}">${esc(x.label)}</label>
          <div class="money"><input id="d-x-${esc(x.key)}" data-extra="${esc(x.key)}" type="text" inputmode="decimal" autocomplete="off" value="${esc(inputMoney((d.extras || {})[x.key]))}" placeholder="0"></div>
          ${x.hint ? `<span class="hint">${esc(x.hint)}</span>` : ""}</div>`).join("")}</div></details>` : ""}
      <div class="preview" id="preview" aria-live="polite"></div>
      ${d.isNew ? "" : `<button type="button" class="btn danger wide" data-act="delete-draft">${ui.armed === "del-draft" ? "Tap again to delete" : "Delete deal"}</button>`}
    </form>
  </div>`;
  renderPreview();
}

function readSheet() {
  const d = ui.draft;
  d.name = $("#d-name").value.trim();
  d.month = $("#d-month").value;
  d.rc = parseMoney($("#d-rc").value);
  const sp = $("#d-split"); d.split = sp ? sp.checked : false;
  d.newLogo = $("#d-logo").checked;
  d.extras = {};
  document.querySelectorAll("#sheet [data-extra]").forEach((el) => { const v = parseMoney(el.value); if (v) d.extras[el.dataset.extra] = v; });
  return d;
}

function renderPreview() {
  const box = $("#preview"); if (!box) return;
  const d = readSheet();
  if (!d.rc) { box.innerHTML = `<p class="muted">Enter your roll call to see what this deal pays.</p>`; return; }
  // Land it where it would really sit: after every other closed deal.
  const others = (state.deals || []).filter((x) => !x.posted && x.status !== "pipeline" && x.id !== d.id);
  let cum = Number(state.numbers.ytdRC) || 0, bcum = Number(state.numbers.bonusYTD) || 0;
  others.forEach((x) => { const pt = dealParts(x, state.plan); cum += pt.atSign; if (x.newLogo) bcum += pt.share; });
  const e = evalDeal(d, cum, state.plan, state.numbers, bcum);
  box.innerHTML = `<div class="pv-head"><span>${d.status === "pipeline" ? "If it closes, it pays" : "This deal pays"}</span><b>${money(e.total)}</b></div><ul class="lines">${lineItems(e)}</ul>`;
}

function saveDraft() {
  const d = readSheet();
  if (!d.name) d.name = "Untitled deal";
  delete d.isNew;
  commit((s) => {
    s.deals = s.deals || [];
    const i = s.deals.findIndex((x) => x.id === d.id);
    if (i >= 0) s.deals[i] = d; else s.deals.push(d);
  });
  closeSheet();
  toast("Deal saved");
}

// ---------------------------------------------------------------- actions
function postDeal(id) {
  const before = JSON.parse(JSON.stringify(state));
  const d = state.deals.find((x) => x.id === id); if (!d) return;
  const add = dealParts(d, state.plan).atSign;
  commit((s) => {
    const x = s.deals.find((y) => y.id === id);
    x.posted = true;
    s.numbers.ytdRC = r2((Number(s.numbers.ytdRC) || 0) + add);
    if (x.newLogo) s.numbers.logos = (Number(s.numbers.logos) || 0) + 1;
    if (x.newLogo && s.plan.bonus && s.plan.bonus.stepOn === "bonus") s.numbers.bonusYTD = r2((Number(s.numbers.bonusYTD) || 0) + dealParts(x, s.plan).share);
  });
  toast(`Moved to Posted. YTD ${L().rc} is now ${money(state.numbers.ytdRC)}.`, () => { state = before; commit(() => {}); });
}

async function copySetup() {
  const code = encodeSetup({ plan: state.plan, numbers: state.numbers, deals: state.deals || [] });
  try { await navigator.clipboard.writeText(code); toast("Setup code copied"); }
  catch {
    const ta = $("#copyArea"); ta.value = code; ta.classList.remove("sr"); ta.removeAttribute("aria-hidden");
    ta.focus(); ta.select(); toast("Select all and copy the code shown");
  }
}

function loadSetup(text, replace) {
  const err = $("#setupErr");
  try {
    const next = decodeSetup(text);
    const mode = next.mode; delete next.mode;
    if (mode === "update" && state) {
      // Plan update: new rules, keep this device's numbers and deals, fill only numbers it doesn't have yet.
      commit((s) => {
        s.plan = next.plan;
        Object.keys(next.numbers).forEach((k) => { if (s.numbers[k] == null || s.numbers[k] === "") s.numbers[k] = next.numbers[k]; });
      }, { quiet: true });
      ui.tab = "numbers"; ui.armed = null; render();
      toast("Plan updated. Your numbers and deals are unchanged.");
      return;
    }
    state = next; saveLocal();
    if (ui.sync && ui.user) ui.sync.pushNow(state);
    ui.tab = "payout"; ui.armed = null;
    render();
    toast(replace ? "Setup code loaded" : "Plan loaded");
  } catch (e) { if (err) err.textContent = e.message; }
}

// ---------------------------------------------------------------- toast
let toastTimer = null;
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button class="linkbtn" data-act="undo">Undo</button>` : ""}`;
  t.classList.add("show");
  toast.undo = undo || null;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); toast.undo = null; }, undo ? 6000 : 2600);
}

function arm(key) {
  ui.armed = key;
  setTimeout(() => { if (ui.armed === key) { ui.armed = null; ui.draft ? renderSheet() : render(); } }, 3000);
}

// ---------------------------------------------------------------- events
document.addEventListener("click", async (ev) => {
  const tab = ev.target.closest("[data-tab]");
  if (tab) { ui.tab = tab.dataset.tab; ui.armed = null; render(); window.scrollTo(0, 0); return; }
  const st = ev.target.closest("[data-status]");
  if (st && ui.draft) { readSheet(); ui.draft.status = st.dataset.status; renderSheet(); return; }
  if (ev.target === $("#sheet")) { closeSheet(); return; }
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  switch (act) {
    case "add": openSheet(null); break;
    case "edit": openSheet(id); break;
    case "cancel": closeSheet(); break;
    case "save": saveDraft(); break;
    case "post": postDeal(id); break;
    case "unpost": commit((s) => { s.deals.find((x) => x.id === id).posted = false; }); toast("Moved back. Check your YTD roll call."); break;
    case "delete":
      if (ui.armed === "del:" + id) { ui.armed = null; commit((s) => { s.deals = s.deals.filter((x) => x.id !== id); }); toast("Deal deleted"); }
      else { arm("del:" + id); render(); }
      break;
    case "delete-draft":
      if (ui.armed === "del-draft") { const did = ui.draft.id; ui.armed = null; closeSheet(); commit((s) => { s.deals = s.deals.filter((x) => x.id !== did); }); toast("Deal deleted"); }
      else { readSheet(); arm("del-draft"); renderSheet(); }
      break;
    case "load-setup": loadSetup($("#setupCode").value, false); break;
    case "show-load": $("#loadBox").hidden = false; $("#setupCode").focus(); break;
    case "replace-setup": {
      const v = $("#setupCode").value;
      if (ui.armed === "replace") { loadSetup(v, true); break; }
      try {
        if (decodeSetup(v).mode === "update") { loadSetup(v, true); break; }
        arm("replace"); render(); $("#loadBox").hidden = false; $("#setupCode").value = v;
      } catch (e) { $("#setupErr").textContent = e.message; }
      break;
    }
    case "copy-setup": copySetup(); break;
    case "undo": if (toast.undo) { const u = toast.undo; toast.undo = null; $("#toast").classList.remove("show"); u(); } break;
    case "sign-up": doAuth("signUp"); break;
    case "reset-pw": {
      const email = ($("#authEmail") || {}).value; const err = $("#authErr");
      if (!email) { err.textContent = "Enter your email first, then tap Forgot password."; break; }
      try { await ui.sync.resetPassword(email.trim()); err.textContent = ""; toast("Reset email sent"); }
      catch (e) { err.textContent = (await import("./sync.js")).authMessage(e); }
      break;
    }
    case "sign-out": await ui.sync.signOut(); toast("Signed out. Your numbers stay on this device."); break;
  }
});

document.addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (ev.target.dataset.form === "auth") doAuth("signIn");
  if (ev.target.dataset.form === "deal") saveDraft();
});

document.addEventListener("input", (ev) => { if (ev.target.closest("#sheet")) renderPreview(); });
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.closest("#sheet")) { renderPreview(); return; }
  if (t.dataset.num) {
    const k = t.dataset.num, type = t.dataset.type;
    const v = type === "bool" ? t.checked : type === "money" ? Math.abs(parseMoney(t.value)) : type === "int" ? Math.max(0, parseInt(t.value.replace(/[^\d]/g, ""), 10) || 0) : t.value.trim();
    if (state.numbers[k] === v) return;
    let tiMsg = "";
    commit((s) => {
      s.numbers[k] = v;
      if (k === "quota" && s.plan.tiTable) {
        const band = tiForQuota(v, s.plan);
        if (band && band.ti !== Number(s.numbers.ti)) { s.numbers.ti = band.ti; tiMsg = `Saved. TI set to ${money(band.ti)} for your quota band.`; }
      }
    }, { quiet: true });
    renderHeader();
    if (tiMsg || k === "quota") { render(); toast(tiMsg || "Saved"); return; }
    if (type === "money") t.value = inputMoney(v);
    toast("Saved");
  }
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && ui.draft) closeSheet(); });

async function doAuth(kind) {
  const email = ($("#authEmail").value || "").trim(), pw = $("#authPw").value, err = $("#authErr");
  if (!email || !pw) { err.textContent = "Enter your email and password."; return; }
  if (!ui.sync) { err.textContent = "Still connecting. Try again in a moment."; return; }
  if (ui.busy) return;
  ui.busy = true; err.textContent = "";
  try { await ui.sync[kind](email, pw); }
  catch (e) { err.textContent = (await import("./sync.js")).authMessage(e); }
  finally { ui.busy = false; }
}

// ---------------------------------------------------------------- sync wiring
async function connectSync() {
  if (!CONFIG) return;
  try {
    const { startSync } = await import("./sync.js");
    ui.sync = await startSync(CONFIG, {
      onUser(user) { ui.user = user; ui.syncReady = true; if (!user) ui.syncStatus = null; render(); },
      onRemote(remote) {
        if (!remote || !remote.plan) { if (state && ui.user) ui.sync.pushNow(state); return; }
        if (!state || (remote.updatedAt || 0) > (state.updatedAt || 0)) {
          if (ui.draft) return; // don't yank a deal out from under an open form; the next save resolves it
          state = remote; saveLocal(); render();
        } else if ((state.updatedAt || 0) > (remote.updatedAt || 0)) ui.sync.push(state);
      },
      onStatus(s) { ui.syncStatus = s; renderHeader(); if (ui.tab === "numbers" && state && !ui.draft) { const a = document.activeElement; if (!a || !a.dataset || !a.dataset.num) render(); } },
    });
  } catch {
    ui.syncReady = true; ui.syncStatus = { ok: false };
    render();
  }
}

// ---------------------------------------------------------------- boot
function markSvg() {
  return `<svg viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="12" fill="var(--hero-bg)"/><rect x="10" y="28" width="6" height="10" rx="1.5" fill="var(--b1)"/><rect x="18" y="22" width="6" height="16" rx="1.5" fill="var(--b2)"/><rect x="26" y="16" width="6" height="22" rx="1.5" fill="var(--b3)"/><rect x="34" y="10" width="6" height="28" rx="1.5" fill="var(--hero-ink)"/></svg>`;
}
render();
connectSync();
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}
