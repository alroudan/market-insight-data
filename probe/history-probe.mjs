// Probe 6: which endpoint feeds the homepage All-Share "Market Summary" widget?
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const out = { ranAt: new Date().toISOString(), requests: [], report: null, text: null };
try { const r = await fetch("https://www.boursakuwait.com.kw/data-api/client-services?L=E&DT=1&MT=A&RT=3522", { headers: { "user-agent": "Mozilla/5.0 Market Insight EOD collector", accept: "application/json" } }); const j = await r.json(); out.report = j["Market Summary"]?.[0]; } catch (e) { out.report = e.message; }
const browser = await chromium.launch();
const page = await browser.newPage({ locale: "en-GB", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
page.on("response", async (res) => {
  const url = res.url();
  if (!/boursakuwait/.test(url) || /\.(png|jpg|svg|css|woff2?|ttf|ico|gif|webp)(\?|$)/i.test(url)) return;
  let body = ""; try { body = (await res.text()).slice(0, 400); } catch {}
  out.requests.push({ url: url.slice(0, 300), status: res.status(), type: res.request().resourceType(), body: /Turnover|Value|Market Summary|All-Share|Index/i.test(body) ? body : body.slice(0, 80) });
});
await page.goto("https://www.boursakuwait.com.kw/en/", { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => out.gotoError = e.message);
await page.waitForTimeout(30000);
const text = await page.locator("body").innerText().catch(() => "");
const k = text.lastIndexOf("Market Summary"); out.text = text.slice(Math.max(0, k - 50), k + 700);
await browser.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
