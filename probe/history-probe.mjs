import { writeFile } from "node:fs/promises";
const out = {};
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
for (const t of ["Daily", "Monthly"]) { try { const r = await fetch("https://www.msx.om/rss.aspx?t=" + t, { headers: { "user-agent": UA } }); const x = await r.text(); out[t] = { st: r.status, len: x.length, head: x.slice(0, 2500) }; } catch (e) { out[t] = e.message; } }
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
