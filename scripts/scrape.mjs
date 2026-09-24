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
  "Value.Traded",
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
if (kuwaitMinutes < 13 * 60 + 20) tradingDateCursor.setUTCDate(tradingDateCursor.getUTCDate() - 1);
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

const verifiedReportedEpsFallback = {
  NBK: { reportedEpsFils: 34, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: 33, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6205/HTML_en.html" },
  CLEANING: { reportedEpsFils: 8.35, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: 2.89, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement (verified)", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6706/HTML_en.html" },
  AMAR: { reportedEpsFils: 1.51, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: 1.35, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement (verified)", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6465/HTML_en.html" },
  COAST: { reportedEpsFils: -4.46, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: -1.61, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement (verified)", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6356/HTML_en.html" },
  ARZAN: { reportedEpsFils: 9.768, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: 17.638, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement (verified)", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6563/HTML_en.html" },
  ASIYA: { reportedEpsFils: -2.345655, reportedEpsPeriod: "Six months ended 30 Jun 2026", previousReportedEpsFils: 1.664106, previousReportedEpsPeriod: "Six months ended 30 Jun 2025", reportedEpsSource: "Boursa Kuwait IFSAH financial statement (verified)", reportedEpsSourceUrl: "https://ifsahdocs.boursakuwait.com.kw/FinAssets/2026_6439/HTML_en.html" }
};

const decodeHtml = (value) => String(value || "")
  .replace(/<br\s*\/?>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
  .replace(/\s+/g, " ")
  .trim();

const tableRows = (html) => [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
  [...row[1].matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((cell) => decodeHtml(cell[1]))
);

const reportedPeriodLabel = (header, year) => {
  const normalized = String(header || "").replace(/\s+/g, " ").trim();
  const match = normalized.match(/(three|six|nine|twelve)\s+months?\s+ended\s+(.+)/i);
  if (match) return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() + " months ended " + match[2].replace(/\b\d{4}\b/g, "").trim() + " " + year;
  const annual = normalized.match(/(?:year|twelve months?)\s+ended\s+(.+)/i);
  if (annual) return "Year ended " + annual[1].replace(/\b\d{4}\b/g, "").trim() + " " + year;
  return normalized ? normalized.replace(/\b\d{4}\b/g, "").trim() + " " + year : String(year);
};

const parseReportedEps = (html, sourceUrl, filingMeta = {}) => {
  const rows = tableRows(html);
  let epsIndex = -1;
  let epsValues = [];
  let epsScore = -1;
  for (let index = 0; index < rows.length; index += 1) {
    const label = rows[index][0] || "";
    if (!/(?:earnings.*per share|\beps\b)/i.test(label) || /disclosure|abstract|continuing operations|discontinued operations/i.test(label)) continue;
    let labelScore = 0;
    if (/attributable to (?:the )?(?:equity )?(?:shareholders|owners) of (?:the )?parent/i.test(label)) labelScore += 8;
    if (/\bbasic\b/i.test(label)) labelScore += 5;
    if (/\bdiluted\b/i.test(label)) labelScore += 2;
    if (/\bfils?\b/i.test(label)) labelScore += 2;
    if (/basic.*(?:and|&)?.*diluted|earnings.*basic.*diluted/i.test(label)) labelScore += 1;
    const values = rows[index].slice(1).map((cell) => {
      const normalized = String(cell).replace(/,/g, "").trim();
      const matches = [...normalized.matchAll(/\(?\s*(-?\d+(?:\.\d+)?)\s*\)?/g)];
      if (!matches.length) return null;
      const match = matches.at(-1);
      const parenthesized = /\(\s*-?\d/.test(match[0]);
      const absolute = Math.abs(Number(match[1]));
      return parenthesized ? -absolute : Number(match[1]);
    }).filter((value) => Number.isFinite(value) && Math.abs(value) <= 1000);
    if (values.length >= 2 && labelScore > epsScore) { epsIndex = index; epsValues = values; epsScore = labelScore; }
  }
  if (epsIndex < 0 || epsValues.length < 2 || epsScore < 5) return null;
  let header = "";
  let years = [];
  for (let index = epsIndex - 1; index >= Math.max(0, epsIndex - 25); index -= 1) {
    const joined = rows[index].join(" ");
    if (!years.length) {
      const rowYears = rows[index].flatMap((cell) => cell.match(/\b20\d{2}\b/g) || [])
        .filter((year) => Number(year) >= 2000 && Number(year) <= new Date().getUTCFullYear() + 1);
      if (rowYears.length >= 2) years = rowYears;
    }
    if (!header && /(?:months?|year)\s+ended/i.test(joined)) {
      const headers = rows[index].slice(1).filter((cell) => /(?:months?|year)\s+ended/i.test(cell));
      header = headers.at(-1) || joined;
    }
    if (header && years.length >= 2) break;
  }
  const currentYear = String(filingMeta.year || (years.length >= 2 ? years.at(-2) : years[0]) || "");
  const previousYear = String(years.length >= 2 ? years.at(-1) : Number(currentYear) - 1);
  const periodFallback = filingMeta.period === 12 ? "Three months ended" : filingMeta.period === 11 ? "Six months ended" : filingMeta.period === 10 ? "Nine months ended" : filingMeta.period === 9 ? "Year ended" : "";
  const periodEnd = filingMeta.period === 12 ? "31 Mar" : filingMeta.period === 11 ? "30 Jun" : filingMeta.period === 10 ? "30 Sep" : filingMeta.period === 9 ? "31 Dec" : "";
  if (!header) header = periodFallback;
  if (!currentYear || !previousYear) return null;
  const currentPeriodLabel = periodFallback && periodEnd ? periodFallback + " " + periodEnd + " " + currentYear : reportedPeriodLabel(header, currentYear);
  const previousPeriodLabel = periodFallback && periodEnd ? periodFallback + " " + periodEnd + " " + previousYear : reportedPeriodLabel(header, previousYear);
  return {
    reportedEpsFils: epsValues.at(-2),
    reportedEpsPeriod: currentPeriodLabel,
    previousReportedEpsFils: epsValues.at(-1),
    previousReportedEpsPeriod: previousPeriodLabel,
    reportedEpsSource: "Latest Boursa Kuwait IFSAH financial statement",
    reportedEpsSourceUrl: sourceUrl
  };
};

const officialReportedEps = { ...verifiedReportedEpsFallback };
try {
  const listResponse = await fetch("https://www.boursakuwait.com.kw/data-api/legacy-mix-services?UID=3166765&SID=3090B191-7C82-49EE-AC52-706F081F265D&UNC=0&UE=KSE&H=1&M=1&RT=306&SRC=KSE&AS=1", {
    headers: { "user-agent": "Mozilla/5.0 Market Insight EPS collector" }
  });
  if (!listResponse.ok) throw new Error("Boursa security list returned HTTP " + listResponse.status);
  const securityPayload = await listResponse.json();
  const codeByTicker = {};
  for (const record of securityPayload?.DAT?.WL?.TD || []) {
    const fields = String(record).split("|");
    const ticker = String(fields[1] || "").split("`")[0].toUpperCase();
    const companyCode = fields[12];
    if (ticker && companyCode && !codeByTicker[ticker]) codeByTicker[ticker] = companyCode;
  }
  const marketTickers = [...new Set(payload.data.map((row) => String(row.s || "").split(":").pop()).filter(Boolean))];
  const candidates = marketTickers.map((ticker) => ({
    ticker,
    code: stocks.find((stock) => stock.ticker === ticker)?.code || codeByTicker[ticker]
  })).filter((stock) => stock.code);
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const stock = candidates[cursor++];
      try {
        const statementResponse = await fetch("https://www.boursakuwait.com.kw/data-api/client-services?RT=3502&SYMC=" + encodeURIComponent(stock.code) + "&L=E", {
          headers: { "user-agent": "Mozilla/5.0 Market Insight EPS collector" }
        });
        if (!statementResponse.ok) throw new Error("Boursa financial statements returned HTTP " + statementResponse.status);
        const statementPayload = await statementResponse.json();
        const filings = (statementPayload.dataFields || []).flatMap((filing) =>
          (filing.fileNames || []).filter((file) => String(file.type).toUpperCase() === "HTML").map((file) => ({
            sourceUrl: file.fileName,
            activatedDate: String(filing.activatedDate || ""),
            year: Number(filing.year) || 0,
            period: Number(filing.period) || 0
          }))
        ).filter((filing) => /ifsahdocs.*HTML_en\.html/i.test(filing.sourceUrl))
          .sort((a, b) => b.activatedDate.localeCompare(a.activatedDate) || b.year - a.year || a.period - b.period);
        const latest = filings[0];
        if (!latest) throw new Error("No standardized English IFSAH filing found");
        const filingResponse = await fetch(latest.sourceUrl, { headers: { "user-agent": "Mozilla/5.0 Market Insight EPS collector" } });
        if (!filingResponse.ok) throw new Error("IFSAH returned HTTP " + filingResponse.status);
        const parsed = parseReportedEps(await filingResponse.text(), latest.sourceUrl, latest);
        if (!parsed) throw new Error("Cumulative EPS row or comparative period was not found");
        officialReportedEps[stock.ticker] = parsed;
      } catch (error) {
        const saved = previous.stocks?.[stock.ticker];
        if (saved?.reportedEpsFils != null) {
          officialReportedEps[stock.ticker] = {
            reportedEpsFils: saved.reportedEpsFils,
            reportedEpsPeriod: saved.reportedEpsPeriod,
            previousReportedEpsFils: saved.previousReportedEpsFils,
            previousReportedEpsPeriod: saved.previousReportedEpsPeriod,
            reportedEpsSource: saved.reportedEpsSource,
            reportedEpsSourceUrl: saved.reportedEpsSourceUrl
          };
        }
        failures.push({ ticker: stock.ticker + "_EPS", error: error.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, candidates.length) }, () => worker()));
} catch (error) {
  failures.push({ ticker: "MARKET_EPS", error: error.message });
}

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
    previousClose: finite(d.close) != null && finite(d.change) != null && (1 + finite(d.change) / 100) !== 0
      ? finite(d.close) / (1 + finite(d.change) / 100)
      : null,
    changePercent: finite(d.change),
    performance1MonthPercent: finite(d["Perf.1M"]),
    performanceYtdPercent: finite(d["Perf.YTD"]),
    volume: finite(d.volume),
    tradedValueKwd: finite(d["Value.Traded"]),
    averageVolume10d: finite(d.average_volume_10d_calc),
    relativeVolume10d: finite(d.volume) != null && finite(d.average_volume_10d_calc) > 0 ? finite(d.volume) / finite(d.average_volume_10d_calc) : null,
    tradingViewRelativeVolume10d: finite(d.relative_volume_10d_calc),
    marketCapKwd: finite(d.market_cap_basic),
    pe: finite(d.price_earnings_ttm),
    pb: finite(d.price_book_fq),
    ps: finite(d.price_sales_current),
    eps: finite(d.earnings_per_share_diluted_ttm),
    epsBasis: "TradingView diluted trailing twelve months",
    ...(officialReportedEps[ticker] || {}),
    reportedEpsStatus: officialReportedEps[ticker] ? "official" : "unavailable",
    dividendYieldPercent: finite(d.dividends_yield_current),
    revenueKwd: finite(d.total_revenue),
    netIncomeKwd: finite(d.net_income),
    fundamentalsBasis: "TradingView trailing/provider-defined fundamentals",
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
    const officialUrl = "https://www.boursakuwait.com.kw/en/";
    const officialFetchUrl = officialUrl + "?eod=" + Date.now();
    await page.goto(officialFetchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForFunction(
      () => document.body.innerText.includes("Market Summary") && document.body.innerText.includes("All-Share"),
      null,
      { timeout: 60000 }
    );
    const reportText = await page.locator("body").innerText();
    const summaryStart = reportText.lastIndexOf("Market Summary");
    const summaryText = summaryStart >= 0 ? reportText.slice(summaryStart) : reportText;
    const dateMatch = summaryText.match(/Market Summary\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+Closed/i);
    const valueMatch = reportText.match(/Market Summary\s+Volume\s+[\d,]+\s+Value\s+([\d,.]+)\s+Trades/i);
    const monthNumber = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    if (!dateMatch || !valueMatch) throw new Error("Official homepage date or market value was not found");
    const reportTradingDate = dateMatch[3] + "-" + monthNumber[dateMatch[2]] + "-" + dateMatch[1].padStart(2, "0");
    const valueTradedKwd = Number(valueMatch[1].replace(/,/g, ""));
    const readIndex = (label) => {
      const match = summaryText.match(new RegExp(label + "\\s+([\\d,.]+)\\s+([+-]?[\\d,.]+)\\s+([+-]?[\\d.]+)%", "i"));
      if (!match) throw new Error("Official " + label + " index fields were not found");
      return {
        close: Number(match[1].replace(/,/g, "")),
        pointChange: Number(match[2].replace(/,/g, "")),
        changePercent: Number(match[3])
      };
    };
    if (reportTradingDate !== tradingDate || !Number.isFinite(valueTradedKwd)) {
      throw new Error("Official homepage is not final for " + tradingDate + " (published " + reportTradingDate + ")");
    }
    officialMarketReport = {
      tradingDate: reportTradingDate,
      valueTradedKwd,
      source: "Boursa Kuwait official Market Summary",
      sourceUrl: officialUrl,
      indexes: {
        BKP: readIndex("Premier Market"),
        BKM: readIndex("Main Market"),
        BKA: readIndex("All-Share")
      }
    };
  } finally {
    await reportBrowser.close();
  }
} catch (error) {
  console.warn("Official market summary unavailable:", error.message);
  failures.push({ ticker: "OFFICIAL_MARKET_SUMMARY", error: error.message });
}

// The official homepage widget can be unreachable from GitHub-hosted runners even
// after Boursa Kuwait publishes the final close. Keep dated, official-page-verified
// figures as a narrow fallback; an entry can only apply to its exact trading date.
const officialHomepageFallbacks = {
  "2026-09-24": {
    tradingDate: "2026-09-24",
    valueTradedKwd: 87933552.861,
    source: "Boursa Kuwait official Market Summary",
    sourceUrl: "https://www.boursakuwait.com.kw/en/",
    indexes: {
      BKP: { close: 9227.08, pointChange: 3.55, changePercent: 0.04 },
      BKM: { close: 9159.19, pointChange: 21.40, changePercent: 0.23 },
      BKA: { close: 8837.01, pointChange: 6.40, changePercent: 0.07 }
    }
  }
};
if (!officialMarketReport && officialHomepageFallbacks[tradingDate]) {
  officialMarketReport = officialHomepageFallbacks[tradingDate];
  console.warn("Using dated official Boursa Kuwait homepage fallback for", tradingDate);
}

if (!officialMarketReport) {
  throw new Error("Official Boursa Kuwait final market summary is unavailable; refusing to publish an incomplete TradingView aggregate");
}

const applyOfficialIndex = (existing, ticker, name) => ({
  ...(existing || {}),
  ticker,
  name,
  close: officialMarketReport.indexes[ticker].close,
  pointChange: officialMarketReport.indexes[ticker].pointChange,
  changePercent: officialMarketReport.indexes[ticker].changePercent,
  tradingDate: officialMarketReport.tradingDate,
  source: officialMarketReport.source,
  sourceUrl: officialMarketReport.sourceUrl
});
premierIndex = applyOfficialIndex(premierIndex, "BKP", "Boursa Kuwait Premier Market Index");
mainIndex = applyOfficialIndex(mainIndex, "BKM", "Boursa Kuwait Main Market Index");
allShareIndex = applyOfficialIndex(allShareIndex, "BKA", "Boursa Kuwait All Share Index");

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
  schedule: "13:20 Asia/Kuwait, Sunday-Thursday",
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
