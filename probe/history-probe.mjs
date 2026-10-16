import { writeFile } from "node:fs/promises";
const out = {};
const cols = ["name","description","close","change","Perf.W","Perf.1M","Perf.YTD","Perf.Y","exchange","type","update_mode"];
for (const ex of ["BAHRAIN","BHB","MSM","MSX","OMAN"]) {
  const r = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ filter: [{ left: "exchange", operation: "equal", right: ex }, { left: "type", operation: "equal", right: "index" }], symbols: { query: { types: [] }, tickers: [] }, columns: cols, range: [0, 30] }) });
  const t = await r.text(); try { out[ex] = JSON.parse(t).data?.map((d) => [d.s, ...d.d.slice(0, 4)]); } catch { out[ex] = t.slice(0, 200); }
}
const tickers = ["BAHRAIN:BAX","BAHRAIN:BHSEASI","BAHRAIN:BSEX","BAHRAIN:BHBX","MSM:MSX30","MSM:MSI","MSM:BKMSX30","MSM:MSX30I","TADAWUL:TASI"];
const r = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: { tickers, query: { types: [] } }, columns: cols }) });
out.direct = (await r.json()).data?.map((d) => [d.s, ...d.d.slice(0, 4)]);
// history candidate: TradingView chart history isn't public; try investing-free sources
for (const u of ["https://www.saudiexchange.sa/","https://query1.finance.yahoo.com/v8/finance/chart/%5ETASI.SR?period1=1700000000&period2=1790000000&interval=1d"]) {
  try { const r2 = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } }); const tx = await r2.text(); out[u] = { st: r2.status, len: tx.length, n: (tx.match(/"close":\[([^\]]*)\]/)?.[1] || "").split(",").length }; } catch (e) { out[u] = e.message; }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
