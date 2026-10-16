import { writeFile } from "node:fs/promises";
const out = { tv: {}, msx: {} };
// 1) TradingView daily bars over the public (unauthenticated, delayed) websocket feed
function tvBars(symbol, n = 300) {
  return new Promise((resolve) => {
    const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket?type=chart", { headers: { Origin: "https://www.tradingview.com" } });
    const rnd = () => Math.random().toString(36).slice(2, 12);
    const cs = "cs_" + rnd();
    const send = (m, p) => { const s = JSON.stringify({ m, p }); ws.send("~m~" + s.length + "~m~" + s); };
    let bars = null, log = [];
    const t = setTimeout(() => { try { ws.close(); } catch {} resolve({ err: "timeout", log: log.slice(0, 5) }); }, 25000);
    ws.onopen = () => {
      send("set_auth_token", ["unauthorized_user_token"]);
      send("chart_create_session", [cs, ""]);
      send("resolve_symbol", [cs, "sds_sym_1", "=" + JSON.stringify({ symbol, adjustment: "splits" })]);
      send("create_series", [cs, "sds_1", "s1", "sds_sym_1", "1D", n, ""]);
    };
    ws.onmessage = (ev) => {
      const data = String(ev.data);
      for (const part of data.split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith("~h~")) { const s = part; ws.send("~m~" + s.length + "~m~" + s); continue; }
        let j; try { j = JSON.parse(part); } catch { continue; }
        if (log.length < 8) log.push(j.m);
        if (j.m === "timescale_update" || j.m === "du") { const s = j.p?.[1]?.sds_1?.s; if (s) bars = s.map((b) => b.v); }
        if (j.m === "series_completed" || j.m === "symbol_error" || j.m === "critical_error") { clearTimeout(t); ws.close(); resolve(bars ? { n: bars.length, first: bars[0], last: bars.at(-1) } : { err: j.m, p: JSON.stringify(j.p).slice(0, 200), log }); }
      }
    };
    ws.onerror = (e) => { clearTimeout(t); resolve({ err: "ws error " + (e.message || "") }); };
  });
}
for (const s of ["TADAWUL:TASI", "QSE:GNRI", "BAHRAIN:BHBX", "MSX:MSX30", "MSM:MSX30"]) out.tv[s] = await tvBars(s);
// 2) msx.om index pages: find a history endpoint
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const { chromium } = await import("playwright");
const b = await chromium.launch(); const p = await b.newPage({ userAgent: UA });
const reqs = [];
p.on("response", async (res) => { const u = res.url(); if (/msx\.om/.test(u) && /aspx\/|ashx|json/i.test(u)) { let body = ""; try { body = (await res.text()).slice(0, 300); } catch {} reqs.push({ u, body, post: res.request().postData() }); } });
for (const url of ["https://www.msx.om/Indices.aspx", "https://www.msx.om/indices.aspx?type=MSX30", "https://www.msx.om/MSX30.aspx", "https://www.msx.om/market-indices.aspx"]) {
  try { const r = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 40000 }); await p.waitForTimeout(6000); out.msx[url] = { st: r?.status(), title: await p.title(), text: (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 600) }; } catch (e) { out.msx[url] = e.message.slice(0, 150); }
}
// links containing "ind" on the home page
await p.goto("https://www.msx.om/", { waitUntil: "domcontentloaded", timeout: 40000 }).catch(() => {});
await p.waitForTimeout(4000);
out.msxLinks = await p.$$eval("a", (as) => [...new Set(as.map((a) => a.href).filter((h) => /ind|histor|chart|trend/i.test(h)))].slice(0, 40)).catch(() => []);
out.msxReqs = reqs.filter((r) => !/MarketToday|TopGLVT|HeatMap|latestnews|decisions|FinancialReports|Announcements|MultiAsset|HeaderAdvertisement|Banners|Notifications|SummaryTips|Tips|MarketTicker|MarketTodayDateTime/.test(r.u)).slice(0, 30);
await b.close();
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
