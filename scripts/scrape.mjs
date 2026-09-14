import { mkdir, readFile, writeFile } from "node:fs/promises";

const stocks = JSON.parse(await readFile(new URL("../stocks.json", import.meta.url), "utf8"));
const dataDir = new URL("../data/", import.meta.url);
await mkdir(dataDir, { recursive: true });

const readJson = async (url, fallback) => {
  try { return JSON.parse(await readFile(url, "utf8")); }
  catch { return fallback; }
};

const previous = await readJson(new URL("latest.json", dataDir), { stocks: {} });
// Full-market discovery keeps the listed universe current without a manual watchlist.
const endpoint = "https://scanner.tradingview.com/kuwait/scan";
const columns = [
  "name",
  "description",
  "logoid",
  "sector",
  "type",
  "price_52_week_high",
  "price_52_week_low",
  "close",
  "change",
  "Perf.1M",
  "Perf.YTD",
  "volume",
  "average_volume_10d_calc",
  "relative_volume_10d_calc",
  "market_cap_basic",
  "price_earnings_ttm",
  "price_book_fq",
  "price_sales_current",
  "earnings_per_share_diluted_ttm",
  "dividends_yield_current",
  "total_revenue",
  "net_income",
  "return_on_equity",
  "debt_to_equity",
  "net_margin",
  "enterprise_value_ebitda_ttm",
  "Recommend.All",
  "Recommend.MA",
  "Recommend.Other",
  "RSI",
  "MACD.macd",
  "MACD.signal",
  "SMA20",
  "SMA50",
  "SMA200",
  "Stoch.K",
  "Stoch.D"
];

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 Market Insight EOD collector"
  },
  body: JSON.stringify({
    symbols: {
      tickers: [],
      query: { types: [] }
    },
    filter: [{ left: "type", operation: "equal", right: "stock" }],
    range: [0, 1000],
    columns
  })
});

if (!response.ok) throw new Error("TradingView scanner returned HTTP " + response.status);
const payload = await response.json();
if (!Array.isArray(payload.data) || payload.data.length === 0) {
  throw new Error("TradingView scanner returned no Kuwait stock records");
}

const now = new Date();
const fetchedAt = now.toISOString();
const tradingDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kuwait", year: "numeric", month: "2-digit", day: "2-digit"
}).format(now);
const results = {};
const failures = [];
let premierIndex = null;

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const recommendation = (value) => {
  const score = finite(value);
  if (score == null) return "Unavailable";
  if (score >= 0.5) return "Strong Buy";
  if (score >= 0.1) return "Buy";
  if (score <= -0.5) return "Strong Sell";
  if (score <= -0.1) return "Sell";
  return "Neutral";
};

for (const row of payload.data) {
  const ticker = String(row.s || "").split(":").pop();
  const d = Object.fromEntries(columns.map((column, index) => [column, row.d[index]]));
  if (ticker === "BKP") {
    premierIndex = {
      ticker: "BKP",
      name: d.description || "Boursa Kuwait Premier Market Index",
      close: finite(d.close),
      changePercent: finite(d.change),
      tradingDate
    };
    continue;
  }
  if (!Array.isArray(row.d) || !ticker) continue;
  const stock = stocks.find((item) => item.ticker === ticker);
  results[ticker] = {
    ticker,
    name: d.description || stock?.name || ticker,
    code: stock?.code || null,
    sector: d.sector || null,
    securityType: d.type || "stock",
    high52Week: finite(d.price_52_week_high),
    low52Week: finite(d.price_52_week_low),
    logoId: d.logoid || null,
    sourceUrl: "https://www.tradingview.com/symbols/KSE-" + ticker + "/",
    officialProfileUrl: stock?.code ? "https://www.boursakuwait.com.kw/en/stock/profile#" + stock.code : "https://www.boursakuwait.com.kw/en/stock/market-watch",
    officialFinancialsUrl: stock?.code ? "https://www.boursakuwait.com.kw/en/stock/financial-statement#" + stock.code : "https://www.boursakuwait.com.kw/en/stock/market-watch",
    fetchedAt,
    tradingDate,
    close: finite(d.close),
    changePercent: finite(d.change),
    performance1MonthPercent: finite(d["Perf.1M"]),
    performanceYtdPercent: finite(d["Perf.YTD"]),
    volume: finite(d.volume),
    averageVolume10d: finite(d.average_volume_10d_calc),
    relativeVolume10d: finite(d.relative_volume_10d_calc),
    marketCapKwd: finite(d.market_cap_basic),
    pe: finite(d.price_earnings_ttm),
    pb: finite(d.price_book_fq),
    ps: finite(d.price_sales_current),
    eps: finite(d.earnings_per_share_diluted_ttm),
    dividendYieldPercent: finite(d.dividends_yield_current),
    revenueKwd: finite(d.total_revenue),
    netIncomeKwd: finite(d.net_income),
    returnOnEquityPercent: finite(d.return_on_equity),
    debtToEquity: finite(d.debt_to_equity),
    profitMarginPercent: finite(d.net_margin),
    evEbitda: finite(d.enterprise_value_ebitda_ttm),
    technical: {
      conclusion: recommendation(d["Recommend.All"]),
      score: finite(d["Recommend.All"]),
      movingAverages: recommendation(d["Recommend.MA"]),
      oscillators: recommendation(d["Recommend.Other"]),
      rsi14: finite(d.RSI),
      macd: finite(d["MACD.macd"]),
      macdSignal: finite(d["MACD.signal"]),
      sma20: finite(d.SMA20),
      sma50: finite(d.SMA50),
      sma200: finite(d.SMA200),
      stochasticK: finite(d["Stoch.K"]),
      stochasticD: finite(d["Stoch.D"])
    }
  };
}

if (!premierIndex && previous.premierIndex) premierIndex = previous.premierIndex;

const freshCount = Object.values(results).filter((item) => item.fetchedAt === fetchedAt).length;
if (freshCount === 0) throw new Error("No fresh TradingView Kuwait records; previous snapshot preserved");

const snapshot = {
  source: "TradingView Kuwait market scanner",
  officialDisclosureSource: "Boursa Kuwait",
  sourceUrl: endpoint,
  generatedAt: fetchedAt,
  tradingDate,
  schedule: "13:16 Asia/Kuwait, Sunday-Thursday",
  freshCount,
  totalCount: Object.keys(results).length,
  failures,
  premierIndex,
  stocks: results
};

await writeFile(new URL("latest.json", dataDir), JSON.stringify(snapshot, null, 2) + "\n");
console.log("Saved the full Kuwait equity universe: " + freshCount + " records for " + tradingDate);
if (failures.length) console.warn(JSON.stringify(failures, null, 2));
