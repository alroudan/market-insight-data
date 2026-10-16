import { writeFile } from "node:fs/promises";
const r = await fetch("https://www.boursakuwait.com.kw/data-api/client-services?RT=3521", { headers: { "user-agent": "Mozilla/5.0 Market Insight EOD collector", accept: "application/json" } });
const j = await r.json();
const k = (j.KOP || []).slice().sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
await writeFile("probe/result.json", JSON.stringify({ n: k.length, first: k[0], last40: k.slice(-40), keys: Object.keys(j) }, null, 1));
