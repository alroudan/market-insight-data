// Market Insight Fear & Greed index for Boursa Kuwait (All-Share).
//
// Six equally weighted parts, each ranked against its own trailing 2 years
// (500 sessions) and scored 0–100 (50 = typical):
//   momentum      rebuilt All-Share index vs its 125-session average
//   breadth       share of stocks above their 50-session average
//   strength      new 52-week highs minus new 52-week lows (10-session mean)
//   volatility    20-session realised volatility vs its 1-year average (inverted)
//   participation value traded in rising minus falling stocks (10-session share)
//   safeHaven     20-session return of the rest of the market vs the 10 largest
//
// Daily history comes from Yahoo Finance (prices in fils). Today's bar is taken
// from the published TradingView snapshot so it matches the rest of the site.
// The All-Share index has no public history, so it is rebuilt from its member
// stocks (market-cap weighted, chain-linked) and checked against the official
// 1-month and YTD performance.
import { readFile, writeFile } from "node:fs/promises";

const WINDOW = 500;          // ~2 years of sessions for ranking
const MIN_RANK_OBS = 250;    // minimum history before a part is scored
const HISTORY_OUT = 800;     // sessions of index history written for the site
const MAX_DAILY_MOVE = 0.35; // larger single-day moves are treated as unadjusted corporate actions

const snapshot = JSON.parse(await readFile(new URL("../website/latest.json", import.meta.url), "utf8"));

const tickers = Object.keys(snapshot.stocks);
const kuwaitDate = (unixSeconds) => new Date((unixSeconds + 3 * 3600) * 1000).toISOString().slice(0, 10);

async function yahooHistory(ticker) {
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker + ".KW")}?range=5y&interval=1d`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        signal: AbortSignal.timeout(25000)
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("HTTP " + response.status);
      const result = (await response.json()).chart?.result?.[0];
      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote) return null;
      const rows = new Map();
      result.timestamp.forEach((ts, index) => {
        const close = quote.close[index];
        if (close != null && close > 0) rows.set(kuwaitDate(ts), { close, volume: quote.volume[index] || 0 });
      });
      return rows;
    } catch (error) {
      if (attempt === 3) { console.warn(ticker, "history unavailable:", error.message); return null; }
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

// ---- Load history -------------------------------------------------------
const histories = {};
let cursor = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < tickers.length) {
    const ticker = tickers[cursor++];
    histories[ticker] = await yahooHistory(ticker);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}));
const loaded = tickers.filter((ticker) => histories[ticker]?.size);
if (loaded.length < 100) throw new Error(`Only ${loaded.length} stock histories loaded; keeping previous sentiment file`);

// Today's bar from the published snapshot (same close/volume as the rest of the site).
const today = snapshot.tradingDate;
for (const ticker of loaded) {
  const stock = snapshot.stocks[ticker];
  if (stock?.tradingDate === today && stock.close > 0) {
    histories[ticker].set(today, { close: stock.close, volume: stock.volume || 0 });
  }
}

// Trading calendar: dates on which at least 40% of loaded stocks have a bar.
const counts = new Map();
for (const ticker of loaded) for (const date of histories[ticker].keys()) counts.set(date, (counts.get(date) || 0) + 1);
const dates = [...counts.entries()].filter(([, n]) => n >= loaded.length * 0.4).map(([d]) => d).sort();
const T = dates.length;

// Aligned arrays: close forward-filled after listing, volume 0 on missing days.
const close = {}, volume = {}, traded = {};
for (const ticker of loaded) {
  const rows = histories[ticker];
  const c = new Array(T).fill(null), v = new Array(T).fill(0), t = new Array(T).fill(false);
  let last = null;
  dates.forEach((date, i) => {
    const row = rows.get(date);
    if (row) { last = row.close; v[i] = row.volume; t[i] = true; }
    c[i] = last;
  });
  close[ticker] = c; volume[ticker] = v; traded[ticker] = t;
}
const dailyReturn = (ticker, i) => {
  const c = close[ticker];
  if (i === 0 || c[i] == null || c[i - 1] == null) return null;
  const r = c[i] / c[i - 1] - 1;
  return Math.abs(r) > MAX_DAILY_MOVE ? 0 : r;
};

// ---- Rebuilt cap-weighted indices --------------------------------------
const shares = {};
for (const ticker of loaded) {
  const s = snapshot.stocks[ticker];
  if (s.marketCapKwd > 0 && s.close > 0) shares[ticker] = s.marketCapKwd / s.close; // close in fils; scale cancels out
}
const largest = Object.keys(shares).sort((a, b) => shares[b] * snapshot.stocks[b].close - shares[a] * snapshot.stocks[a].close).slice(0, 10);
const largestSet = new Set(largest);
function chainIndex(members) {
  const level = new Array(T).fill(null);
  level[0] = 1000;
  for (let i = 1; i < T; i += 1) {
    let weighted = 0, weight = 0;
    for (const ticker of members) {
      const r = dailyReturn(ticker, i);
      const prev = close[ticker][i - 1];
      if (r == null || prev == null) continue;
      const w = shares[ticker] * prev;
      weighted += w * r; weight += w;
    }
    level[i] = level[i - 1] * (1 + (weight ? weighted / weight : 0));
  }
  return level;
}

// ---- Premier membership from Boursa (MARKET_ID = P) --------------------
let premier = new Set();
try {
  const r = await fetch("https://www.boursakuwait.com.kw/price?UID=&SID=&L=EN&UNC=1&UE=KSE&H=1&M=1&RT=303&SRC=KSE&AS=1", { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36", referer: "https://www.boursakuwait.com.kw/en/" } });
  const j = await r.json();
  for (const row of j.DAT.TD) { const f = row.split("|"); if (f[1].endsWith("`R") && f[8] === "P") premier.add(f[1].split("`")[0]); }
} catch (e) { console.log("premier list failed", e.message); }
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const sd = (arr) => { const m = mean(arr); return Math.sqrt(mean(arr.map((v) => (v - m) ** 2))); };
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const listedSince = {}; for (const t of loaded) listedSince[t] = close[t].findIndex((v) => v != null);

function rawSeries(universe) {
  const caps = universe.filter((t) => shares[t]);
  const market = chainIndex(caps);
  const sorted = [...caps].sort((a, b) => shares[b] * snapshot.stocks[b].close - shares[a] * snapshot.stocks[a].close);
  const big = sorted.slice(0, 10), bigSet = new Set(big);
  const top = chainIndex(big), rest = chainIndex(caps.filter((t) => !bigSet.has(t)));
  const raw = { momentum: [], breadth: [], strength: [], volatility: [], participation: [], safeHaven: [], activity: [] };
  const ret = market.map((v, i) => (i ? v / market[i - 1] - 1 : 0));
  const realised = ret.map((_, i) => (i < 20 ? null : Math.sqrt(mean(ret.slice(i - 19, i + 1).map((r) => r * r)))));
  const nhl = [], up = [], down = [], all = [];
  const minN = Math.min(40, Math.floor(universe.length * 0.6));
  for (let i = 0; i < T; i++) {
    let above = 0, el = 0, hi = 0, lo = 0, el52 = 0, u = 0, d = 0, a = 0;
    for (const t of universe) {
      const c = close[t]; if (!c || c[i] == null) continue; const age = i - listedSince[t];
      if (age >= 49) { el++; let s = 0; for (let k = i - 49; k <= i; k++) s += c[k]; if (c[i] > s / 50) above++; }
      if (age >= 251 && traded[t][i]) { el52++; let h = -Infinity, l = Infinity; for (let k = i - 251; k < i; k++) { if (c[k] > h) h = c[k]; if (c[k] < l) l = c[k]; } if (c[i] > h) hi++; else if (c[i] < l) lo++; }
      const r = dailyReturn(t, i); if (traded[t][i] && r != null) { const v = c[i] / 1000 * volume[t][i]; a += v; if (r > 0) u += v; else if (r < 0) d += v; }
    }
    raw.breadth.push(el >= minN ? above / el : null); nhl.push(el52 >= minN ? (hi - lo) / el52 : null); up.push(u); down.push(d); all.push(a);
    const m125 = i >= 124 ? mean(market.slice(i - 124, i + 1)) : null; raw.momentum.push(m125 ? market[i] / m125 - 1 : null);
    if (i >= 251 && realised[i] != null) { const y = realised.slice(i - 249, i + 1).filter((v) => v != null); raw.volatility.push(realised[i] / mean(y)); } else raw.volatility.push(null);
    raw.safeHaven.push(i >= 20 ? rest[i] / rest[i - 20] - top[i] / top[i - 20] : null);
  }
  for (let i = 0; i < T; i++) {
    const w = nhl.slice(Math.max(0, i - 9), i + 1); raw.strength.push(i >= 9 && w.every((v) => v != null) ? mean(w) : null);
    if (i >= 9) { let U = 0, D = 0, A = 0; for (let k = i - 9; k <= i; k++) { U += up[k]; D += down[k]; A += all[k]; } raw.participation.push(A > 0 ? (U - D) / A : null); } else raw.participation.push(null);
    raw.activity.push(i >= 259 ? mean(all.slice(i - 9, i + 1)) / mean(all.slice(i - 259, i + 1)) : null);
  }
  return raw;
}
function score(series, mode, invert) {
  return series.map((value, i) => {
    if (value == null) return null;
    const w = series.slice(Math.max(0, i - 499), i + 1).filter((v) => v != null);
    if (w.length < 250) return null;
    let s;
    if (mode === "rank") { let b = 0, e = 0; for (const v of w) { if (v < value) b++; else if (v === value) e++; } s = (b + 0.5 * e) / w.length * 100; }
    else { const z = (value - mean(w)) / (sd(w) || 1); s = phi(z) * 100; }
    return invert ? 100 - s : s;
  });
}
function variant(name, raw, mode, parts) {
  const sc = Object.fromEntries(parts.map((p) => [p, score(raw[p], mode, p === "volatility")]));
  const comp = dates.map((_, i) => { const v = parts.map((p) => sc[p][i]); return v.every((x) => x != null) ? mean(v) : null; });
  const at = (d) => { const i = dates.lastIndexOf(d); return i >= 0 && comp[i] != null ? +comp[i].toFixed(1) : null; };
  const valid = comp.map((v, i) => [dates[i], v]).filter((x) => x[1] != null);
  const vals = valid.map((x) => x[1]);
  const minRow = valid.reduce((m, x) => (x[1] < m[1] ? x : m));
  const dist = { XF: 0, F: 0, N: 0, G: 0, XG: 0 }; vals.forEach((v) => dist[v < 25 ? "XF" : v < 45 ? "F" : v < 55 ? "N" : v < 75 ? "G" : "XG"]++);
  const near = (d) => { const r = valid.find((x) => x[0] >= d); return r ? +r[1].toFixed(1) : null; };
  return { name, today: at(dates[T - 1]), oct14: at("2026-10-14"), parts: Object.fromEntries(parts.map((p) => [p, +(sc[p][T - 1] ?? NaN).toFixed(1)])), min: [minRow[0], +minRow[1].toFixed(1)], aug2024: near("2024-08-05"), apr2025: near("2025-04-07"), dist };
}
const allU = loaded, premU = loaded.filter((t) => premier.has(t));
const rawAll = rawSeries(allU), rawPrem = premU.length >= 20 ? rawSeries(premU) : null;
const base = ["momentum", "breadth", "strength", "volatility", "participation", "safeHaven"];
const alt = ["momentum", "breadth", "volatility", "activity", "safeHaven"];
const out = { premierCount: premU.length, premier: premU, variants: [
  variant("A current: All-Share, rank", rawAll, "rank", base),
  variant("B All-Share, z-score", rawAll, "z", base),
  variant("C All-Share, rank, 5 parts (no strength; activity level instead of money flow)", rawAll, "rank", alt),
  variant("D All-Share, z-score, 5 parts", rawAll, "z", alt),
  ...(rawPrem ? [variant("E Premier, rank", rawPrem, "rank", base), variant("F Premier, z-score", rawPrem, "z", base), variant("G Premier, z-score, 5 parts", rawPrem, "z", alt)] : [])
] };
await (await import("node:fs/promises")).writeFile("probe/result.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.variants.map((v) => [v.name, v.today, v.oct14])));
