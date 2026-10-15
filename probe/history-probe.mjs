// Probe 10: backtest the current Hot List rules vs the proposed method on ~5y of daily data.
import { readFile, writeFile } from "node:fs/promises";
const snap = JSON.parse(await readFile("website/latest.json", "utf8"));
const tickers = Object.keys(snap.stocks);
const kd = (ts) => new Date((ts + 3 * 3600) * 1000).toISOString().slice(0, 10);
async function hist(t) {
  for (let a = 1; a <= 3; a++) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${t}.KW?range=5y&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" }, signal: AbortSignal.timeout(25000) });
      if (r.status === 404) return null; if (!r.ok) throw new Error(r.status);
      const res = (await r.json()).chart.result[0], q = res.indicators.quote[0], m = new Map();
      res.timestamp.forEach((ts, i) => { if (q.close[i] > 0) m.set(kd(ts), { o: q.open[i] || q.close[i], h: q.high[i] || q.close[i], l: q.low[i] || q.close[i], c: q.close[i], v: q.volume[i] || 0 }); });
      return m;
    } catch (e) { if (a === 3) return null; await new Promise((r) => setTimeout(r, 1500 * a)); }
  }
}
const H = {}; let cur = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (cur < tickers.length) { const t = tickers[cur++]; H[t] = await hist(t); await new Promise((r) => setTimeout(r, 150)); } }));
const loaded = tickers.filter((t) => H[t]?.size > 300);
const cnt = new Map(); for (const t of loaded) for (const d of H[t].keys()) cnt.set(d, (cnt.get(d) || 0) + 1);
const dates = [...cnt].filter(([, n]) => n >= loaded.length * 0.4).map(([d]) => d).sort(); const T = dates.length;
const S = {};
for (const t of loaded) {
  const o = [], h = [], l = [], c = [], v = [], tr = []; let last = null;
  for (const d of dates) { const r = H[t].get(d); if (r) { last = r; o.push(r.o); h.push(r.h); l.push(r.l); c.push(r.c); v.push(r.v); tr.push(true); } else { o.push(last?.c ?? null); h.push(last?.c ?? null); l.push(last?.c ?? null); c.push(last?.c ?? null); v.push(0); tr.push(false); } }
  S[t] = { o, h, l, c, v, tr, start: c.findIndex((x) => x != null) };
}
// --- corporate-action guard: daily moves beyond 35% are treated as data breaks
const brk = {}; for (const t of loaded) { const c = S[t].c; brk[t] = c.map((x, i) => i > 0 && x != null && c[i - 1] != null && Math.abs(x / c[i - 1] - 1) > 0.35); }
const lastBreak = (t, i, n) => { for (let k = i; k > i - n && k > 0; k--) if (brk[t][k]) return true; return false; };
// --- market proxy (cap-weighted, chain-linked)
const shares = {}; for (const t of loaded) { const s = snap.stocks[t]; if (s.marketCapKwd > 0 && s.close > 0) shares[t] = s.marketCapKwd / s.close; }
const mkt = [1000]; for (let i = 1; i < T; i++) { let wr = 0, w = 0; for (const t in shares) { const c = S[t].c; if (c[i] == null || c[i - 1] == null || brk[t][i]) continue; const ww = shares[t] * c[i - 1]; wr += ww * (c[i] / c[i - 1] - 1); w += ww; } mkt.push(mkt[i - 1] * (1 + (w ? wr / w : 0))); }
// --- indicator helpers
const sma = (a, i, n) => { if (i + 1 < n) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) { if (a[k] == null) return null; s += a[k]; } return s / n; };
const maxR = (a, i0, i1) => { let m = -Infinity; for (let k = i0; k <= i1; k++) if (a[k] != null && a[k] > m) m = a[k]; return m; };
const minR = (a, i0, i1) => { let m = Infinity; for (let k = i0; k <= i1; k++) if (a[k] != null && a[k] < m) m = a[k]; return m; };
function emaSeries(a, n) { const out = new Array(a.length).fill(null), k = 2 / (n + 1); let e = null; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; e = e == null ? a[i] : a[i] * k + e * (1 - k); out[i] = e; } return out; }
function wilder(a, n) { const out = new Array(a.length).fill(null); let s = null, cntn = 0, acc = 0; for (let i = 0; i < a.length; i++) { if (a[i] == null) continue; if (s == null) { acc += a[i]; cntn++; if (cntn === n) { s = acc / n; out[i] = s; } } else { s = (s * (n - 1) + a[i]) / n; out[i] = s; } } return out; }
const IND = {};
for (const t of loaded) {
  const { h, l, c, v } = S[t], n = T;
  const ema12 = emaSeries(c, 12), ema26 = emaSeries(c, 26), macd = c.map((_, i) => ema12[i] != null && ema26[i] != null ? ema12[i] - ema26[i] : null), sig = emaSeries(macd, 9), ema20 = emaSeries(c, 20);
  const up = c.map((x, i) => i && x != null && c[i - 1] != null ? Math.max(x - c[i - 1], 0) : null), dn = c.map((x, i) => i && x != null && c[i - 1] != null ? Math.max(c[i - 1] - x, 0) : null);
  const au = wilder(up, 14), ad = wilder(dn, 14), rsi = au.map((u, i) => u == null || ad[i] == null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i]));
  const trr = c.map((_, i) => i && h[i] != null && c[i - 1] != null ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])) : null);
  const pdm = c.map((_, i) => { if (!i || h[i] == null || h[i - 1] == null) return null; const u = h[i] - h[i - 1], d = l[i - 1] - l[i]; return u > d && u > 0 ? u : 0; });
  const mdm = c.map((_, i) => { if (!i || h[i] == null || h[i - 1] == null) return null; const u = h[i] - h[i - 1], d = l[i - 1] - l[i]; return d > u && d > 0 ? d : 0; });
  const atr = wilder(trr, 14), sp = wilder(pdm, 14), sm = wilder(mdm, 14);
  const pdi = atr.map((a, i) => a && sp[i] != null ? 100 * sp[i] / a : null), mdi = atr.map((a, i) => a && sm[i] != null ? 100 * sm[i] / a : null);
  const dx = pdi.map((p, i) => p != null && mdi[i] != null && p + mdi[i] > 0 ? 100 * Math.abs(p - mdi[i]) / (p + mdi[i]) : null), adx = wilder(dx, 14);
  IND[t] = { macd, sig, rsi, ema20, atr, pdi, mdi, adx };
}
// --- breadth regime
const breadth = dates.map((_, i) => { let a = 0, e = 0; for (const t of loaded) { const c = S[t].c; if (c[i] == null || i - S[t].start < 49) continue; e++; const m = sma(c, i, 50); if (m && c[i] > m) a++; } return e >= 40 ? a / e : null; });
// 3-month return rank
const ret63 = {}; for (const t of loaded) ret63[t] = S[t].c.map((x, i) => i >= 63 && x != null && S[t].c[i - 63] != null && !lastBreak(t, i, 63) ? x / S[t].c[i - 63] - 1 : null);
const rsRank = dates.map((_, i) => { const arr = loaded.map((t) => [t, ret63[t][i]]).filter((x) => x[1] != null).sort((a, b) => a[1] - b[1]); const m = {}; arr.forEach(([t], k) => m[t] = arr.length > 1 ? k / (arr.length - 1) : 0.5); return m; });

function oldRules(t, i) {
  const { h, l, c, v } = S[t], I = IND[t]; if (i - S[t].start < 252 || !S[t].tr[i] || lastBreak(t, i, 252)) return null;
  const close = c[i], sma20 = sma(c, i, 20), sma50 = sma(c, i, 50), sma200 = sma(c, i, 200), rsi = I.rsi[i], macd = I.macd[i], signal = I.sig[i], adx = I.adx[i], plusDi = I.pdi[i], minusDi = I.mdi[i];
  let sd = 0; for (let k = i - 19; k <= i; k++) sd += (c[k] - sma20) ** 2; sd = Math.sqrt(sd / 20); const upper = sma20 + 2 * sd, lower = sma20 - 2 * sd;
  let pv = 0, vv = 0; for (let k = i - 19; k <= i; k++) { pv += c[k] * v[k]; vv += v[k]; } const vwma = vv ? pv / vv : null;
  const high20 = maxR(h, i - 20, i), month = c[i - 21] ? (close / c[i - 21] - 1) * 100 : null, avg10 = sma(v, i, 10), relVol = avg10 > 0 ? v[i] / avg10 : null, high52 = maxR(h, i - 251, i);
  const ck = { trend: close > sma20 && sma20 > sma50, longTrend: sma50 > sma200, momentum: macd > signal, rsi: rsi >= 52 && rsi <= 72, volume: relVol >= 1.2, dmi: adx >= 25 && plusDi > minusDi, month: month > 0, near20: close >= high20 * .995, near52: close >= high52 * .99, bbBreak: close > upper, vwma: close > vwma };
  const bw = sma20 > 0 ? (upper - lower) / sma20 : null, setups = [];
  if (ck.near20 && ck.trend && ck.volume && ck.rsi) setups.push("20d"); if (ck.near52 && ck.trend && ck.volume && ck.rsi) setups.push("52w"); if (ck.bbBreak && ck.volume && ck.momentum) setups.push("bb");
  if (bw != null && bw <= .08 && close >= upper * .995 && ck.volume && ck.momentum) setups.push("sq"); if (ck.trend && ck.dmi && ck.momentum && ck.month) setups.push("adx");
  if (ck.trend && ck.momentum && ck.rsi && relVol >= 1.5 && ck.month) setups.push("volmom"); if (ck.trend && ck.longTrend && ck.dmi && ck.month) setups.push("ma"); if (ck.near20 && ck.vwma && ck.volume && ck.momentum) setups.push("vwma");
  if (!(ck.volume && setups.some((s) => ["20d", "52w", "bb", "sq", "vwma"].includes(s)))) return null;
  const pil = [ck.near20 || ck.near52 || ck.bbBreak, ck.trend && ck.longTrend, ck.momentum && ck.dmi, ck.rsi && ck.month, ck.volume, bw != null && bw <= .08];
  return { score: pil.filter(Boolean).length, value: close / 1000 * v[i] };
}
function newRules(t, i) {
  const { h, l, c, v, tr } = S[t], I = IND[t]; if (i - S[t].start < 252 || !tr[i] || lastBreak(t, i, 252)) return null;
  let val20 = 0, days = 0; for (let k = i - 19; k <= i; k++) { val20 += c[k] / 1000 * v[k]; if (tr[k] && v[k] > 0) days++; } val20 /= 20;
  if (val20 < 100000 || days < 18 || c[i] < 50) return null;
  const prevHigh20 = maxR(h, i - 20, i - 1), prevHigh250 = maxR(h, i - 250, i - 1);
  const sma20 = sma(c, i, 20), sma50 = sma(c, i, 50), sma200 = sma(c, i, 200), sma50ago = sma(c, i - 10, 50);
  let sd = 0; for (let k = i - 19; k <= i; k++) sd += (c[k] - sma20) ** 2; sd = Math.sqrt(sd / 20); const upper = sma20 + 2 * sd;
  const bw = (i0) => { const m = sma(c, i0, 20); let s = 0; for (let k = i0 - 19; k <= i0; k++) s += (c[k] - m) ** 2; return 4 * Math.sqrt(s / 20) / m; };
  const bwHist = []; for (let k = i - 125; k <= i - 1; k++) bwHist.push(bw(k)); const bwMinRecent = Math.min(...bwHist.slice(-5)), bwSorted = [...bwHist].sort((a, b) => a - b), bwP20 = bwSorted[Math.floor(bwSorted.length * 0.2)];
  const range = c[i] > prevHigh20 * 1.005, high52 = c[i] > prevHigh250, squeeze = bwMinRecent <= bwP20 && c[i] > upper;
  if (!(range || high52 || squeeze)) return null;
  const avgV20 = sma(v, i - 1, 20) || 0, v3 = (v[i] + v[i - 1] + v[i - 2]) / 3;
  const volOk = avgV20 > 0 && v[i] >= 1.5 * avgV20 && v3 >= 1.2 * avgV20;
  const trendOk = c[i] > sma50 && (sma50 > sma200 || sma50 > sma50ago);
  const rs = rsRank[i][t] ?? 0, rsOk = rs >= 0.7;
  const dayRange = h[i] - l[i], closeLoc = dayRange > 0 ? (c[i] - l[i]) / dayRange : 1, closeOk = closeLoc >= 0.75;
  const ext = c[i] / sma20 - 1, extOk = ext <= 0.08;
  let score = 0; score += volOk ? 25 : 0; score += trendOk ? 20 : 0; score += rsOk ? 20 + 10 * (rs - 0.7) / 0.3 : 0; score += closeOk ? 15 : 0; score += extOk ? 10 : 0;
  const level = high52 ? prevHigh250 : range ? prevHigh20 : upper;
  return { score, volOk, trendOk, rsOk, closeOk, extOk, value: val20, setup: high52 ? "52w" : range ? "range" : "squeeze", required: volOk && trendOk,
    close: c[i], level, stop: Math.max(level * 0.98, c[i] - 1.5 * (I.atr[i] || 0)), ext: ext * 100, volRatio: avgV20 ? v[i] / avgV20 : null, rs: rs * 100, closeLoc: closeLoc * 100, sma50, atr: I.atr[i] };
}
// --- evaluate
const H5 = [5, 10, 20];
function evaluate(name, fn, pick, opts = {}) {
  const lastSig = {}, sig = [];
  for (let i = 260; i < T - 20; i++) {
    const regimeWeak = breadth[i] != null && breadth[i] < 0.3;
    for (const t of loaded) {
      const r = fn(t, i); if (!r || !pick(r, regimeWeak)) continue;
      if (lastSig[t] != null && i - lastSig[t] < 10) continue; lastSig[t] = i;
      const c = S[t].c, row = { d: dates[i], t, weak: regimeWeak, value: r.value };
      let bad = false;
      for (const h of H5) { if (lastBreak(t, i + h, h)) { bad = true; break; } row["r" + h] = c[i + h] / c[i] - 1; row["x" + h] = row["r" + h] - (mkt[i + h] / mkt[i] - 1); }
      if (!bad) { row.next = S[t].o[i + 1] ? c[i + 10] / S[t].o[i + 1] - 1 - (mkt[i + 10] / mkt[i] - 1) : null; sig.push(row); }
    }
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)]; };
  const st = (rows) => { const o = { n: rows.length }; for (const h of H5) { const r = rows.map((x) => x["r" + h]), x = rows.map((x) => x["x" + h]); if (!r.length) continue; o["avg" + h] = +(r.reduce((a, b) => a + b, 0) / r.length * 100).toFixed(2); o["excess" + h] = +(x.reduce((a, b) => a + b, 0) / x.length * 100).toFixed(2); o["medExcess" + h] = +(q(x, 0.5) * 100).toFixed(2); o["beat" + h] = +(x.filter((v) => v > 0).length / x.length * 100).toFixed(0); o["up" + h] = +(r.filter((v) => v > 0).length / r.length * 100).toFixed(0); o["worst5pct" + h] = +(q(r, 0.05) * 100).toFixed(1); } const nx = rows.map((x) => x.next).filter((x) => x != null); if (nx.length) o.excess10NextOpen = +(nx.reduce((a, b) => a + b, 0) / nx.length * 100).toFixed(2); return o; };
  const years = {}; for (const r of sig) (years[r.d.slice(0, 4)] ??= []).push(r);
  return { name, all: st(sig), weakMarket: st(sig.filter((r) => r.weak)), normalMarket: st(sig.filter((r) => !r.weak)), illiquidShare: +(sig.filter((r) => r.value < 50000).length / Math.max(1, sig.length) * 100).toFixed(0), perYear: Object.fromEntries(Object.entries(years).map(([y, r]) => [y, st(r)])), sessions: T - 280 };
}
// per-setup stats and recent example days
const perSetup = {};
for (const setup of ["range", "52w", "squeeze"]) perSetup[setup] = evaluate(setup, (t, i) => { const r = newRules(t, i); return r && r.setup === setup ? r : null; }, (r) => r.required).all;
const recent = [];
for (let i = T - 1; i >= T - 120 && recent.length < 4; i--) {
  const rows = loaded.map((t) => { const r = newRules(t, i); return r && r.required ? { t, name: snap.stocks[t].name, nameAr: snap.stocks[t].nameArabic, ...r, fwd10: i + 10 < T ? S[t].c[i + 10] / S[t].c[i] - 1 - (mkt[i + 10] / mkt[i] - 1) : null } : null; }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (rows.length >= 2) recent.push({ date: dates[i], breadth: breadth[i], rows });
}
await writeFile("probe/result.json", JSON.stringify({ perSetup, recent, todayBreadth: breadth[T - 1], lastDate: dates[T - 1] }, null, 1));
