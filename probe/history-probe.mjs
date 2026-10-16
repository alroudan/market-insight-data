import { writeFile } from "node:fs/promises";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const syms = [".KWSEAS",".BKA",".TASI",".DFMGI",".FTFADGI",".ADI",".QSI",".BAX",".MSX30",".SPX",".DJI",".IXIC",".RUT",".STOXX50E",".FTSE",".GDAXI",".FCHI",".N225",".HSI",".SSEC",".KS11",".BSESN","@LCO.1","@CL.1","@GC.1","BTC.CM=","XBT="];
const out = {};
for (let i = 0; i < syms.length; i += 9) {
  const chunk = syms.slice(i, i + 9).map(encodeURIComponent).join("%7C");
  const r = await fetch(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${chunk}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json&events=1`, { headers: { "user-agent": UA } });
  const j = await r.json();
  for (const q of j.FormattedQuoteResult?.FormattedQuote || []) out[q.symbol] = q.code === 0 ? { name: q.name, last: q.last, chg: q.change_pct, prev: q.previous_day_closing, time: q.last_time, timedate: q.last_timedate, ext: q.ExtendedMktQuote?.last } : { err: q.code };
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
