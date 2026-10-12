// Payout engine. Generic on purpose: every rate, threshold and label comes from
// the plan object loaded from a private setup code, so nothing plan-specific
// lives in this public repo.

export const r2 = (x) => Math.round((x + (x >= 0 ? 1 : -1) * Number.EPSILON) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Attainment as a percent of quota, rounded to 2 decimals. */
export function attainment(rc, quota) {
  return quota > 0 ? r2((rc / quota) * 100) : 0;
}

/** Percent of target incentive earned at an attainment, stacking each tier's rate. */
export function points(att, tiers) {
  let p = 0, prev = 0;
  for (const t of tiers) {
    const top = t.to == null ? Infinity : t.to;
    if (att <= prev) break;
    p += (Math.min(att, top) - prev) * t.rate;
    prev = top;
  }
  return r2(p);
}

/** Rate of the tier an attainment sits in. */
export function tierRate(att, tiers) {
  for (const t of tiers) if (t.to == null || att < t.to) return t.rate;
  return tiers[tiers.length - 1].rate;
}

/** Split a deal's roll call into the part that moves the band and the part paid at start. */
export function dealParts(deal, plan) {
  const share = Math.max(0, num(deal.rc));
  const split = !!deal.split && plan.split;
  const atSign = split ? r2(share * num(plan.split.atSignShare)) : share;
  return { share, split: !!split, atSign, atStart: r2(share - atSign) };
}

/** What one deal pays when it lands on top of `cum` YTD band sales.
 *  `bonusCum` is YTD bonus-eligible sales, used when the bonus steps up on those (stepOn: "bonus"). */
export function evalDeal(deal, cum, plan, numbers, bonusCum = 0) {
  const ti = num(numbers.ti), quota = num(numbers.quota);
  const { share, split, atSign, atStart } = dealParts(deal, plan);
  const aBefore = attainment(cum, quota), aAfter = attainment(cum + atSign, quota);
  const bandPct = r2(points(aAfter, plan.tiers) - points(aBefore, plan.tiers));
  const bandPay = r2((ti * bandPct) / 100);

  // New-logo bonus on the full share. The rate steps up once the measured YTD total passes stepAt:
  // bonus-eligible sales when stepOn is "bonus", otherwise the sales that move the band.
  const b = plan.bonus || {};
  const onBonus = b.stepOn === "bonus";
  let bonus = 0, stepFrac = 0;
  if (deal.newLogo && b.rate) {
    const step = b.stepAt == null ? Infinity : num(b.stepAt);
    const base = onBonus ? num(bonusCum) : cum, inc = onBonus ? share : atSign;
    stepFrac = inc > 0 ? Math.max(0, base + inc - Math.max(base, step)) / inc : (base > step ? 1 : 0);
    const hi = b.stepRate == null ? b.rate : num(b.stepRate);
    bonus = r2(share * (num(b.rate) * (1 - stepFrac) + hi * stepFrac));
  }
  const startPay = split ? r2(atStart * num(plan.split.startRate)) : 0;
  const extras = (plan.extras || []).map((x) => ({ ...x, amount: Math.max(0, num((deal.extras || {})[x.key])) }))
    .filter((x) => x.amount > 0).map((x) => ({ ...x, pay: r2(x.amount * num(x.rate)) }));
  const extrasPay = r2(extras.reduce((s, x) => s + x.pay, 0));
  const large = plan.largeDeal ? share + num((deal.extras || {}).addl) > num(plan.largeDeal) : false;
  return {
    share, split, atSign, atStart, aBefore, aAfter, bandPct, bandPay, bonus, stepFrac, startPay, extras,
    commissions: r2(bonus + startPay + extrasPay),
    total: r2(bandPay + bonus + startPay + extrasPay),
    cumAfter: cum + atSign, bonusCumAfter: num(bonusCum) + (deal.newLogo ? share : 0), large,
  };
}

const byPostMonth = (a, b) => String(a.month || "").localeCompare(String(b.month || "")) || num(a.createdAt) - num(b.createdAt);

/** Everything the screens need, in one pass. */
export function summarize(state) {
  const { plan, numbers } = state;
  const deals = (state.deals || []).filter((d) => !d.posted);
  const ytd = num(numbers.ytdRC);
  let cum = ytd, bcum = num(numbers.bonusYTD);
  const closed = deals.filter((d) => d.status !== "pipeline").sort(byPostMonth)
    .map((d) => { const e = evalDeal(d, cum, plan, numbers, bcum); cum = e.cumAfter; bcum = e.bonusCumAfter; return { d, e }; });
  const cumClosed = cum, bonusClosed = bcum;
  const pipeline = deals.filter((d) => d.status === "pipeline")
    .map((d) => ({ d, e: evalDeal(d, cumClosed, plan, numbers, bonusClosed) }))
    .sort((x, y) => y.e.total - x.e.total);
  let cumAll = cumClosed, ball = bonusClosed, pipelineAll = 0;
  deals.filter((d) => d.status === "pipeline").sort(byPostMonth).forEach((d) => {
    const e = evalDeal(d, cumAll, plan, numbers, ball); cumAll = e.cumAfter; ball = e.bonusCumAfter; pipelineAll += e.total;
  });
  const owed = Math.abs(num(numbers.owed));
  const closedTotal = r2(closed.reduce((s, x) => s + x.e.total, 0));
  const newLogos = closed.filter((x) => x.d.newLogo).length;
  return {
    ytd, cumClosed, cumAll, bonusClosed, closed, pipeline, owed, closedTotal,
    afterOwed: r2(Math.max(0, closedTotal - owed)),
    pipelineAll: r2(pipelineAll),
    logos: num(numbers.logos) + newLogos,
    posted: (state.deals || []).filter((d) => d.posted),
  };
}

/** Target incentive for a quota, from the plan's quota-band table ({from, ti} rows). */
export function tiForQuota(quota, plan) {
  const rows = (plan.tiTable || []).slice().sort((a, b) => num(a.from) - num(b.from));
  let hit = null;
  rows.forEach((r) => { if (num(quota) >= num(r.from)) hit = r; });
  if (!hit) return null;
  const i = rows.indexOf(hit), next = rows[i + 1];
  return { ti: num(hit.ti), from: num(hit.from), to: next ? num(next.from) - 1 : null };
}

/** Fast Start: where you stand against the period that's still open. */
export function fastStart(state, s) {
  const fs = state.plan.fastStart; if (!fs || !fs.h1) return null;
  const n = state.numbers, q1Earned = !!n.fsQ1Earned;
  const amount = num(q1Earned ? fs.h1.amountWithQ1 : fs.h1.amountWithoutQ1);
  const quota = num(n.fsH1Quota), end = String(fs.h1.end || "");
  const postsBy = (d) => String(d.month || "") <= end;
  let byEnd = num(n.ytdRC);
  s.closed.forEach(({ d, e }) => { if (postsBy(d)) byEnd += e.atSign; });
  let withPipe = byEnd;
  s.pipeline.forEach(({ d, e }) => { if (postsBy(d)) withPipe += e.atSign; });
  return {
    label: fs.label || "Fast Start bonus", period: fs.h1.label || "1H", endLabel: fs.h1.endLabel || end,
    q1Label: (fs.q1 && fs.q1.label) || "Q1", q1Amount: num(fs.q1 && fs.q1.amount), q1Earned,
    amount, quota, byEnd: r2(byEnd), withPipe: r2(withPipe),
    need: r2(Math.max(0, quota - byEnd)), needWithPipe: r2(Math.max(0, quota - withPipe)),
    met: quota > 0 && byEnd >= quota, metWithPipe: quota > 0 && withPipe >= quota, note: fs.note || "",
  };
}

// ---- setup codes: "PAYOUT1." + base64url(JSON) ----
const PREFIX = "PAYOUT1.";
export function encodeSetup(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return PREFIX + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function decodeSetup(text) {
  const s = String(text || "").trim().replace(/\s+/g, "");
  if (!s) throw new Error("Paste your setup code first.");
  let json;
  if (s.startsWith("{")) json = s;
  else {
    if (!s.startsWith(PREFIX)) throw new Error("That doesn't look like a setup code. It should start with PAYOUT1.");
    const b64 = s.slice(PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    try {
      const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
      json = new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch { throw new Error("That setup code is incomplete. Copy the whole thing and try again."); }
  }
  let obj;
  try { obj = JSON.parse(json); } catch { throw new Error("That setup code is incomplete. Copy the whole thing and try again."); }
  if (!obj || !obj.plan || !Array.isArray(obj.plan.tiers) || !obj.plan.tiers.length) throw new Error("That setup code has no plan in it.");
  return {
    plan: obj.plan,
    numbers: obj.numbers || {},
    deals: Array.isArray(obj.deals) ? obj.deals : [],
    mode: obj.mode === "update" ? "update" : "full",
    updatedAt: Date.now(),
  };
}

/** Accepts "59.9k", "$59,900", "1.2m", "-3,981". */
export function parseMoney(v) {
  let s = String(v == null ? "" : v).trim().toLowerCase().replace(/[−–—]/g, "-").replace(/[$,\s]/g, "");
  if (!s) return 0;
  let m = 1;
  if (s.endsWith("k")) { m = 1e3; s = s.slice(0, -1); } else if (s.endsWith("m")) { m = 1e6; s = s.slice(0, -1); }
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * m * 100) / 100 : 0;
}
