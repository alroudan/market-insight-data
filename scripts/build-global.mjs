// Global markets snapshot for the "Global economy" page: US, Europe, Asia,
// oil, gold and a few macro gauges. Daily history from Yahoo Finance.
import { readFile, writeFile } from "node:fs/promises";

const OUT = new URL("../website/global.json", import.meta.url);
const GROUPS = [
  { id: "us", en: "United States", ar: "الولايات المتحدة", items: [
    ["^GSPC", "S&P 500", "إس آند بي 500", "America/New_York"],
    ["^DJI", "Dow Jones", "داو جونز", "America/New_York"],
    ["^IXIC", "Nasdaq Composite", "ناسداك المركب", "America/New_York"],
    ["^RUT", "Russell 2000", "راسل 2000", "America/New_York"]
  ] },
  { id: "europe", en: "Europe", ar: "أوروبا", items: [
    ["^STOXX50E", "Euro Stoxx 50", "يورو ستوكس 50", "Europe/Berlin"],
    ["^FTSE", "FTSE 100 (UK)", "فوتسي 100 (بريطانيا)", "Europe/London"],
    ["^GDAXI", "DAX (Germany)", "داكس (ألمانيا)", "Europe/Berlin"],
    ["^FCHI", "CAC 40 (France)", "كاك 40 (فرنسا)", "Europe/Paris"]
  ] },
  { id: "asia", en: "Asia", ar: "آسيا", items: [
    ["^N225", "Nikkei 225 (Japan)", "نيكاي 225 (اليابان)", "Asia/Tokyo"],
    ["^HSI", "Hang Seng (Hong Kong)", "هانغ سنغ (هونغ كونغ)", "Asia/Hong_Kong"],
    ["000001.SS", "Shanghai Composite", "شنغهاي المركب", "Asia/Shanghai"],
    ["^KS11", "KOSPI (Korea)", "كوسبي (كوريا)", "Asia/Seoul"],
    ["^BSESN", "Sensex (India)", "سينسكس (الهند)", "Asia/Kolkata"]
  ] },
  { id: "commodities", en: "Oil & gold", ar: "النفط والذهب", items: [
    ["BZ=F", "Brent crude ($/bbl)", "خام برنت (دولار/برميل)", "Europe/London"],
    ["CL=F", "WTI crude ($/bbl)", "خام غرب تكساس (دولار/برميل)", "America/New_York"],
    ["GC=F", "Gold ($/oz)", "الذهب (دولار/أونصة)", "America/New_York"]
  ] },
  { id: "macro", en: "Risk gauges", ar: "مؤشرات المخاطر", items: [
    ["^VIX", "VIX (US volatility)", "مؤشر التقلب VIX", "America/New_York"],
    ["^TNX", "US 10-year yield (%)", "عائد السندات الأمريكية 10 سنوات (%)", "America/New_York"],
    ["DX-Y.NYB", "US dollar index", "مؤشر الدولار الأمريكي", "America/New_York"]
  ] }
];

async function chart(symbol) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=2y&interval=1d`, {
        headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        signal: AbortSignal.timeout(25000)
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const res = (await r.json()).chart?.result?.[0];
      const q = res?.indicators?.quote?.[0];
      if (!res?.timestamp || !q) throw new Error("no data");
      const offset = res.meta?.gmtoffset || 0;
      const rows = res.timestamp.map((ts, i) => [new Date((ts + offset) * 1000).toISOString().slice(0, 10), q.close[i]]).filter((x) => x[1] != null);
      return { rows, meta: res.meta };
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

const pct = (a, b) => (a != null && b ? Math.round((a / b - 1) * 10000) / 100 : null);
const round = (v, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const previous = await readFile(OUT, "utf8").then(JSON.parse).catch(() => null);
const prevById = new Map((previous?.groups || []).flatMap((g) => g.items.map((i) => [i.symbol, i])));

const groups = [];
let ok = 0, failed = [];
for (const group of GROUPS) {
  const items = [];
  for (const [symbol, en, ar, tz] of group.items) {
    try {
      const { rows, meta } = await chart(symbol);
      if (rows.length < 30) throw new Error("short history");
      const last = rows.at(-1), lastDate = last[0], close = last[1];
      const back = (n) => rows[Math.max(0, rows.length - 1 - n)]?.[1];
      const onOrBefore = (date) => { for (let i = rows.length - 1; i >= 0; i -= 1) if (rows[i][0] <= date) return rows[i][1]; return null; };
      const d = new Date(lastDate + "T00:00:00Z");
      const monthAgo = new Date(d); monthAgo.setUTCMonth(d.getUTCMonth() - 1);
      const yearAgo = new Date(d); yearAgo.setUTCFullYear(d.getUTCFullYear() - 1);
      const yearRows = rows.filter((r) => r[0] > yearAgo.toISOString().slice(0, 10)).map((r) => r[1]);
      const live = meta?.regularMarketPrice;
      items.push({
        symbol, en, ar, timezone: tz, currency: meta?.currency || null,
        date: lastDate,
        close: round(close, 2),
        change1d: pct(close, back(1)),
        change1w: pct(close, back(5)),
        change1m: pct(close, onOrBefore(monthAgo.toISOString().slice(0, 10))),
        changeYtd: pct(close, onOrBefore(`${Number(lastDate.slice(0, 4)) - 1}-12-31`)),
        change1y: pct(close, onOrBefore(yearAgo.toISOString().slice(0, 10))),
        high52: round(Math.max(...yearRows), 2), low52: round(Math.min(...yearRows), 2),
        livePrice: live != null && Math.abs(live / close - 1) > 0.00001 ? round(live, 2) : null,
        spark: rows.slice(-66).map((r) => round(r[1], 2))
      });
      ok += 1;
    } catch (error) {
      failed.push(symbol + ": " + error.message);
      const prior = prevById.get(symbol);
      if (prior) items.push({ ...prior, stale: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  groups.push({ id: group.id, en: group.en, ar: group.ar, items });
}
if (ok < 10) throw new Error(`Only ${ok} instruments loaded; keeping previous file. ${failed.join("; ")}`);

// Kuwait link: All-Share from the site's own snapshot, for side-by-side context.
let kuwait = null;
try {
  const snap = JSON.parse(await readFile(new URL("../website/latest.json", import.meta.url), "utf8"));
  const a = snap.allShareIndex;
  if (a?.close) kuwait = { en: "Boursa Kuwait All-Share", ar: "السوق العام - بورصة الكويت", date: snap.tradingDate, close: a.close, change1d: round(a.changePercent), change1m: round(a.performance1MonthPercent), changeYtd: round(a.performanceYtdPercent) };
} catch {}

await writeFile(OUT, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), source: "Yahoo Finance (delayed)", failed, kuwait, groups }) + "\n");
console.log(`Global markets: ${ok} instruments${failed.length ? "; failed " + failed.join(", ") : ""}`);
