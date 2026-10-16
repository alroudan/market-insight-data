import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
try {
  const r = await fetch("https://www.msx.om/", { headers: { "user-agent": UA } });
  const t = await r.text();
  out.home = { st: r.status, len: t.length, msx30: [...t.matchAll(/.{0,200}MSX ?30.{0,300}/gi)].slice(0, 6).map((m) => m[0].replace(/\s+/g, " ")), scripts: [...t.matchAll(/src="([^"]+\.js[^"]*)"/g)].map((m) => m[1]).slice(0, 30), apis: [...new Set([...t.matchAll(/["'](\/[A-Za-z0-9_\-\/]*(?:api|ajax|handler|ashx|asmx|json|Index|index)[A-Za-z0-9_\-\/.?=&]*)["']/g)].map((m) => m[1]))].slice(0, 60) };
} catch (e) { out.home = e.message; }
// Browser: capture network JSON responses and page text
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const net = [];
p.on("response", async (res) => { const u = res.url(); const ct = res.headers()["content-type"] || ""; if (/json|javascript|text\/plain|xml/.test(ct) && !/\.js(\?|$)/.test(u)) { let body = ""; try { body = (await res.text()).slice(0, 400); } catch {} net.push({ u, st: res.status(), ct, body }); } });
try { await p.goto("https://www.msx.om/", { waitUntil: "networkidle", timeout: 60000 }); } catch (e) { out.gotoErr = e.message; }
await p.waitForTimeout(5000);
const text = await p.locator("body").innerText().catch(() => "");
out.text = text.replace(/\s+/g, " ").slice(0, 3000);
out.net = net.slice(0, 60);
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
