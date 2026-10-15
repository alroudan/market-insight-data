// Probe 2: index history params, Agility symbol, and Boursa API by user-agent.
import { writeFile } from "node:fs/promises";
const out = { ranAt: new Date().toISOString(), indexes: {}, agility: {}, boursa: {} };
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";
async function y(sym, qs, ua = chrome) {
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`, { headers: { "user-agent": ua }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return "HTTP " + r.status;
    const res = (await r.json()).chart?.result?.[0]; const ts = res?.timestamp || [];
    const c = res?.indicators?.quote?.[0]?.close || [];
    const rows = ts.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), c[i]]).filter(x => x[1] != null);
    return { rows: rows.length, first: rows[0], last: rows.at(-1), granularity: res?.meta?.dataGranularity, range: res?.meta?.range };
  } catch (e) { return e.message; }
}
const p1 = Math.floor(Date.parse("2023-01-01") / 1000), p2 = Math.floor(Date.now() / 1000);
for (const s of []) {
  out.indexes[s] = { r1mo: await y(s, "range=1mo&interval=1d"), r1y: await y(s, "range=1y&interval=1d"), r2y: await y(s, "range=2y&interval=1d"), period: await y(s, `period1=${p1}&period2=${p2}&interval=1d`), wk: await y(s, "range=5y&interval=1wk") };
}
for (const s of []) out.agility[s] = await y(s, "range=2y&interval=1d");
const uas = { collector: "Mozilla/5.0 Market Insight EOD collector" };
for (const [name, ua] of Object.entries(uas)) {
  for (const [label, url] of Object.entries({ report: "https://www.boursakuwait.com.kw/data-api/client-services?L=E&DT=1&MT=A&RT=3522", statements: "https://www.boursakuwait.com.kw/data-api/client-services?RT=3502&SYMC=101&L=E" })) {
    try { const r = await fetch(url, { headers: ua ? { "user-agent": ua, accept: "application/json" } : { accept: "application/json" }, signal: AbortSignal.timeout(15000) }); out.boursa[name + "_" + label] = { status: r.status, sample: (await r.text()).slice(0, 160) }; }
    catch (e) { out.boursa[name + "_" + label] = e.message; }
  }
}
// Shape of the official report payload (looking for index history arrays)
const shape = (v, d = 0) => Array.isArray(v) ? { array: v.length, first: d < 3 ? shape(v[0], d + 1) : typeof v[0], last: d < 1 ? v.at(-1) : undefined } : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, d < 4 ? shape(x, d + 1) : typeof x])) : v;
for (const q of ["DT=2", "DT=5", "DT=30", "DT=20261001", "DT=1&D=20261001", "DT=1&TD=20261001", "DT=1&Date=20261001"]) {
  try { const r = await fetch(`https://www.boursakuwait.com.kw/data-api/client-services?L=E&${q}&MT=A&RT=3522`, { headers: { "user-agent": uas.collector, accept: "application/json" } }); const t = await r.text(); let j = null; try { j = JSON.parse(t) } catch {} out.boursa[q] = { status: r.status, date: j?.["Market Summary"]?.[0]?.TransactionDate, index: j?.["Market Summary"]?.[0]?.Index, turnover: j?.["Market Summary"]?.[0]?.Turnover, sample: j ? undefined : t.slice(0, 120) }; } catch (e) { out.boursa[q] = e.message; }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
