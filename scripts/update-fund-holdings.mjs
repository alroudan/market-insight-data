import { readFile, writeFile } from 'node:fs/promises';

const DATA_FILE = new URL('../website/funds.json', import.meta.url);
const API = 'https://www.boursakuwait.com.kw/data-api/client-services';
const REPORT_TEXT = /(?:نموذج الإفصاح عن المعلومات الشهرية|المعلومات الشهرية)/;

function latestCompletedMonthPeriod(now = new Date()) {
  const kuwait = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kuwait' }));
  const end = new Date(kuwait.getFullYear(), kuwait.getMonth(), 0);
  return `${String(end.getDate()).padStart(2, '0')}/${String(end.getMonth() + 1).padStart(2, '0')}/${end.getFullYear()}`;
}

const TARGET_PERIOD = latestCompletedMonthPeriod();

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Market Insight official-fund-data updater' },
        signal: AbortSignal.timeout(45_000)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(attempt * 1_000);
    }
  }
  throw lastError;
}

function cleanText(value = '') {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePercent(value = '') {
  const cleaned = cleanText(value).replace(/,/g, '').replace('%', '').trim();
  const trailingNegative = cleaned.endsWith('-');
  const number = Number(cleaned.replace(/-$/, ''));
  return Number.isFinite(number) ? (trailingNegative ? -number : number) : null;
}

function returnValue(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}[\\s\\S]{0,700}?class="[^"]*lab-desb[^"]*"[^>]*>([\\s\\S]*?)<\\/span>`));
  return parsePercent(match?.[1]);
}

function parseOfficialReport(html, url) {
  const date = cleanText(
    html.match(/تاريخ المعلومات الشهرية[\s\S]{0,1200}?datepicker[\s\S]{0,500}?class="[^"]*lab-desb[^"]*"[^>]*>([\s\S]*?)<\/span>/)?.[1]
  );
  const section = html.match(/أكبر خمس مكونات بالصندوق[\s\S]*?(?=<h2>عائد الصندوق|عائد الصندوق)/)?.[0] || '';
  const holdings = [];
  const rowPattern = /<tr[^>]*><td>\s*([1-5])\s*<\/td><td[^>]*><span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<td[^>]*><span[^>]*>([\s\S]*?)<\/span>/g;
  let match;
  while ((match = rowPattern.exec(section))) {
    const nameArabic = cleanText(match[2]);
    const weightPercent = Number(cleanText(match[3]).replace(/,/g, '').replace('%', ''));
    if (nameArabic && Number.isFinite(weightPercent)) holdings.push({ nameArabic, weightPercent });
  }
  if (!date) throw new Error(`Official reporting date was not parseable: ${url}`);
  return {
    period: date,
    url,
    holdings,
    monthlyPercent: returnValue(html, 'العائد الشهري'),
    quarterPercent: returnValue(html, 'العائد لآخر ربع سنة مالية'),
    ytdPercent: returnValue(html, 'العائد منذ بداية السنة')
  };
}

function periodValue(period) {
  const [day, month, year] = String(period).split('/').map(Number);
  return Date.UTC(year, month - 1, day);
}

async function disclosuresForFund(fund) {
  const query = new URLSearchParams({ RT: '3520', FID: fund.id, L: 'A' });
  let response = [];
  let discoverySucceeded = false;
  try {
    response = JSON.parse(await fetchText(`${API}?${query}`));
    discoverySucceeded = true;
  } catch (error) {
    console.warn(`${fund.id}: disclosure discovery failed: ${error.message}`);
  }
  const urls = [
    fund.officialReport,
    ...response
      .filter(item => item.FalseNews === 0 && REPORT_TEXT.test(item.Title || '') && item.Url)
      .map(item => item.Url)
  ];
  return {
    discoverySucceeded,
    urls: [...new Set(urls)].filter(url => /\.html(?:$|\?)/i.test(url))
  };
}

async function updateFund(fund) {
  const { urls, discoverySucceeded } = await disclosuresForFund(fund);
  const reports = [];
  for (const url of urls.slice(0, 20)) {
    try {
      const report = parseOfficialReport(await fetchText(url), url);
      if (!reports.some(item => item.period === report.period)) reports.push(report);
    } catch (error) {
      console.warn(`${fund.id}: ${error.message}`);
    }
  }
  reports.sort((a, b) => periodValue(b.period) - periodValue(a.period));
  const current = reports.find(report => report.period === TARGET_PERIOD);
  const previous = reports.find(report => current && periodValue(report.period) < periodValue(current.period));
  if (!current) {
    if (!discoverySucceeded) return fund;
    return {
      ...fund,
      reportingDate: null,
      monthlyPercent: null,
      quarterPercent: null,
      ytdPercent: null,
      officialReport: null,
      holdings: null
    };
  }
  return {
    ...fund,
    reportingDate: current.period,
    monthlyPercent: current.monthlyPercent,
    quarterPercent: current.quarterPercent,
    ytdPercent: current.ytdPercent,
    officialReport: current.url,
    holdings: {
      currentPeriod: current.period,
      previousPeriod: previous?.period || null,
      currentOfficialReport: current.url,
      previousOfficialReport: previous?.url || null,
      current: current.holdings,
      previous: previous?.holdings || []
    }
  };
}

async function mapLimited(items, limit, mapper) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        output[index] = await mapper(items[index]);
      } catch (error) {
        console.error(`${items[index].id}: ${error.message}`);
        output[index] = items[index];
      }
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return output;
}

const data = JSON.parse(await readFile(DATA_FILE, 'utf8'));
const previousFunds = JSON.stringify(data.funds);
data.funds = await mapLimited(data.funds, 5, updateFund);
if (JSON.stringify(data.funds) !== previousFunds) {
  data.generatedAt = new Date().toISOString();
  data.reportingPeriod = TARGET_PERIOD;
  data.holdingsGeneratedAt = new Date().toISOString();
}
data.holdingsSource = 'https://www.boursakuwait.com.kw/ar/fund/monthly_information';
await writeFile(DATA_FILE, `${JSON.stringify(data, null, 2)}\n`);

const complete = data.funds.filter(fund => fund.holdings?.previous?.length).length;
const currentOnly = data.funds.filter(fund => fund.holdings?.current?.length && !fund.holdings?.previous?.length).length;
const missing = data.funds.length - complete - currentOnly;
const unpublished = data.funds.filter(fund => fund.reportingDate !== TARGET_PERIOD).length;
console.log(`Fund holdings updated for ${TARGET_PERIOD}: ${complete} compared, ${currentOnly} current-only, ${missing} unavailable; ${unpublished} fund(s) not published.`);
