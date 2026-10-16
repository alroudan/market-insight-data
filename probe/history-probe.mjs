import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const post = async (ep, body) => { const r = await fetch("https://www.msx.om/" + ep, { method: "POST", headers: { "user-agent": UA, "content-type": "application/json; charset=utf-8", accept: "application/json", referer: "https://www.msx.om/", origin: "https://www.msx.om" }, body }); return { st: r.status, body: (await r.text()).slice(0, 6000) }; };
out.indices = await post("api.aspx/Indices", "{ 'Type': 'MSX30' }").catch((e) => e.message);
for (const [ep, body] of [["api.aspx/IndexChart","{ 'Type': 'MSX30' }"],["api.aspx/IndicesChart","{ 'Type': 'MSX30' }"],["api.aspx/TrendChart","{ 'Type': 'MSX30' }"],["api.aspx/Trend","{ 'Type': 'MSX30' }"],["api.aspx/IndexHistory","{ 'Type': 'MSX30' }"]]) out[ep] = await post(ep, body).then((x) => ({ st: x.st, body: x.body.slice(0, 200) })).catch((e) => e.message);
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
