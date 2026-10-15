// Temporary probe: can GitHub-hosted runners load ~2-3 years of daily history?
import { readFile, writeFile } from "node:fs/promises";
const snap = JSON.parse(await readFile("website/latest.json", "utf8"));
const tickers = Object.keys(snap.stocks);
const alias = { MKHZN: "AGLTY" };
const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" };
async function yahoo(symbol) {
  for (const host of ["query1", "query2"]) {
    try {
      const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1d&events=div,split`, { headers: ua, signal: AbortSignal.timeout(20000) });
      if (!r.ok) { if (host === "query2") return { error: "HTTP " + r.status }; continue; }
      const j = await r.json(); const res = j.chart?.result?.[0];
      if (!res?.timestamp) return { error: j.chart?.error?.description || "no data" };
      const q = res.indicators.quote[0];
      const rows = res.timestamp.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), q.close[i], q.volume[i]]).filter(r => r[1] != null);
      return { currency: res.meta.currency, rows: rows.length, first: rows[0]?.[0], last: rows.at(-1)?.[0], lastClose: rows.at(-1)?.[1], nullCloses: res.timestamp.length - rows.length, zeroVolDays: rows.filter(r => !r[2]).length };
    } catch (e) { if (host === "query2") return { error: e.message }; }
  }
}
const out = { ranAt: new Date().toISOString(), indexes: {}, stocks: {}, boursa: {} };
for (const s of ["^BKP.KW", "^BKM.KW", "^BKA.KW", "^BKX.KW", "^KWSE"]) out.indexes[s] = await yahoo(s);
let i = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (i < tickers.length) {
    const t = tickers[i++];
    const y = await yahoo((alias[t] || t) + ".KW");
    out.stocks[t] = { ...y, tvClose: snap.stocks[t].close };
    await new Promise(r => setTimeout(r, 250));
  }
}));
// Boursa Kuwait: does an index history endpoint answer from runners?
for (const [name, url] of Object.entries({
  dailyReportAll: "https://www.boursakuwait.com.kw/data-api/client-services?L=E&DT=1&MT=A&RT=3522"
})) {
  try { const r = await fetch(url, { headers: ua, signal: AbortSignal.timeout(15000) }); out.boursa[name] = { status: r.status, sample: (await r.text()).slice(0, 300) }; }
  catch (e) { out.boursa[name] = { error: e.message }; }
}
const ok = Object.values(out.stocks).filter(s => s.rows >= 480);
out.summary = { stocks: tickers.length, withTwoYears: ok.length, withAny: Object.values(out.stocks).filter(s => s.rows > 0).length };
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.summary));
