import { writeFile } from "node:fs/promises";
const C = ["^TASI.SR","^TASI","TASI.SR","^DFMGI","DFMGI.AE","^FTFADGI","FADGI.FGI","^ADI","^FTSEADX","^QSI","^GNRI","^QSE","^BHSEASI","^BAX","BHSEASI.BH","^MSI","^MSX30","MSX30.OM","^OMXSPI","^KWT","^BKP","^KWSE","^XU100"];
const out = {};
for (const s of C) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1mo&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" } });
    const j = await r.json(); const res = j?.chart?.result?.[0]; const m = res?.meta;
    const c = res?.indicators?.quote?.[0]?.close?.filter((x) => x != null) || [];
    out[s] = { http: r.status, name: m?.longName || m?.shortName, ex: m?.exchangeName, tz: m?.exchangeTimezoneName, cur: m?.currency, price: m?.regularMarketPrice, last: res?.timestamp ? new Date(res.timestamp.at(-1) * 1000).toISOString().slice(0, 10) : null, n: c.length, err: j?.chart?.error?.description };
  } catch (e) { out[s] = { err: e.message }; }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
