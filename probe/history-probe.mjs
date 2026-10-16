import { writeFile } from "node:fs/promises";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const syms = [".DFMGI",".BAX",".MSX30",".SPX",".DJI",".IXIC",".RUT",".STOXX50E",".FTSE",".GDAXI",".FCHI",".N225",".HSI",".SSEC",".KS11","@LCO.1","@CL.2","@GC.1","BTC.CM="];
const out = {};
for (let i = 0; i < syms.length; i += 9) {
  const chunk = syms.slice(i, i + 9).map(encodeURIComponent).join("%7C");
  const r = await fetch(`https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=${chunk}&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json`, { headers: { "user-agent": UA } });
  for (const q of (await r.json()).FormattedQuoteResult?.FormattedQuote || []) out[q.symbol] = { name: q.name, last: q.last, chg: q.change_pct, prev: q.previous_day_closing, timedate: q.last_timedate };
}
// independent check for indices CNBC doesn't carry: TradingView for Sensex, TASI, ADX, QE, Kuwait
const cols = ["close", "change"];
const r = await fetch("https://scanner.tradingview.com/global/scan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: { tickers: ["BSE:SENSEX"], query: { types: [] } }, columns: cols }) });
out.tv = (await r.json()).data?.map((d) => [d.s, ...d.d]);
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
