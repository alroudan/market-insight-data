// Shared helpers for Boursa Kuwait's official daily market report (RT=3522).
// Used by scrape.mjs (single attempt) and wait-official-turnover.mjs (polling).

export const OFFICIAL_REPORT_SOURCE = "Boursa Kuwait official daily market reports";
export const OFFICIAL_REPORT_URL = "https://www.boursakuwait.com.kw/en/market/reports#daily-all";

export async function fetchOfficialDailyReport(tradingDate) {
  const markets = { BKP: "P", BKM: "M", BKA: "A" };
  const indexes = {};
  const values = {};
  for (const [ticker, market] of Object.entries(markets)) {
    const url = `https://www.boursakuwait.com.kw/data-api/client-services?L=E&DT=1&MT=${market}&RT=3522`;
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 Market Insight EOD collector", accept: "application/json", "cache-control": "no-cache" },
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`${ticker} daily report HTTP ${response.status}`);
    const payload = await response.json();
    const summary = payload?.["Market Summary"]?.[0];
    const publishedDate = String(summary?.TransactionDate || "");
    const expectedDate = tradingDate.replaceAll("-", "");
    if (publishedDate !== expectedDate) throw new Error(`${ticker} daily report dated ${publishedDate}; expected ${expectedDate}`);
    const close = Number(summary.Index);
    const pointChange = Number(summary.Change);
    const value = Number(summary.Turnover);
    if (![close, pointChange, value].every(Number.isFinite) || close <= 0 || value <= 0) {
      throw new Error(`${ticker} daily report contains invalid figures`);
    }
    indexes[ticker] = { close, pointChange, changePercent: pointChange / (close - pointChange) * 100 };
    values[ticker] = value;
  }
  if (Math.abs(values.BKP + values.BKM - values.BKA) > 0.002) {
    throw new Error("Premier and Main traded values do not reconcile with All-Share");
  }
  return {
    tradingDate,
    valueTradedKwd: values.BKA,
    source: OFFICIAL_REPORT_SOURCE,
    sourceUrl: OFFICIAL_REPORT_URL,
    indexes
  };
}

const INDEX_NAMES = {
  BKP: ["premierIndex", "Boursa Kuwait Premier Market Index"],
  BKM: ["mainIndex", "Boursa Kuwait Main Market Index"],
  BKA: ["allShareIndex", "Boursa Kuwait All Share Index"]
};

export function applyOfficialIndexes(snapshot, report) {
  for (const [ticker, [key, name]] of Object.entries(INDEX_NAMES)) {
    snapshot[key] = {
      ...(snapshot[key] || {}),
      ticker,
      name,
      close: report.indexes[ticker].close,
      pointChange: report.indexes[ticker].pointChange,
      changePercent: report.indexes[ticker].changePercent,
      tradingDate: report.tradingDate,
      source: report.source,
      sourceUrl: report.sourceUrl
    };
  }
}

export function buildMarketStats(tradingDate, report) {
  const officialYtdBaseline = tradingDate.startsWith("2026-") ? {
    throughDate: "2026-09-30",
    totalValueTradedKwd: 15642567298.380,
    tradingSessions: 183,
    source: "Boursa Kuwait monthly and quarterly market summaries",
    sourceUrl: "https://reports.boursakuwait.com.kw/en/products-and-services/historical-data/reports/market-summary"
  } : null;
  const latestValueTradedKwd = report?.valueTradedKwd ?? null;
  const averageDailyValueTradedYtdKwd = officialYtdBaseline
    ? officialYtdBaseline.totalValueTradedKwd / officialYtdBaseline.tradingSessions
    : null;
  return {
    latestValueTradedKwd,
    latestValueTradedDate: report?.tradingDate || null,
    averageDailyValueTradedYtdKwd,
    latestValueVsYtdAveragePercent: latestValueTradedKwd != null && averageDailyValueTradedYtdKwd
      ? (latestValueTradedKwd / averageDailyValueTradedYtdKwd - 1) * 100
      : null,
    averageThroughDate: officialYtdBaseline?.throughDate || null,
    ytdTotalValueTradedKwd: officialYtdBaseline?.totalValueTradedKwd || null,
    tradingSessionCount: officialYtdBaseline?.tradingSessions || null,
    source: report?.source || null,
    sourceUrl: report?.sourceUrl || null,
    averageSource: officialYtdBaseline?.source || null,
    averageSourceUrl: officialYtdBaseline?.sourceUrl || null
  };
}
