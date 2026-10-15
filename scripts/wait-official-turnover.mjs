// Boursa Kuwait publishes the official daily market report some time after the
// 13:32 run publishes stock prices. Poll it and patch only the official index
// closes and All-Share traded value into the already-published snapshot.
import { readFile, writeFile } from "node:fs/promises";
import { applyOfficialIndexes, buildMarketStats, fetchOfficialDailyReport } from "./official-report.mjs";

const file = new URL("../data/latest.json", import.meta.url);
const maxMinutes = Number(process.env.OFFICIAL_WAIT_MINUTES || 180);
const intervalMinutes = Number(process.env.OFFICIAL_POLL_MINUTES || 5);

const snapshot = JSON.parse(await readFile(file, "utf8"));
const { tradingDate } = snapshot;
if (snapshot.marketStats?.latestValueTradedDate === tradingDate && Number(snapshot.marketStats?.latestValueTradedKwd) > 0) {
  console.log("Official turnover already published for", tradingDate);
  process.exit(0);
}

const deadline = Date.now() + maxMinutes * 60_000;
let report = null;
let lastError = "";
for (let attempt = 1; ; attempt += 1) {
  try {
    report = await fetchOfficialDailyReport(tradingDate);
    break;
  } catch (error) {
    lastError = error.message;
    console.log(`Attempt ${attempt}: ${lastError}`);
  }
  if (Date.now() + intervalMinutes * 60_000 > deadline) break;
  await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
}

if (!report) {
  console.warn(`Official report for ${tradingDate} not published within ${maxMinutes} minutes: ${lastError}`);
  process.exit(0);
}

applyOfficialIndexes(snapshot, report);
snapshot.marketStats = buildMarketStats(tradingDate, report);
snapshot.failures = (snapshot.failures || []).filter(
  (item) => !["OFFICIAL_DAILY_REPORTS", "OFFICIAL_MARKET_SUMMARY"].includes(item.ticker)
);
snapshot.officialReportAppliedAt = new Date().toISOString();
await writeFile(file, JSON.stringify(snapshot, null, 2) + "\n");
console.log("Official daily report applied:", tradingDate, "KWD", report.valueTradedKwd);
