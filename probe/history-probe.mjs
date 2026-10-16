import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const reqs = [];
p.on("response", async (res) => { const u = res.url(); if (/msx\.om/.test(u) && /aspx/i.test(u) && res.request().resourceType() !== "document") { let body = ""; try { body = (await res.text()).slice(0, 1500); } catch {} reqs.push({ u, post: res.request().postData(), body }); } });
await p.goto("https://www.msx.om/component-track.aspx", { waitUntil: "domcontentloaded", timeout: 45000 }); await p.waitForTimeout(7000);
out.text = (await p.locator("body").innerText()).replace(/\s+/g, " ").split("Our Profile ع")[1]?.slice(0, 1500);
out.selects = await p.$$eval("select", (els) => els.map((e) => ({ id: e.id, opts: [...e.options].slice(0, 25).map((o) => o.value + "=" + o.text) })));
out.buttons = await p.$$eval("button,input[type=button],input[type=submit],a.btn", (els) => els.map((e) => (e.id || "") + ":" + (e.value || e.textContent).trim()).slice(0, 20));
const n0 = reqs.length;
try { const sel = await p.$$("select"); for (const s of sel) { const id = await s.getAttribute("id"); const opts = await s.$$eval("option", (o) => o.map((x) => x.value)); if (opts.includes("1Y")) await s.selectOption("1Y"); else if (opts.some((v) => /MSX30|MSX 30/i.test(v))) await s.selectOption(opts.find((v) => /MSX30|MSX 30/i.test(v))); } } catch (e) { out.selErr = e.message; }
for (const label of ["Show", "Search", "Go", "Submit"]) { const l = p.getByText(label, { exact: true }); if (await l.count()) { await l.first().click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(5000); break; } }
out.after = (await p.locator("body").innerText()).replace(/\s+/g, " ").split("Our Profile ع")[1]?.slice(0, 2000);
out.reqs = reqs.filter((r) => !/MarketTicker|GetmarketSectors|Getmarkets/.test(r.u));
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
