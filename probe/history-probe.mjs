// Probe 5: Yahoo data quality vs TradingView (52-week range) and unadjusted corporate actions.
import { readFile, writeFile } from "node:fs/promises";
const snap = JSON.parse(await readFile("website/latest.json", "utf8"));
const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
const out = { stocks: {} }; const tickers = Object.keys(snap.stocks); let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => { while (i < tickers.length) { const t = tickers[i++];
  try { const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${t}.KW?range=3y&interval=1d&events=div,split`, { headers: ua });
    const res = (await r.json()).chart.result[0]; const q = res.indicators.quote[0];
    const rows = res.timestamp.map((ts, k) => ({ d: new Date(ts * 1000).toISOString().slice(0, 10), c: q.close[k], h: q.high[k], l: q.low[k], v: q.volume[k] })).filter(x => x.c != null);
    const yr = rows.filter(x => x.d >= new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
    const jumps = rows.slice(1).map((x, k) => ({ d: x.d, r: x.c / rows[k].c - 1 })).filter(x => Math.abs(x.r) > 0.2);
    const s = snap.stocks[t];
    out.stocks[t] = { rows: rows.length, hi52: Math.max(...yr.map(x => x.h ?? x.c)), lo52: Math.min(...yr.map(x => x.l ?? x.c)), tvHi: s.high52Week, tvLo: s.low52Week, jumps: jumps.slice(0, 3), splits: Object.keys(res.events?.splits || {}).length };
  } catch (e) { out.stocks[t] = { error: e.message }; } await new Promise(r => setTimeout(r, 200)); } }));
await writeFile("probe/result.json", JSON.stringify(out));
