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

// Fallback: Boursa Kuwait's homepage "Market Summary" table usually shows the
// final close well before the dated daily report is published. Read the
// Premier, Main and All-Share tabs with a browser and accept the figures only
// when the table is marked Closed for the expected date and Premier + Main
// value traded reconciles with All-Share.
export const HOMEPAGE_SOURCE = "Boursa Kuwait homepage — All-Share market summary";
export const HOMEPAGE_URL = "https://www.boursakuwait.com.kw/en/";

export async function fetchHomepageSummary(tradingDate) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      locale: "en-GB",
      viewport: { width: 1400, height: 1000 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    });
    await page.goto(HOMEPAGE_URL + "?eod=" + Date.now(), { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForFunction(() => /Market Summary\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+Closed/.test(document.body.innerText), null, { timeout: 60000 })
      .catch(() => { throw new Error("homepage market summary is not marked Closed"); });
    const text = () => page.locator("body").innerText();
    const months = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" };
    const body = await text();
    const dateMatch = body.match(/Market Summary\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+Closed/);
    const published = dateMatch ? `${dateMatch[3]}-${months[dateMatch[2]]}-${dateMatch[1].padStart(2, "0")}` : "";
    if (published !== tradingDate) throw new Error(`homepage summary dated ${published || "unknown"}; expected ${tradingDate}`);
    const number = (value) => Number(String(value).replace(/,/g, ""));
    const readIndex = (label) => {
      const match = body.match(new RegExp(label + "\\s+([\\d,.]+)\\s+([+-]?[\\d,.]+)\\s+([+-]?[\\d.]+)%"));
      if (!match || number(match[1]) <= 0) throw new Error(`homepage ${label} index not found`);
      return { close: number(match[1]), pointChange: number(match[2]), changePercent: Number(match[3]) };
    };
    const indexes = { BKP: readIndex("Premier Market"), BKM: readIndex("Main Market"), BKA: readIndex("All-Share") };
    const values = {};
    for (const [ticker, label] of [["BKP", "Premier Market"], ["BKM", "Main Market"], ["BKA", "All-Share"]]) {
      const tabs = page.getByText(label, { exact: true });
      const count = await tabs.count();
      const pattern = new RegExp(label + "\\s+\\*\\s*Delayed by 15 Minutes\\s+Trades\\s+[\\d,]+\\s+Volume\\s+[\\d,]+\\s+Value Traded\\s+([\\d,.]+)");
      let match = (await text()).match(pattern);
      for (let i = 0; i < count && !match; i += 1) {
        if (!(await tabs.nth(i).boundingBox())) continue;
        await tabs.nth(i).click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(2000);
        match = (await text()).match(pattern);
      }
      if (!match) throw new Error(`homepage ${label} value traded not found`);
      values[ticker] = number(match[1]);
    }
    if (!(values.BKA > 0) || Math.abs(values.BKP + values.BKM - values.BKA) > 0.01) {
      throw new Error(`homepage values do not reconcile (${values.BKP} + ${values.BKM} vs ${values.BKA})`);
    }
    return { tradingDate, valueTradedKwd: values.BKA, source: HOMEPAGE_SOURCE, sourceUrl: HOMEPAGE_URL, indexes };
  } finally {
    await browser.close();
  }
}
