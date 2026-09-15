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

const arabicNames = {};
try {
  const arabicResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 Market Insight EOD collector"
    },
    body: JSON.stringify({
      symbols: { tickers: [], query: { types: [] } },
      filter: [{ left: "type", operation: "equal", right: "stock" }],
      options: { lang: "ar" },
      range: [0, 1000],
      columns: ["name", "description"]
    })
  });
  if (arabicResponse.ok) {
    const arabicPayload = await arabicResponse.json();
    for (const row of arabicPayload.data || []) {
      const ticker = String(row.s || "").split(":").pop();
      const description = row.d?.[1];
      if (ticker && typeof description === "string" && /[\u0600-\u06ff]/.test(description)) arabicNames[ticker] = description;
    }
  }
} catch (error) {
  console.warn("Arabic TradingView names unavailable: " + error.message);
}

const advancedTechnical = {};
try {
  const advancedColumns = ["ADX", "ADX+DI", "ADX-DI", "ATR", "BB.upper", "BB.lower", "EMA20", "VWMA", "High.1M"];
  const advancedResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Mozilla/5.0 Market Insight EOD collector"
    },
    body: JSON.stringify({
      symbols: { tickers: [], query: { types: [] } },
      filter: [{ left: "type", operation: "equal", right: "stock" }],
      range: [0, 1000],
      columns: advancedColumns
    })
  });
  if (advancedResponse.ok) {
    const advancedPayload = await advancedResponse.json();
    for (const row of advancedPayload.data || []) {
      const ticker = String(row.s || "").split(":").pop();
      if (ticker) advancedTechnical[ticker] = Object.fromEntries(advancedColumns.map((column, index) => [column, row.d?.[index]]));
    }
  } else {
    console.warn("Advanced TradingView fields returned HTTP " + advancedResponse.status);
  }
} catch (error) {
  console.warn("Advanced TradingView fields unavailable: " + error.message);
}

const arabicTickerAliases = {
  KFH: "بيتك", NBK: "وطني", GBK: "خليج ب", ABK: "أهلي", KIB: "الدولي",
  BURG: "برقان", BOUBYAN: "بوبيان", KINV: "كويتية", IFA: "إيفا",
  NINV: "استثمارات", KPROJ: "مشاريع", ARZAN: "أرزان", AAYAN: "أعيان",
  KRE: "عقارات ك", URC: "متحدة", SRE: "صالحية", MABANEE: "مباني",
  ALTIJARIA: "التجارية", NIND: "صناعات", CABLE: "كابلات", SHIP: "سفن",
  BPCC: "بوبيان ب", MKHZN: "أجيليتي", ZAIN: "زين", HUMANSOFT: "هيومن سوفت",
  IFAHR: "إيفا فنادق", CGC: "مشتركة", OULAFUEL: "الأولى", JAZEERA: "الجزيرة",
  GFH: "جي إف إتش", WARBABANK: "وربة", STC: "إس تي سي", MEZZAN: "ميزان",
  INTEGRATED: "المتكاملة", BOURSA: "بورصة", ALG: "الغانم", BEYOUT: "بيوت",
  ALFTAQA: "الطاقة", TROLLEY: "ترولي"
};

const now = new Date();
const fetchedAt = now.toISOString();
const kuwaitParts = Object.fromEntries(
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kuwait",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)])
);
const kuwaitMinutes = kuwaitParts.hour * 60 + kuwaitParts.minute;
const tradingDateCursor = new Date(Date.UTC(kuwaitParts.year, kuwaitParts.month - 1, kuwaitParts.day));
if (kuwaitMinutes < 13 * 60 + 16) tradingDateCursor.setUTCDate(tradingDateCursor.getUTCDate() - 1);
while ([5, 6].includes(tradingDateCursor.getUTCDay())) {
  tradingDateCursor.setUTCDate(tradingDateCursor.getUTCDate() - 1);
}
const tradingDate = tradingDateCursor.toISOString().slice(0, 10);
const results = {};
const failures = [];
let premierIndex = null;
let mainIndex = null;
let allShareIndex = null;

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

const indexColumns = ["description", "close", "change", "Perf.1M", "Perf.YTD", "volume", "average_volume_30d_calc", "average_volume_90d_calc"];
const officialQuarterlyTradedValueChange = tradingDate.startsWith("2026-")
  ? { BKP: 32.24, BKM: 172.70, BKA: 63.93 }
  : {};
const officialQuarterlyValuePeriod = tradingDate.startsWith("2026-") ? "Q2 2026 vs Q1 2026" : null;
try {
  const indexResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 Market Insight EOD collector" },
    body: JSON.stringify({ symbols: { tickers: ["KSE:BKP", "KSE:BKM", "KSE:BKA"], query: { types: [] } }, range: [0, 10], columns: indexColumns })
  });
  if (!indexResponse.ok) throw new Error("TradingView index scanner returned HTTP " + indexResponse.status);
  const indexPayload = await indexResponse.json();
  for (const row of indexPayload.data || []) {
    const ticker = String(row.s || "").split(":").pop();
    const d = Object.fromEntries(indexColumns.map((column, index) => [column, row.d[index]]));
    const average30d = finite(d.average_volume_30d_calc);
    const average90d = finite(d.average_volume_90d_calc);
    const item = {
      ticker, name: d.description || ticker, close: finite(d.close), changePercent: finite(d.change),
      performance1MonthPercent: finite(d["Perf.1M"]), performanceYtdPercent: finite(d["Perf.YTD"]),
      averageVolume30d: average30d, averageVolumePreviousQuarter: average90d,
      averageVolumeChangeVsPreviousQuarterPercent: average30d != null && average90d ? ((average30d / average90d) - 1) * 100 : null,
      tradedValueChangeVsPreviousQuarterPercent: officialQuarterlyTradedValueChange[ticker] ?? null,
      tradedValueComparisonPeriod: officialQuarterlyValuePeriod,
      tradingDate
    };
    if (ticker === "BKP") premierIndex = item;
    if (ticker === "BKM") mainIndex = item;
    if (ticker === "BKA") allShareIndex = item;
  }
} catch (error) { failures.push({ ticker: "MARKET_INDEXES", error: error.message }); }

const officialReportedEps = {
  NBK: {
    reportedEpsFils: 34,
    reportedEpsPeriod: "Six months ended 30 Jun 2026",
    previousReportedEpsFils: 33,
    previousReportedEpsPeriod: "Six months ended 30 Jun 2025",
    reportedEpsSource: "NBK reviewed consolidated interim financial statements",
    reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6205/HTML_en.html"
  }
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
    nameArabic: arabicNames[ticker] || null,
    tickerArabic: arabicTickerAliases[ticker] || null,
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
    ...(officialReportedEps[ticker] || {}),
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
      stochasticD: finite(d["Stoch.D"]),
      adx: finite(advancedTechnical[ticker]?.ADX),
      plusDi: finite(advancedTechnical[ticker]?.["ADX+DI"]),
      minusDi: finite(advancedTechnical[ticker]?.["ADX-DI"]),
      atr: finite(advancedTechnical[ticker]?.ATR),
      bollingerUpper: finite(advancedTechnical[ticker]?.["BB.upper"]),
      bollingerLower: finite(advancedTechnical[ticker]?.["BB.lower"]),
      ema20: finite(advancedTechnical[ticker]?.EMA20),
      vwma: finite(advancedTechnical[ticker]?.VWMA),
      high20Day: finite(advancedTechnical[ticker]?.["High.1M"])
    }
  };
}

if (!premierIndex && previous.premierIndex) premierIndex = previous.premierIndex;
if (!mainIndex && previous.mainIndex) mainIndex = previous.mainIndex;
if (!allShareIndex && previous.allShareIndex) allShareIndex = previous.allShareIndex;

const freshCount = Object.values(results).filter((item) => item.fetchedAt === fetchedAt).length;
if (freshCount === 0) throw new Error("No fresh TradingView Kuwait records; previous snapshot preserved");

let officialMarketReport = null;
try {
  const { chromium } = await import("playwright");
  const reportBrowser = await chromium.launch({ headless: true });
  try {
    const page = await reportBrowser.newPage({ locale: "en-GB" });
    await page.goto("https://www.boursakuwait.com.kw/en/market/reports#daily-all", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForFunction(() => document.body.innerText.includes("Value Traded"), null, { timeout: 60000 });
    const reportText = await page.locator("body").innerText();
    const match = reportText.match(/All-Share\s+(\d{2})\/(\d{2})\/(\d{4})[\s\S]*?Value Traded\s+([\d,.]+)/);
    if (!match) throw new Error("Daily All-Share report fields were not found");
    const reportTradingDate = match[3] + "-" + match[2] + "-" + match[1];
    const valueTradedKwd = Number(match[4].replace(/,/g, ""));
    if (reportTradingDate !== tradingDate || !Number.isFinite(valueTradedKwd)) {
      throw new Error("Official report date/value did not match the requested session");
    }
    officialMarketReport = {
      tradingDate: reportTradingDate,
      valueTradedKwd,
      source: "Boursa Kuwait Daily All-Share Report",
      sourceUrl: "https://www.boursakuwait.com.kw/en/market/reports#daily-all"
    };
  } finally {
    await reportBrowser.close();
  }
} catch (error) {
  failures.push({ ticker: "OFFICIAL_MARKET_VALUE", error: error.message });
}

const verifiedOfficialDailyValues = {
  "2026-09-14": 121813003.672
};
if (!officialMarketReport && verifiedOfficialDailyValues[tradingDate] != null) {
  officialMarketReport = {
    tradingDate,
    valueTradedKwd: verifiedOfficialDailyValues[tradingDate],
    source: "Boursa Kuwait Daily All-Share Report (verified fallback)",
    sourceUrl: "https://www.boursakuwait.com.kw/en/market/reports#daily-all"
  };
}

const officialYtdBaseline = tradingDate.startsWith("2026-") ? {
  throughDate: "2026-08-31",
  totalValueTradedKwd: 13195399198.046,
  tradingSessions: 161,
  source: "Boursa Kuwait monthly and quarterly market summaries",
  sourceUrl: "https://reports.boursakuwait.com.kw/en/products-and-services/historical-data/reports/market-summary"
} : null;
const latestValueTradedKwd = officialMarketReport?.valueTradedKwd ?? null;
const averageDailyValueTradedYtdKwd = officialYtdBaseline
  ? officialYtdBaseline.totalValueTradedKwd / officialYtdBaseline.tradingSessions
  : null;
const latestValueVsYtdAveragePercent = latestValueTradedKwd != null && averageDailyValueTradedYtdKwd
  ? (latestValueTradedKwd / averageDailyValueTradedYtdKwd - 1) * 100
  : null;
const marketStats = {
  latestValueTradedKwd,
  latestValueTradedDate: officialMarketReport?.tradingDate || null,
  averageDailyValueTradedYtdKwd,
  latestValueVsYtdAveragePercent,
  averageThroughDate: officialYtdBaseline?.throughDate || null,
  ytdTotalValueTradedKwd: officialYtdBaseline?.totalValueTradedKwd || null,
  tradingSessionCount: officialYtdBaseline?.tradingSessions || null,
  source: officialMarketReport?.source || null,
  sourceUrl: officialMarketReport?.sourceUrl || null,
  averageSource: officialYtdBaseline?.source || null,
  averageSourceUrl: officialYtdBaseline?.sourceUrl || null
};

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
  mainIndex,
  allShareIndex,
  marketStats,
  stocks: results
};

await writeFile(new URL("latest.json", dataDir), JSON.stringify(snapshot, null, 2) + "\n");
console.log("Saved the full Kuwait equity universe: " + freshCount + " records for " + tradingDate);
if (failures.length) console.warn(JSON.stringify(failures, null, 2));
