import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
for (const ep of ["Indices", "MarketToday"]) {
  try {
    const r = await fetch("https://www.msx.om/api.aspx/" + ep, { method: "POST", headers: { "user-agent": UA, "content-type": "application/json; charset=utf-8", accept: "application/json", referer: "https://www.msx.om/", origin: "https://www.msx.om", "x-requested-with": "XMLHttpRequest" }, body: "{}" });
    out["direct_" + ep] = { st: r.status, body: (await r.text()).slice(0, 4000) };
  } catch (e) { out["direct_" + ep] = e.message; }
}
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const reqs = [];
p.on("request", (q) => { if (q.url().includes("api.aspx")) reqs.push({ u: q.url(), m: q.method(), body: q.postData() }); });
try { await p.goto("https://www.msx.om/", { waitUntil: "domcontentloaded", timeout: 60000 }); } catch (e) { out.gotoErr = e.message; }
await p.waitForTimeout(12000);
out.reqs = reqs.slice(0, 40);
out.inPage = await p.evaluate(async () => { const r = await fetch("/api.aspx/Indices", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: "{}" }); return { st: r.status, body: (await r.text()).slice(0, 4000) }; }).catch((e) => e.message);
// look for index history / chart endpoints in page scripts
out.chartRefs = await p.evaluate(() => [...new Set((document.documentElement.innerHTML.match(/api\.aspx\/[A-Za-z]+/g) || []))]);
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
