import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
for (const s of [".MSX30", ".MSM30", ".MSXI", ".MSM", ".OMSX30", "MSX30", ".MSI30", ".MSXSI", ".OMAN"]) {
  try { const r = await fetch(`https://ts-api.cnbc.com/harmony/app/charts/1Y.json?symbol=${encodeURIComponent(s)}`, { headers: { "user-agent": UA } }); const j = await r.json(); const b = j.barData?.priceBars || []; out[s] = b.length ? { n: b.length, last: b.at(-1) } : j.statusMessage; } catch (e) { out[s] = e.message; }
}
try { const r = await fetch("https://quote.cnbc.com/quote-html-webservice/restQuote/symbolType/symbol?symbols=.MSX30%7C.MSM30%7C.MSXI%7C.MSM&requestMethod=itv&noform=1&partnerId=2&fund=1&exthrs=1&output=json", { headers: { "user-agent": UA } }); out.quotes = (await r.text()).slice(0, 1500); } catch (e) { out.quotes = e.message; }
try { const r = await fetch("https://symlookup.cnbc.com/symservice/symlookup.do?prefix=muscat&partnerid=20064&pgok=1&pgsize=20", { headers: { "user-agent": UA } }); out.lookup = (await r.text()).slice(0, 2000); } catch (e) { out.lookup = e.message; }
try { const r = await fetch("https://symlookup.cnbc.com/symservice/symlookup.do?prefix=MSX&partnerid=20064&pgok=1&pgsize=20", { headers: { "user-agent": UA } }); out.lookup2 = (await r.text()).slice(0, 2000); } catch (e) { out.lookup2 = e.message; }
try { const r = await fetch("https://tradingeconomics.com/oman/stock-market", { headers: { "user-agent": UA } }); const t = await r.text(); out.te = { st: r.status, desc: (t.match(/name="description" content="([^"]+)"/) || [])[1] }; } catch (e) { out.te = e.message; }
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
