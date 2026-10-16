import { writeFile } from "node:fs/promises";
const out = { yahoo: {}, tv: null };
for (const s of ["^TASI.SR","DFMGI.AE","FADGI.FGI"]) for (const range of ["2y","1y","ytd"]) {
  const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=${range}&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } });
  const j = await r.json(); const res = j?.chart?.result?.[0];
  const c = res?.indicators?.quote?.[0]?.close || [];
  out.yahoo[s + " " + range] = { n: c.filter((x) => x != null).length, ts: (res?.timestamp || []).length, first: res?.timestamp ? new Date(res.timestamp[0] * 1000).toISOString().slice(0, 10) : null };
}
const tickers = ["TADAWUL:TASI","DFM:DFMGI","ADX:FADGI","ADX:ADI","QSE:GNRI","BAHRAIN:BSEX","BAHRAIN:BAX","MSM:MSX30","MSM:MSI","KSE:BKA","KSE:BKP"];
const cols = ["name","description","close","change","Perf.W","Perf.1M","Perf.YTD","Perf.Y","price_52_week_high","price_52_week_low","currency","exchange"];
const r = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" }, body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns: cols }) });
out.tvStatus = r.status; const t = await r.text();
try { out.tv = JSON.parse(t).data.map((d) => ({ s: d.s, ...Object.fromEntries(cols.map((c, i) => [c, d.d[i]])) })); } catch { out.tv = t.slice(0, 500); }
// TradingView history via the public chart data used by widgets is not available; try stooq for history
out.stooq = {};
for (const s of ["^tasi","tasi.sa","^dfm","^adx","^qse","^bhb","^msm"]) {
  try { const r2 = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`); const tx = await r2.text(); out.stooq[s] = { st: r2.status, lines: tx.split("\n").length, head: tx.slice(0, 120), tail: tx.trim().split("\n").slice(-1)[0] }; } catch (e) { out.stooq[s] = e.message; }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
