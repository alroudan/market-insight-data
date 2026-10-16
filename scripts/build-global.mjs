// Global markets snapshot for the "Global economy" page: GCC, US, Europe, Asia,
// oil (including Kuwait Export Crude), gold and Bitcoin. Daily history from Yahoo Finance.
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
  { id: "commodities", en: "Oil, gold & Bitcoin", ar: "النفط والذهب والبيتكوين", items: [
    ["BZ=F", "Brent crude ($/bbl)", "خام برنت (دولار/برميل)", "Europe/London"],
    ["CL=F", "WTI crude ($/bbl)", "خام غرب تكساس (دولار/برميل)", "America/New_York"],
    ["GC=F", "Gold ($/oz)", "الذهب (دولار/أونصة)", "America/New_York"],
    ["BTC-USD", "Bitcoin ($)", "بيتكوين (دولار)", "UTC"]
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
      const period = meta?.currentTradingPeriod?.regular, nowSec = Date.now() / 1000;
      const open = period ? nowSec >= period.start && nowSec <= period.end : false;
      const bps = symbol === "^TNX";
      const diff = (b) => (b != null ? Math.round((close - b) * 100) : null);
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
        spark: rows.slice(-66).map((r) => round(r[1], 2)),
        open,
        ...(bps ? { unit: "yield", bps1d: diff(back(1)), bps1w: diff(back(5)), bps1m: diff(onOrBefore(monthAgo.toISOString().slice(0, 10))), bpsYtd: diff(onOrBefore(`${Number(lastDate.slice(0, 4)) - 1}-12-31`)), bps1y: diff(onOrBefore(yearAgo.toISOString().slice(0, 10))) } : {})
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
// Kuwait Export Crude (KEC) price as published by Boursa Kuwait (from KPC).
try {
  const r = await fetch("https://www.boursakuwait.com.kw/data-api/client-services?RT=3521", {
    headers: { "user-agent": "Mozilla/5.0 Market Insight EOD collector", accept: "application/json" }, signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  const kop = ((await r.json()).KOP || [])
    .map((x) => ({ date: String(x.Date || "").slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3"), value: Number(x.Value), chg: Number(x.Pchg) }))
    .filter((x) => x.date.length === 10 && x.value > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!kop.length) throw new Error("no Kuwait oil price");
  const lastK = kop.at(-1), backK = (n) => kop[Math.max(0, kop.length - 1 - n)]?.value;
  const onOrBeforeK = (date) => { for (let i = kop.length - 1; i >= 0; i -= 1) if (kop[i].date <= date) return kop[i].value; return null; };
  const dk = new Date(lastK.date + "T00:00:00Z"), mK = new Date(dk); mK.setUTCMonth(dk.getUTCMonth() - 1);
  const enough = (n) => kop.length > n;
  const kec = {
    symbol: "KEC", en: "Kuwait crude ($/bbl)", ar: "خام الكويت (دولار/برميل)", timezone: "Asia/Kuwait", currency: "USD",
    date: lastK.date, close: round(lastK.value, 2), open: false, source: "Kuwait Petroleum Corporation via Boursa Kuwait",
    change1d: Number.isFinite(lastK.chg) ? round(lastK.chg, 2) : kop.length > 1 ? pct(lastK.value, backK(1)) : null,
    change1w: enough(5) ? pct(lastK.value, backK(5)) : null,
    change1m: enough(15) ? pct(lastK.value, onOrBeforeK(mK.toISOString().slice(0, 10))) : null,
    changeYtd: kop[0].date <= `${Number(lastK.date.slice(0, 4)) - 1}-12-31` ? pct(lastK.value, onOrBeforeK(`${Number(lastK.date.slice(0, 4)) - 1}-12-31`)) : null,
    change1y: (() => { const y = new Date(dk); y.setUTCFullYear(dk.getUTCFullYear() - 1); return kop[0].date <= y.toISOString().slice(0, 10) ? pct(lastK.value, onOrBeforeK(y.toISOString().slice(0, 10))) : null; })(),
    spark: kop.length >= 10 ? kop.slice(-66).map((x) => round(x.value, 2)) : null,
    historyPoints: kop.length
  };
  const commodities = groups.find((g) => g.id === "commodities");
  commodities.items.unshift(kec);
  ok += 1;
} catch (error) {
  failed.push("KEC: " + error.message);
  const prior = prevById.get("KEC");
  if (prior) groups.find((g) => g.id === "commodities").items.unshift({ ...prior, stale: true });
}

// GCC markets: TradingView's public scanner (Yahoo has no daily history for these).
// The scanner gives the latest close and period changes but no dates or history, so the
// trading date comes from each market's week and session times (a close that has not
// changed since the last run keeps its earlier date), and the trend line is built up
// from one close per trading day as this script runs.
const GCC = [
  ["KSE:BKA", "Kuwait All-Share", "الكويت - السوق العام", "Asia/Kuwait", [0, 1, 2, 3, 4], "09:00", "12:40"],
  ["TADAWUL:TASI", "Saudi Arabia (TASI)", "السعودية (تاسي)", "Asia/Riyadh", [0, 1, 2, 3, 4], "10:00", "15:00"],
  ["DFM:DFMGI", "Dubai (DFM)", "دبي (سوق دبي المالي)", "Asia/Dubai", [1, 2, 3, 4, 5], "10:00", "15:00"],
  ["ADX:FADGI", "Abu Dhabi (FTSE ADX)", "أبوظبي (فوتسي سوق أبوظبي)", "Asia/Dubai", [1, 2, 3, 4, 5], "10:00", "15:00"],
  ["QSE:GNRI", "Qatar (QE Index)", "قطر (مؤشر بورصة قطر)", "Asia/Qatar", [0, 1, 2, 3, 4], "09:30", "13:15"],
  ["BAHRAIN:BHBX", "Bahrain All Share", "البحرين - المؤشر العام", "Asia/Bahrain", [0, 1, 2, 3, 4], "09:30", "13:00"]
];
// Daily bars from TradingView's public chart feed (the same delayed data its free charts use).
function tvDailyBars(symbol, count = 300) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket?type=chart", { headers: { Origin: "https://www.tradingview.com" } });
    const session = "cs_" + Math.random().toString(36).slice(2, 12);
    const send = (m, p) => { const msg = JSON.stringify({ m, p }); ws.send("~m~" + msg.length + "~m~" + msg); };
    let bars = null;
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("chart feed timeout")); }, 25000);
    const finish = (fn) => { clearTimeout(timer); try { ws.close(); } catch {} fn(); };
    ws.onopen = () => {
      send("set_auth_token", ["unauthorized_user_token"]);
      send("chart_create_session", [session, ""]);
      send("resolve_symbol", [session, "sym", "=" + JSON.stringify({ symbol, adjustment: "splits" })]);
      send("create_series", [session, "s", "s1", "sym", "1D", count, ""]);
    };
    ws.onmessage = (event) => {
      for (const part of String(event.data).split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith("~h~")) { ws.send("~m~" + part.length + "~m~" + part); continue; }
        let j; try { j = JSON.parse(part); } catch { continue; }
        if (j.m === "timescale_update" || j.m === "du") { const rows = j.p?.[1]?.s?.s; if (rows?.length) bars = rows.map((b) => b.v); }
        if (j.m === "series_completed") finish(() => (bars?.length ? resolve(bars) : reject(new Error("no bars"))));
        if (j.m === "symbol_error" || j.m === "series_error" || j.m === "critical_error") finish(() => reject(new Error(j.m + " " + JSON.stringify(j.p?.slice(2) || ""))));
      }
    };
    ws.onerror = () => finish(() => reject(new Error("chart feed error")));
  });
}
function localParts(tz, date = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" });
  const o = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, dow: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(o.weekday) };
}
function sessionState(tz, days, start, end) {
  const now = localParts(tz);
  if (days.includes(now.dow) && now.hm >= start && now.hm < end) return { open: true, date: now.day };
  let probe = new Date(); if (!(days.includes(now.dow) && now.hm >= end)) probe = new Date(probe.getTime() - 86400000);
  for (let i = 0; i < 10; i += 1) { const p = localParts(tz, probe); if (days.includes(p.dow)) return { open: false, date: p.day }; probe = new Date(probe.getTime() - 86400000); }
  return { open: false, date: now.day };
}
try {
  const cols = ["close", "change", "Perf.W", "Perf.1M", "Perf.YTD", "Perf.Y", "price_52_week_high", "price_52_week_low"];
  const r = await fetch("https://scanner.tradingview.com/global/scan", {
    method: "POST", headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Market Insight global collector" },
    body: JSON.stringify({ symbols: { tickers: GCC.map((x) => x[0]), query: { types: [] } }, columns: cols }), signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error("TradingView HTTP " + r.status);
  const rows = new Map(((await r.json()).data || []).map((x) => [x.s, x.d]));
  const items = [];
  for (const [symbol, en, ar, tz, days, start, end] of GCC) {
    const d = rows.get(symbol), prior = prevById.get(symbol);
    if (!d || !(Number(d[0]) > 0)) {
      failed.push(symbol + ": no data");
      if (prior) items.push({ ...prior, stale: true });
      continue;
    }
    const close = round(Number(d[0]), 2), state = sessionState(tz, days, start, end);
    let date, history;
    try {
      // Exact trading dates and a year of closes from the chart feed.
      const bars = await tvDailyBars(symbol);
      const dayOf = (ts) => localParts(tz, new Date(ts * 1000)).day;
      history = bars.filter((b) => b[4] > 0).map((b) => [dayOf(b[0]), round(b[4], 2)]);
      date = history.at(-1)[0];
      if (state.open) history = history.slice(0, -1);
    } catch (error) {
      // Feed unavailable (Bahrain's is restricted): fall back to the closes recorded by earlier runs.
      // An unchanged close since the last run is the same session, so it keeps its date.
      date = prior && prior.close === close && prior.change1d === round(d[1]) && !state.open ? prior.date : state.date;
      const hist = (prior?.history || []).filter((h) => h[0] < date);
      if (!state.open) hist.push([date, close]);
      history = hist;
    }
    history = history.slice(-260);
    items.push({
      symbol, en, ar, timezone: tz, date, close, open: state.open, source: "TradingView",
      change1d: round(d[1]), change1w: round(d[2]), change1m: round(d[3]), changeYtd: round(d[4]), change1y: round(d[5]),
      high52: round(d[6]), low52: round(d[7]),
      spark: history.length >= 5 ? history.slice(-66).map((h) => h[1]) : null,
      history
    });
    ok += 1;
  }
  // Oman: MSX 30 from Muscat Stock Exchange's own website (TradingView and Yahoo don't carry it).
  // The site gives the latest level and day change only, so longer changes come from the
  // closes this script records, and fill in as that history grows.
  try {
    const symbol = "MSX:MSX30", prior = prevById.get(symbol);
    const res = await fetch("https://www.msx.om/api.aspx/Indices", {
      method: "POST", body: "{ 'Type': 'MSX30' }", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json; charset=utf-8", accept: "application/json", referer: "https://www.msx.om/", origin: "https://www.msx.om", "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" }
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const row = (await res.json()).d?.find((x) => x.Title === "MSX30" || x.index_symbol === "MSX30");
    const num = (v) => Number(String(v ?? "").replace(/,/g, ""));
    const close = round(num(row?.MSX30), 2), change1d = round(num(row?.Change));
    if (!(close > 0) || !Number.isFinite(change1d)) throw new Error("no MSX 30 level");
    const state = sessionState("Asia/Muscat", [0, 1, 2, 3, 4], "10:00", "14:00");
    const date = prior && prior.close === close && prior.change1d === change1d && !state.open ? prior.date : state.date;
    const hist = (prior?.history || []).filter((h) => h[0] < date);
    if (!state.open) hist.push([date, close]);
    const history = hist.slice(-260);
    const at = (n) => (history.length > n ? history[history.length - 1 - n][1] : null);
    const onOrBefore = (d) => { if (!history.length || history[0][0] > d) return null; for (let i = history.length - 1; i >= 0; i -= 1) if (history[i][0] <= d) return history[i][1]; return null; };
    const dd = new Date(date + "T00:00:00Z"), m1 = new Date(dd), y1 = new Date(dd);
    m1.setUTCMonth(dd.getUTCMonth() - 1); y1.setUTCFullYear(dd.getUTCFullYear() - 1);
    const year = history.filter((h) => h[0] > y1.toISOString().slice(0, 10)).map((h) => h[1]);
    items.push({
      symbol, en: "Oman (MSX 30)", ar: "عُمان (مؤشر MSX 30)", timezone: "Asia/Muscat", date, close, open: state.open,
      source: "Muscat Stock Exchange (msx.om)", sourceUrl: "https://www.msx.om/",
      change1d, change1w: pct(close, at(5)), change1m: pct(close, onOrBefore(m1.toISOString().slice(0, 10))),
      changeYtd: pct(close, onOrBefore(`${Number(date.slice(0, 4)) - 1}-12-31`)), change1y: pct(close, onOrBefore(y1.toISOString().slice(0, 10))),
      high52: history.length >= 200 ? Math.max(...year) : null, low52: history.length >= 200 ? Math.min(...year) : null,
      spark: history.length >= 5 ? history.slice(-66).map((h) => h[1]) : null,
      history
    });
    ok += 1;
  } catch (error) {
    failed.push("MSX:MSX30: " + error.message);
    const prior = prevById.get("MSX:MSX30");
    if (prior) items.push({ ...prior, stale: true });
  }
  groups.unshift({ id: "gcc", en: "GCC markets", ar: "أسواق الخليج", items });
} catch (error) {
  failed.push("GCC: " + error.message);
  const prior = previous?.groups?.find((g) => g.id === "gcc");
  if (prior) groups.unshift({ ...prior, items: prior.items.map((i) => ({ ...i, stale: true })) });
}

if (ok < 10) throw new Error(`Only ${ok} instruments loaded; keeping previous file. ${failed.join("; ")}`);

// Kuwait link: All-Share from the site's own snapshot, for side-by-side context.
let kuwait = null;
try {
  const snap = JSON.parse(await readFile(new URL("../website/latest.json", import.meta.url), "utf8"));
  const a = snap.allShareIndex;
  if (a?.close) kuwait = { en: "Boursa Kuwait All-Share", ar: "السوق العام - بورصة الكويت", date: snap.tradingDate, close: a.close, change1d: round(a.changePercent), change1m: round(a.performance1MonthPercent), changeYtd: round(a.performanceYtdPercent) };
} catch {}

await writeFile(OUT, JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), source: "Yahoo Finance and TradingView (delayed)", failed, kuwait, groups }) + "\n");
console.log(`Global markets: ${ok} instruments${failed.length ? "; failed " + failed.join(", ") : ""}`);
