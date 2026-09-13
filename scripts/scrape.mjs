import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const stocks = JSON.parse(await readFile(new URL("../stocks.json", import.meta.url), "utf8"));
const dataDir = new URL("../data/", import.meta.url);
await mkdir(dataDir, { recursive: true });

const parseNumber = (value) => {
  if (value == null) return null;
  const cleaned = String(value).replace(/,/g, "").replace(/%/g, "").trim();
  if (!cleaned || cleaned === "-" || cleaned === "—") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const valueAfter = (text, labels) => {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const found = text.match(new RegExp(escaped + "\\s*[:\\-]?\\s*([0-9,.]+%?)", "i"));
    if (found) return parseNumber(found[1]);
  }
  return null;
};

const readJson = async (url, fallback) => {
  try { return JSON.parse(await readFile(url, "utf8")); }
  catch { return fallback; }
};

const previous = await readJson(new URL("latest.json", dataDir), { stocks: {} });
const history = await readJson(new URL("history.json", dataDir), {});
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  locale: "en-US",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36"
});

const now = new Date();
const fetchedAt = now.toISOString();
const kuwaitDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuwait", year: "numeric", month: "2-digit", day: "2-digit"
}).format(now);

const results = {};
const failures = [];

for (const stock of stocks) {
  const url = "https://www.boursakuwait.com.kw/en/stock/profile#" + stock.code;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(
      () => document.body?.innerText.includes("Market Capitalization"),
      { timeout: 25000 }
    );
    const text = await page.locator("body").innerText();

    const currentPrice = valueAfter(text, ["Curr. Price", "Current Price", "Last Price"]);
    const entry = {
      ticker: stock.ticker,
      name: stock.name,
      code: stock.code,
      sourceUrl: url,
      fetchedAt,
      tradingDate: kuwaitDate,
      currentPrice,
      marketCapMillion: valueAfter(text, ["Market Capitalization (Million)", "Market Capitalization"]),
      pe: valueAfter(text, ["P/E Ratio"]),
      ps: valueAfter(text, ["P/S Ratio"]),
      eps: valueAfter(text, ["EPS"]),
      beta: valueAfter(text, ["Beta"]),
      dividendYield: valueAfter(text, ["Dividend Yield"]),
      high12m: valueAfter(text, ["Price - 12 Months High"]),
      low12m: valueAfter(text, ["Price - 12 Months Low"]),
      volumeMillion: valueAfter(text, ["Volume - (Million)", "Volume (Million)"])
    };

    const usefulFields = [
      entry.marketCapMillion, entry.pe, entry.ps, entry.eps, entry.high12m, entry.low12m
    ].filter((value) => value != null).length;
    if (usefulFields < 3) throw new Error("profile returned incomplete summary data");

    results[stock.ticker] = entry;
    if (currentPrice && currentPrice > 0) {
      const rows = Array.isArray(history[stock.ticker]) ? history[stock.ticker] : [];
      const row = { date: kuwaitDate, close: currentPrice, volumeMillion: entry.volumeMillion };
      const existing = rows.findIndex((item) => item.date === kuwaitDate);
      if (existing >= 0) rows[existing] = row;
      else rows.push(row);
      history[stock.ticker] = rows.slice(-400);
    }
  } catch (error) {
    failures.push({ ticker: stock.ticker, error: error.message });
    if (previous.stocks?.[stock.ticker]) results[stock.ticker] = previous.stocks[stock.ticker];
  }
}

await browser.close();

const freshCount = Object.values(results).filter((item) => item.fetchedAt === fetchedAt).length;
if (freshCount === 0) {
  console.error("Per-stock failures:", JSON.stringify(failures, null, 2));
  throw new Error("Boursa Kuwait returned no fresh records; previous snapshot was preserved");
}

const snapshot = {
  source: "Boursa Kuwait public company profile pages",
  sourceHome: "https://www.boursakuwait.com.kw/",
  generatedAt: fetchedAt,
  tradingDate: kuwaitDate,
  schedule: "13:16 Asia/Kuwait, Sunday-Thursday",
  freshCount,
  totalCount: stocks.length,
  failures,
  stocks: results
};

await writeFile(new URL("latest.json", dataDir), JSON.stringify(snapshot, null, 2) + "\n");
await writeFile(new URL("history.json", dataDir), JSON.stringify(history, null, 2) + "\n");
console.log("Saved " + freshCount + "/" + stocks.length + " fresh records for " + kuwaitDate);
if (failures.length) console.warn(JSON.stringify(failures, null, 2));
