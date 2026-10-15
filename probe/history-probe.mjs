// Probe 8: read Premier / Main / All-Share tabs of the homepage Market Summary table.
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
const out = { ranAt: new Date().toISOString(), tabs: {} };
const browser = await chromium.launch();
const page = await browser.newPage({ locale: "en-GB", viewport: { width: 1400, height: 1000 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
await page.goto("https://www.boursakuwait.com.kw/en/", { waitUntil: "domcontentloaded", timeout: 45000 });
await page.waitForFunction(() => /Market Summary[\s\S]{0,40}Closed/.test(document.body.innerText), null, { timeout: 60000 }).catch(e => out.waitError = e.message);
const block = async () => { const t = await page.locator("body").innerText(); const k = t.indexOf("Delayed by 15 Minutes"); return t.slice(Math.max(0, k - 80), k + 260).replace(/\s+/g, " "); };
out.default = await block();
for (const name of ["Main Market", "All-Share", "Premier Market"]) {
  try {
    const candidates = page.getByText(name, { exact: true });
    const n = await candidates.count(); out.tabs[name + "_count"] = n;
    let clicked = false;
    for (let i = 0; i < n && !clicked; i++) { const c = candidates.nth(i); const box = await c.boundingBox(); if (!box) continue; const before = await block(); await c.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(2500); const after = await block(); if (after !== before && after.startsWith(name)) { out.tabs[name] = after; clicked = true; } else if (after !== before) { out.tabs[name + "_alt" + i] = after; } }
  } catch (e) { out.tabs[name + "_error"] = e.message; }
}
const t = await page.locator("body").innerText(); const k = t.indexOf("Market Summary"); out.banner = t.slice(Math.max(0, k - 30), k + 160).replace(/\s+/g, " ");
await browser.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
