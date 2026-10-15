// Market Insight Hot List (version 2): liquid breakouts with volume, trend and
// relative-strength confirmation. Tested on Nov 2022 – Sep 2026 before launch.
//
// Trigger (at least one):
//   range    close >= 0.5% above the highest high of the previous 20 sessions
//   52w      close above the highest high of the previous 250 sessions
//   squeeze  Bollinger(20, 2) bandwidth in its narrowest 20% of the last 6 months
//            within the past 5 sessions, then a close above the upper band
// Required: volume >= 1.5x its 20-session average (3-day average >= 1.2x) and
//   close above the 50-session average with the 50 above the 200 or rising.
// Score (0-100): volume 25, trend 20, 3-month relative strength in the top 30%
//   20-30, close in the top quarter of the day's range 15, not more than 8%
//   above the 20-session average 10. "Top setup" = score >= 85 and not stretched.
// Eligibility: 20-session average value traded >= KD 100k, traded on >= 18 of
//   20 sessions, price >= 50 fils, >= 252 sessions of history.
//
// Every signal is logged in data/hotlist-log.json and its result vs the
// rebuilt All-Share index is filled in after 5, 10 and 20 sessions.
import { readFile, writeFile } from "node:fs/promises";

const LOG_URL = new URL("../data/hotlist-log.json", import.meta.url);
const OUT_URL = new URL("../website/hotlist.json", import.meta.url);
const BACKFILL_FROM = "2026-09-14";
const TESTED = {
  period: "Nov 2022 – Sep 2026",
  all: { n: 826, beat10: 50, excess10: 1.96, excess20: 2.84 },
  range: { n: 486, beat10: 50, excess10: 1.53, excess20: 2.22 },
  "52w": { n: 330, beat10: 49, excess10: 2.84, excess20: 4.37 },
  squeeze: { n: 242, beat10: 52, excess10: 2.61, excess20: 3.12 }
};

const snapshot = JSON.parse(await readFile(new URL("../website/latest.json", import.meta.url), "utf8"));
const sentiment = await readFile(new URL("../website/sentiment.json", import.meta.url), "utf8").then(JSON.parse).catch(() => null);
const log = await readFile(LOG_URL, "utf8").then(JSON.parse).catch(() => ({ signals: [] }));
const tickers = Object.keys(snapshot.stocks);
const today = snapshot.tradingDate;
const kuwaitDate = (ts) => new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 10);

// ---- History: shared cache from the Fear & Greed step, else Yahoo ----------
async function yahoo(ticker) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker + ".KW")}?range=2y&interval=1d`, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        signal: AbortSignal.timeout(25000)
      });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error("HTTP " + r.status);
      const res = (await r.json()).chart?.result?.[0], q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) return null;
      const rows = new Map();
      res.timestamp.forEach((ts, i) => { const c = q.close[i]; if (c > 0) rows.set(kuwaitDate(ts), { close: c, volume: q.volume?.[i] || 0, open: q.open?.[i] || c, high: q.high?.[i] || c, low: q.low?.[i] || c }); });
      return rows;
    } catch (error) {
      if (attempt === 3) return null;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}
let histories = {};
if (process.env.HISTORY_CACHE) {
  try {
    const cached = JSON.parse(await readFile(process.env.HISTORY_CACHE, "utf8"));
    for (const [t, rows] of Object.entries(cached)) histories[t] = new Map(rows);
  } catch { histories = {}; }
}
if (Object.keys(histories).length < 100) {
  histories = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < tickers.length) { const t = tickers[cursor++]; histories[t] = await yahoo(t); await new Promise((r) => setTimeout(r, 150)); }
  }));
}
const loaded = tickers.filter((t) => histories[t]?.size > 60);
if (loaded.length < 100) throw new Error(`Only ${loaded.length} histories available; keeping previous Hot List`);

// Today's bar from the published snapshot.
for (const t of loaded) {
  const s = snapshot.stocks[t], y = histories[t].get(today);
  if (s?.tradingDate === today && s.close > 0) {
    histories[t].set(today, {
      close: s.close, volume: s.volume || 0,
      open: s.open || y?.open || s.close,
      high: Math.max(s.high || y?.high || s.close, s.close),
      low: Math.min(s.low || y?.low || s.close, s.close)
    });
  }
}

// ---- Align ------------------------------------------------------------------
const counts = new Map();
for (const t of loaded) for (const d of histories[t].keys()) counts.set(d, (counts.get(d) || 0) + 1);
const dates = [...counts].filter(([, n]) => n >= loaded.length * 0.4).map(([d]) => d).sort();
const T = dates.length, last = T - 1;
if (dates[last] !== today) console.warn(`Latest aligned date ${dates[last]} differs from snapshot ${today}`);
const S = {};
for (const t of loaded) {
  const o = [], h = [], l = [], c = [], v = [], tr = []; let prev = null;
  for (const d of dates) {
    const r = histories[t].get(d);
    if (r) { prev = r; o.push(r.open); h.push(r.high); l.push(r.low); c.push(r.close); v.push(r.volume); tr.push(true); }
    else { const pc = prev?.close ?? null; o.push(pc); h.push(pc); l.push(pc); c.push(pc); v.push(0); tr.push(false); }
  }
  S[t] = { o, h, l, c, v, tr, start: c.findIndex((x) => x != null) };
}
const brk = {};
for (const t of loaded) { const c = S[t].c; brk[t] = c.map((x, i) => i > 0 && x != null && c[i - 1] != null && Math.abs(x / c[i - 1] - 1) > 0.35); }
const hadBreak = (t, i, n) => { for (let k = i; k > i - n && k > 0; k -= 1) if (brk[t][k]) return true; return false; };

// Rebuilt All-Share (cap-weighted, chain-linked) for measuring results.
const shares = {};
for (const t of loaded) { const s = snapshot.stocks[t]; if (s.marketCapKwd > 0 && s.close > 0) shares[t] = s.marketCapKwd / s.close; }
const market = [1000];
for (let i = 1; i < T; i += 1) {
  let wr = 0, w = 0;
  for (const t in shares) { const c = S[t].c; if (c[i] == null || c[i - 1] == null || brk[t][i]) continue; const ww = shares[t] * c[i - 1]; wr += ww * (c[i] / c[i - 1] - 1); w += ww; }
  market.push(market[i - 1] * (1 + (w ? wr / w : 0)));
}

// ---- Indicators ---------------------------------------------------------------
const sma = (a, i, n) => { if (i + 1 < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k += 1) { if (a[k] == null) return null; s += a[k]; } return s / n; };
const maxRange = (a, i0, i1) => { let m = -Infinity; for (let k = i0; k <= i1; k += 1) if (a[k] != null && a[k] > m) m = a[k]; return m; };
function atr14(t, i) {
  const { h, l, c } = S[t]; let a = null, n = 0, acc = 0;
  for (let k = Math.max(1, i - 120); k <= i; k += 1) {
    if (c[k - 1] == null || h[k] == null) continue;
    const tr = Math.max(h[k] - l[k], Math.abs(h[k] - c[k - 1]), Math.abs(l[k] - c[k - 1]));
    if (a == null) { acc += tr; n += 1; if (n === 14) a = acc / 14; } else a = (a * 13 + tr) / 14;
  }
  return a;
}
const breadthAt = (i) => {
  let above = 0, eligible = 0;
  for (const t of loaded) { const c = S[t].c; if (c[i] == null || i - S[t].start < 49) continue; eligible += 1; const m = sma(c, i, 50); if (m && c[i] > m) above += 1; }
  return eligible >= 40 ? above / eligible : null;
};
const rsCache = new Map();
function rsRank(i) {
  if (rsCache.has(i)) return rsCache.get(i);
  const arr = loaded.map((t) => { const c = S[t].c; return [t, i >= 63 && c[i] != null && c[i - 63] != null && !hadBreak(t, i, 63) ? c[i] / c[i - 63] - 1 : null]; })
    .filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]);
  const ranks = {}; arr.forEach(([t], k) => { ranks[t] = arr.length > 1 ? k / (arr.length - 1) : 0.5; });
  rsCache.set(i, ranks);
  return ranks;
}

function evaluate(t, i) {
  const { h, l, c, v, tr } = S[t];
  if (i - S[t].start < 252 || !tr[i] || hadBreak(t, i, 252)) return null;
  let value20 = 0, days = 0;
  for (let k = i - 19; k <= i; k += 1) { value20 += (c[k] / 1000) * v[k]; if (tr[k] && v[k] > 0) days += 1; }
  value20 /= 20;
  if (value20 < 100000 || days < 18 || c[i] < 50) return null;
  const prevHigh20 = maxRange(h, i - 20, i - 1), prevHigh250 = maxRange(h, i - 250, i - 1);
  const sma20 = sma(c, i, 20), sma50 = sma(c, i, 50), sma200 = sma(c, i, 200), sma50ago = sma(c, i - 10, 50);
  if (sma20 == null || sma50 == null || sma200 == null || sma50ago == null) return null;
  const bandwidth = (k0) => { const m = sma(c, k0, 20); let s = 0; for (let k = k0 - 19; k <= k0; k += 1) s += (c[k] - m) ** 2; return (4 * Math.sqrt(s / 20)) / m; };
  let sd = 0; for (let k = i - 19; k <= i; k += 1) sd += (c[k] - sma20) ** 2; sd = Math.sqrt(sd / 20);
  const upper = sma20 + 2 * sd;
  const bwHist = []; for (let k = i - 125; k <= i - 1; k += 1) bwHist.push(bandwidth(k));
  const bwSorted = [...bwHist].sort((a, b) => a - b), bwP20 = bwSorted[Math.floor(bwSorted.length * 0.2)];
  const isRange = c[i] > prevHigh20 * 1.005, is52 = c[i] > prevHigh250, isSqueeze = Math.min(...bwHist.slice(-5)) <= bwP20 && c[i] > upper;
  if (!(isRange || is52 || isSqueeze)) return null;
  const avgVol20 = sma(v, i - 1, 20) || 0, vol3 = (v[i] + v[i - 1] + v[i - 2]) / 3;
  const volOk = avgVol20 > 0 && v[i] >= 1.5 * avgVol20 && vol3 >= 1.2 * avgVol20;
  const trendOk = c[i] > sma50 && (sma50 > sma200 || sma50 > sma50ago);
  if (!volOk || !trendOk) return null;
  const rs = rsRank(i)[t] ?? 0, rsOk = rs >= 0.7;
  const dayRange = h[i] - l[i], closeLoc = dayRange > 0 ? (c[i] - l[i]) / dayRange : 1, closeOk = closeLoc >= 0.75;
  const stretch = c[i] / sma20 - 1, notStretched = stretch <= 0.08;
  const score = 25 + 20 + (rsOk ? 20 + (10 * (rs - 0.7)) / 0.3 : 0) + (closeOk ? 15 : 0) + (notStretched ? 10 : 0);
  const setup = is52 ? "52w" : isRange ? "range" : "squeeze";
  const level = setup === "52w" ? prevHigh250 : setup === "range" ? prevHigh20 : upper;
  const atr = atr14(t, i);
  const stop = Math.max(level * 0.98, c[i] - 1.5 * (atr || 0));
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    ticker: t, setup, score: Math.round(score), top: score >= 85 && notStretched,
    close: c[i], level: r1(level), stop: r1(stop),
    aboveLevelPercent: r1((c[i] / level - 1) * 100), stopPercent: r1((stop / c[i] - 1) * 100),
    volumeRatio: r1(v[i] / avgVol20), strengthPercentile: Math.round(rs * 100), closeLocationPercent: Math.round(closeLoc * 100),
    stretchPercent: r1(stretch * 100), avgValueKwd: Math.round(value20),
    checks: { volume: volOk, trend: trendOk, strength: rsOk, close: closeOk, notStretched }
  };
}
const signalsOn = (i) => loaded.map((t) => evaluate(t, i)).filter(Boolean).sort((a, b) => b.score - a.score || b.volumeRatio - a.volumeRatio);

// ---- Log: backfill once, add today's signals, fill in results -------------
const dateIndex = new Map(dates.map((d, i) => [d, i]));
const logged = new Map(log.signals.map((s) => [s.date + ":" + s.ticker, s]));
const lastSignalIndex = {};
for (const s of log.signals) { const i = dateIndex.get(s.date); if (i != null) lastSignalIndex[s.ticker] = Math.max(lastSignalIndex[s.ticker] ?? -1, i); }
const isBackfill = !log.lastProcessed;
const startIndex = log.lastProcessed ? dates.findIndex((d) => d > log.lastProcessed) : dates.findIndex((d) => d >= BACKFILL_FROM);
for (let i = startIndex < 0 ? T : Math.max(startIndex, 260); i <= last; i += 1) {
  for (const s of signalsOn(i)) {
    const key = dates[i] + ":" + s.ticker;
    if (logged.has(key)) continue;
    if (lastSignalIndex[s.ticker] != null && i - lastSignalIndex[s.ticker] < 10 && i !== lastSignalIndex[s.ticker]) continue; // one entry per stock per 10 sessions
    lastSignalIndex[s.ticker] = i;
    const entry = { date: dates[i], ticker: s.ticker, setup: s.setup, score: s.score, top: s.top, close: Math.round(s.close * 1000) / 1000, level: s.level, stop: s.stop, backfilled: isBackfill && dates[i] < today };
    logged.set(key, entry); log.signals.push(entry);
  }
}
for (const s of log.signals) {
  const i = dateIndex.get(s.date), c = S[s.ticker]?.c;
  if (i == null || !c) continue;
  for (const n of [5, 10, 20]) {
    if (s["excess" + n] != null || i + n > last || hadBreak(s.ticker, i + n, n)) continue;
    const r = c[i + n] / c[i] - 1, m = market[i + n] / market[i] - 1;
    s["return" + n] = Math.round(r * 1000) / 10; s["excess" + n] = Math.round((r - m) * 1000) / 10;
  }
  if (i + 1 <= last) {
    let hit = false; for (let k = i + 1; k <= Math.min(last, i + 10); k += 1) if (c[k] < s.stop) { hit = true; break; }
    s.invalidatedWithin10 = hit;
  }
}
log.signals.sort((a, b) => a.date.localeCompare(b.date) || b.score - a.score);
log.updatedAt = new Date().toISOString();
log.lastProcessed = dates[last];
await writeFile(LOG_URL, JSON.stringify(log, null, 1) + "\n");

const summarise = (rows, n) => {
  const done = rows.filter((s) => s["excess" + n] != null);
  if (!done.length) return { completed: 0 };
  const ex = done.map((s) => s["excess" + n]);
  return { completed: done.length, averageExcess: Math.round((ex.reduce((a, b) => a + b, 0) / ex.length) * 10) / 10, beatMarketPercent: Math.round((ex.filter((x) => x > 0).length / ex.length) * 100) };
};
const group = (rows) => ({ signals: rows.length, since: rows[0]?.date || null, day5: summarise(rows, 5), day10: summarise(rows, 10), day20: summarise(rows, 20) });
const record = { all: group(log.signals), live: group(log.signals.filter((x) => !x.backfilled)), backfilled: group(log.signals.filter((x) => x.backfilled)) };

// ---- Output -------------------------------------------------------------------
const rows = signalsOn(last).map((s) => ({ ...s, name: snapshot.stocks[s.ticker]?.name || s.ticker, nameArabic: snapshot.stocks[s.ticker]?.nameArabic || null, tickerArabic: snapshot.stocks[s.ticker]?.tickerArabic || null }));
const breadth = breadthAt(last);
const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  tradingDate: dates[last],
  market: {
    breadthPercent: breadth == null ? null : Math.round(breadth * 100),
    fearGreed: sentiment?.tradingDate === dates[last] ? { score: Math.round(sentiment.latest.score), label: sentiment.latest.label } : null,
    weak: breadth != null && breadth < 0.3
  },
  tested: TESTED,
  record,
  recent: log.signals.filter((s) => s.date !== dates[last]).slice(-12).reverse(),
  rows
};
await writeFile(OUT_URL, JSON.stringify(output) + "\n");
console.log(`Hot List ${output.tradingDate}: ${rows.length} signal(s) ${rows.map((r) => r.ticker + " " + r.score).join(", ")} · breadth ${output.market.breadthPercent}% · log ${log.signals.length}`);
console.log("Record:", JSON.stringify(record));
