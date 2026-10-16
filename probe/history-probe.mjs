import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const reqs = [];
p.on("response", async (res) => { const u = res.url(); if (/msx\.om/.test(u) && /aspx\/|ashx|\.json|api/i.test(u) && !/\.js(\?|$)/.test(u)) { let body = ""; try { body = (await res.text()).slice(0, 1500); } catch {} reqs.push({ u, post: res.request().postData(), body }); } });
for (const url of ["https://www.msx.om/market-watch-history.aspx", "https://www.msx.om/page.aspx?b1=Indices&b2=MSX-Indices&mi=&ti=MSX-Indices"]) {
  try { await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForTimeout(8000);
    out[url] = { text: (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 2500),
      forms: await p.$$eval("select,input", (els) => els.map((e) => ({ tag: e.tagName, id: e.id, name: e.name, type: e.type, opts: e.tagName === "SELECT" ? [...e.options].slice(0, 15).map((o) => o.value + "=" + o.text) : undefined })).slice(0, 40)) };
  } catch (e) { out[url] = e.message.slice(0, 200); }
}
out.reqs = reqs.filter((r) => !/MarketToday|TopGLVT|HeatMap|latestnews|decisions|FinancialReports|Announcements|MultiAsset|HeaderAdvertisement|Banners|Notifications|SummaryTips|\/Tips|MarketTicker/.test(r.u));
const html = await p.content(); out.apiRefs = [...new Set(html.match(/api[A-Za-z]*\.aspx\/[A-Za-z]+/g) || [])];
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
