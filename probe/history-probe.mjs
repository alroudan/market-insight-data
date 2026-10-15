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
for (const s of ["^BKP.KW", "^BKA.KW", "^BKM.KW"]) {
  out.indexes[s] = { r1mo: await y(s, "range=1mo&interval=1d"), r1y: await y(s, "range=1y&interval=1d"), r2y: await y(s, "range=2y&interval=1d"), period: await y(s, `period1=${p1}&period2=${p2}&interval=1d`), wk: await y(s, "range=5y&interval=1wk") };
}
for (const s of ["AGLTY.KW", "AGILITY.KW", "MKHZN.KW", "ALG.KW"]) out.agility[s] = await y(s, "range=2y&interval=1d");
const uas = { collector: "Mozilla/5.0 Market Insight EOD collector", chrome, none: "" };
for (const [name, ua] of Object.entries(uas)) {
  for (const [label, url] of Object.entries({ report: "https://www.boursakuwait.com.kw/data-api/client-services?L=E&DT=1&MT=A&RT=3522", statements: "https://www.boursakuwait.com.kw/data-api/client-services?RT=3502&SYMC=101&L=E" })) {
    try { const r = await fetch(url, { headers: ua ? { "user-agent": ua, accept: "application/json" } : { accept: "application/json" }, signal: AbortSignal.timeout(15000) }); out.boursa[name + "_" + label] = { status: r.status, sample: (await r.text()).slice(0, 160) }; }
    catch (e) { out.boursa[name + "_" + label] = e.message; }
  }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
