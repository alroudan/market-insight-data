import { writeFile } from "node:fs/promises";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const out = { yahoo: {}, cnbc: {}, cnbcHist: {} };
for (const s of ["^N225","^HSI","000001.SS","^KS11","^BSESN","CL=F","BZ=F"]) {
  const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=5d&interval=1d`, { headers: { "user-agent": UA } });
  const res = (await r.json()).chart?.result?.[0], m = res?.meta, off = m?.gmtoffset || 0;
  out.yahoo[s] = { rows: res.timestamp.map((t, i) => [new Date((t + off) * 1000).toISOString().slice(0, 16), res.indicators.quote[0].close[i]]), rmp: m.regularMarketPrice, rmt: new Date(m.regularMarketTime * 1000).toISOString(), prevClose: m.chartPreviousClose, inst: m.instrumentType, exch: m.exchangeName, sym: m.symbol, name: m.shortName };
}
const q = await fetch("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=%40CL.1%7C%40LCO.1%7C.N225%7C.KS11&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json", { headers: { "user-agent": UA } });
for (const x of (await q.json()).FormattedQuoteResult.FormattedQuote) out.cnbc[x.symbol] = [x.name, x.last, x.change_pct, x.previous_day_closing, x.last_timedate];
for (const s of [".KS11", ".N225", ".HSI"]) { const r = await fetch(`https://ts-api.cnbc.com/harmony/app/charts/5D.json?symbol=${s}`, { headers: { "user-agent": UA } }); const j = await r.json(); out.cnbcHist[s] = (j.barData?.priceBars || []).filter((b, i, a) => i === a.length - 1 || b.tradeTime.slice(0, 8) !== a[i + 1].tradeTime.slice(0, 8)).map((b) => [b.tradeTime, b.close]); }
for (const s of [".KS11", ".N225"]) { const r = await fetch(`https://ts-api.cnbc.com/harmony/app/charts/1M.json?symbol=${s}`, { headers: { "user-agent": UA } }); const j = await r.json(); out.cnbcHist[s + "_1M"] = (j.barData?.priceBars || []).slice(-6).map((b) => [b.tradeTime, b.close]); }
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
