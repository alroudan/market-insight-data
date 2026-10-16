import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const reqs = [];
p.on("response", async (res) => { const u = res.url(); if (/msx\.om/.test(u) && /aspx\//i.test(u)) { let body = ""; try { body = (await res.text()).slice(0, 800); } catch {} reqs.push({ u, post: res.request().postData(), body }); } });
await p.goto("https://www.msx.om/", { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForTimeout(6000);
out.links = await p.$$eval("a", (as) => [...new Set(as.map((a) => a.textContent.trim().replace(/\s+/g, " ") + " => " + a.href).filter((h) => /statist|trend|chart|histor|index|indices/i.test(h)))].slice(0, 50));
const before = reqs.length;
for (const label of ["TREND", "1M", "3M", "1Y", "1 Month", "1 Year"]) { const l = p.getByText(label, { exact: true }); if (await l.count()) { await l.first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(3000); } }
out.trendReqs = reqs.slice(before).filter((r) => !/MarketToday|TopGLVT|HeatMap|Notifications|SummaryTips/.test(r.u));
out.scriptsWithChart = await p.evaluate(() => [...document.scripts].map((s) => s.textContent).filter((t) => /Chart|chart|Trend/.test(t)).map((t) => t.slice(0, 1500)).slice(0, 4));
await p.goto("https://www.msx.om/market-watch-history.aspx", { waitUntil: "domcontentloaded" }).catch(() => {}); await p.waitForTimeout(4000);
out.histSelects = await p.$$eval("select", (els) => els.map((e) => ({ id: e.id, opts: [...e.options].slice(0, 12).map((o) => o.value + "=" + o.text) })));
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
