// Probe 7: raw index snapshot feeds used by the homepage.
import { writeFile } from "node:fs/promises";
const out = {};
const ua = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", accept: "application/json", referer: "https://www.boursakuwait.com.kw/en/" };
for (const [k, url] of Object.entries({
  rt303: "https://www.boursakuwait.com.kw/price?UID=&SID=&L=EN&UNC=1&UE=KSE&H=1&M=1&RT=303&SRC=KSE&AS=1",
  rt301: "https://www.boursakuwait.com.kw/price?UID=&SID=&L=EN&UNC=1&UE=KSE&H=1&M=1&RT=301",
  chart: "https://www.boursakuwait.com.kw/chartDel?UID=&SID=&L=EN&UNC=1&UE=KSE&H=1&M=1&RT=37&E=KSE&S=01&AE=1&CM=5&NOD=1&CT=3",
  chartDaily: "https://www.boursakuwait.com.kw/chartDel?UID=&SID=&L=EN&UNC=1&UE=KSE&H=1&M=1&RT=37&E=KSE&S=01&AE=1&CM=1&NOD=800&CT=3"
})) {
  try { const r = await fetch(url, { headers: ua }); const t = await r.text(); out[k] = { status: r.status, len: t.length, head: t.slice(0, 1500), tail: t.slice(-600) }; } catch (e) { out[k] = e.message; }
}
await writeFile("probe/result.json", JSON.stringify(out, null, 1));
