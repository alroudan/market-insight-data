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
const previous = await readFile(new URL("../website/sentiment.json", import.meta.url), "utf8").then(JSON.parse).catch(() => null);
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
const capTickers = Object.keys(shares);
const market = chainIndex(capTickers);
const top = chainIndex(largest);
const rest = chainIndex(capTickers.filter((t) => !largestSet.has(t)));

// ---- Raw part series ---------------------------------------------------
const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
const sma = (arr, i, n) => (i + 1 < n ? null : mean(arr.slice(i - n + 1, i + 1)));
const raw = { momentum: [], breadth: [], strength: [], volatility: [], participation: [], safeHaven: [] };
const marketReturns = market.map((v, i) => (i ? v / market[i - 1] - 1 : 0));
const realised = marketReturns.map((_, i) => (i < 20 ? null : Math.sqrt(mean(marketReturns.slice(i - 19, i + 1).map((r) => r * r))) * Math.sqrt(250)));
const netHighLow = new Array(T).fill(null), flowUp = new Array(T).fill(0), flowDown = new Array(T).fill(0), flowAll = new Array(T).fill(0);
const listedSince = {};
for (const ticker of loaded) listedSince[ticker] = close[ticker].findIndex((v) => v != null);

for (let i = 0; i < T; i += 1) {
  // Breadth
  let above = 0, eligible = 0, highs = 0, lows = 0, eligible52 = 0;
  for (const ticker of loaded) {
    const c = close[ticker];
    if (c[i] == null) continue;
    const age = i - listedSince[ticker];
    if (age >= 49) {
      eligible += 1;
      let sum = 0; for (let k = i - 49; k <= i; k += 1) sum += c[k];
      if (c[i] > sum / 50) above += 1;
    }
    if (age >= 251 && traded[ticker][i]) {
      eligible52 += 1;
      let hi = -Infinity, lo = Infinity;
      for (let k = i - 251; k < i; k += 1) { if (c[k] > hi) hi = c[k]; if (c[k] < lo) lo = c[k]; }
      if (c[i] > hi) highs += 1; else if (c[i] < lo) lows += 1;
    }
    const r = dailyReturn(ticker, i);
    if (traded[ticker][i] && r != null) {
      const value = (c[i] / 1000) * volume[ticker][i];
      flowAll[i] += value;
      if (r > 0) flowUp[i] += value; else if (r < 0) flowDown[i] += value;
    }
  }
  raw.breadth.push(eligible >= 40 ? above / eligible : null);
  netHighLow[i] = eligible52 >= 40 ? (highs - lows) / eligible52 : null;
  const avg125 = sma(market, i, 125);
  raw.momentum.push(avg125 ? market[i] / avg125 - 1 : null);
  if (i >= 251 && realised[i] != null) {
    const yearVol = realised.slice(i - 249, i + 1).filter((v) => v != null);
    raw.volatility.push(yearVol.length >= 200 ? realised[i] / mean(yearVol) : null);
  } else raw.volatility.push(null);
  raw.safeHaven.push(i >= 20 ? (rest[i] / rest[i - 20]) - (top[i] / top[i - 20]) : null);
}
for (let i = 0; i < T; i += 1) {
  const window = netHighLow.slice(Math.max(0, i - 9), i + 1);
  raw.strength.push(i >= 9 && window.every((v) => v != null) ? mean(window) : null);
  if (i >= 9) {
    let up = 0, down = 0, all = 0;
    for (let k = i - 9; k <= i; k += 1) { up += flowUp[k]; down += flowDown[k]; all += flowAll[k]; }
    raw.participation.push(all > 0 ? (up - down) / all : null);
  } else raw.participation.push(null);
}

// ---- Rank each part against its trailing 2 years -----------------------
const invert = { volatility: true };
const scores = {};
for (const [part, series] of Object.entries(raw)) {
  scores[part] = series.map((value, i) => {
    if (value == null) return null;
    const window = series.slice(Math.max(0, i - WINDOW + 1), i + 1).filter((v) => v != null);
    if (window.length < MIN_RANK_OBS) return null;
    let below = 0, equal = 0;
    for (const v of window) { if (v < value) below += 1; else if (v === value) equal += 1; }
    const pct = ((below + 0.5 * equal) / window.length) * 100;
    return invert[part] ? 100 - pct : pct;
  });
}
const parts = Object.keys(raw);
const composite = dates.map((_, i) => {
  const values = parts.map((p) => scores[p][i]);
  return values.every((v) => v != null) ? mean(values) : null;
});
const firstScored = composite.findIndex((v) => v != null);
if (firstScored < 0) throw new Error("Not enough history to score the index");

const round = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const label = (v) => (v < 25 ? "extremeFear" : v < 45 ? "fear" : v < 55 ? "neutral" : v < 75 ? "greed" : "extremeGreed");
const last = T - 1;
if (dates[last] !== today) console.warn(`Latest history date ${dates[last]} differs from snapshot ${today}`);
const back = (sessions) => (last - sessions >= firstScored ? { date: dates[last - sessions], score: round(composite[last - sessions]) } : null);

// ---- Check the rebuilt index against official performance ---------------
const officialAllShare = snapshot.allShareIndex || {};
const dateIndexOnOrBefore = (date) => { for (let i = last; i >= 0; i -= 1) if (dates[i] <= date) return i; return -1; };
const monthAgo = new Date(Date.parse(today + "T00:00:00Z")); monthAgo.setUTCMonth(monthAgo.getUTCMonth() - 1);
const iMonth = dateIndexOnOrBefore(monthAgo.toISOString().slice(0, 10));
const iYearEnd = dateIndexOnOrBefore(`${Number(today.slice(0, 4)) - 1}-12-31`);
const check = {
  rebuilt1MonthPercent: round((market[last] / market[iMonth] - 1) * 100, 2),
  official1MonthPercent: round(officialAllShare.performance1MonthPercent, 2),
  rebuiltYtdPercent: round((market[last] / market[iYearEnd] - 1) * 100, 2),
  officialYtdPercent: round(officialAllShare.performanceYtdPercent, 2),
  rebuiltDailyPercent: round(marketReturns[last] * 100, 2),
  officialDailyPercent: round(officialAllShare.changePercent, 2)
};

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  tradingDate: dates[last],
  market: "All-Share",
  method: {
    parts,
    weights: "equal",
    rankingWindowSessions: WINDOW,
    labels: { extremeFear: "0–25", fear: "25–45", neutral: "45–55", greed: "55–75", extremeGreed: "75–100" },
    largestTen: largest,
    sources: ["Yahoo Finance daily history (Boursa Kuwait listings)", "TradingView Kuwait scanner (latest close)"]
  },
  coverage: { stocks: loaded.length, of: tickers.length, sessions: T, firstHistoryDate: dates[0], firstScoredDate: dates[firstScored] },
  check,
  latest: {
    score: round(composite[last]),
    label: label(composite[last]),
    average10: round(mean(composite.slice(Math.max(firstScored, last - 9), last + 1))),
    parts: Object.fromEntries(parts.map((p) => [p, { score: round(scores[p][last]), label: label(scores[p][last]), value: round(raw[p][last], 4) }])),
    compare: { day: back(1), week: back(5), month: back(21), year: back(250) }
  },
  // [date, composite, momentum, breadth, strength, volatility, participation, safeHaven]
  history: dates.slice(Math.max(firstScored, T - HISTORY_OUT)).map((date) => {
    const i = dates.indexOf(date);
    return [date, round(composite[i]), ...parts.map((p) => round(scores[p][i], 0))];
  })
};

if (previous && previous.tradingDate > output.tradingDate) throw new Error("Refusing to replace a newer sentiment file");
await writeFile(new URL("../website/sentiment.json", import.meta.url), JSON.stringify(output) + "\n");
console.log(`Fear & Greed ${output.tradingDate}: ${output.latest.score} (${output.latest.label}) from ${loaded.length}/${tickers.length} stocks`);
console.log("Parts:", JSON.stringify(Object.fromEntries(parts.map((p) => [p, output.latest.parts[p].score]))));
console.log("Rebuilt index check:", JSON.stringify(check));
