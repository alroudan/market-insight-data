// Fear & Greed panel for the main page and the full methodology page.
(function () {
  const ZONES = [
    [0, 25, "--fg-z1", "Extreme fear", "خوف شديد"],
    [25, 45, "--fg-z2", "Fear", "خوف"],
    [45, 55, "--fg-z3", "Neutral", "محايد"],
    [55, 75, "--fg-z4", "Greed", "طمع"],
    [75, 100.01, "--fg-z5", "Extreme greed", "طمع شديد"]
  ];
  const PARTS = {
    momentum: ["Momentum", "الزخم", "All-Share vs its 125-day average", "المؤشر العام مقابل متوسط 125 يوماً"],
    breadth: ["Breadth", "اتساع السوق", "Stocks above their 50-day average", "الأسهم فوق متوسط 50 يوماً"],
    strength: ["Strength", "القوة", "52-week highs vs 52-week lows", "قمم 52 أسبوعاً مقابل قيعانها"],
    volatility: ["Volatility", "التذبذب", "Recent swings vs the past year (higher = fear)", "التقلبات الأخيرة مقابل السنة (أعلى = خوف)"],
    participation: ["Participation", "المشاركة", "Money traded in rising vs falling stocks", "السيولة في الأسهم المرتفعة مقابل المنخفضة"],
    safeHaven: ["Safe haven", "الملاذ الآمن", "Rest of the market vs the 10 largest stocks", "بقية السوق مقابل أكبر 10 أسهم"]
  };
  const PART_KEYS = Object.keys(PARTS);
  const zone = (v) => ZONES.find((z) => v < z[1]);
  const isArabic = () => document.documentElement.lang === "ar";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (iso, ar) => new Intl.DateTimeFormat(ar ? "ar-KW-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(iso + "T00:00:00Z"));
  const polar = (v, r) => { const a = Math.PI * (1 - v / 100); return [130 + r * Math.cos(a), 130 - r * Math.sin(a)]; };

  function gaugeSvg(score) {
    let arcs = "";
    for (const [a, b, c] of ZONES) {
      const [x1, y1] = polar(a + 0.6, 100), [x2, y2] = polar(Math.min(b, 100) - 0.6, 100);
      arcs += `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A100 100 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none" stroke="var(${c})" stroke-width="22"/>`;
    }
    let ticks = "";
    for (const t of [0, 25, 45, 55, 75, 100]) { const [x, y] = polar(t, 123); ticks += `<text x="${x.toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="middle" class="fg-tick">${t}</text>`; }
    const angle = -90 + score * 1.8;
    return `<svg viewBox="0 0 260 150" style="direction:ltr" role="img" aria-label="${score} / 100">${arcs}${ticks}<g style="transform:rotate(${angle}deg);transform-origin:130px 130px"><line x1="130" y1="130" x2="130" y2="40" stroke="var(--ink)" stroke-width="3.5" stroke-linecap="round"/></g><circle cx="130" cy="130" r="8" fill="var(--ink)"/><circle cx="130" cy="130" r="3" fill="var(--card)"/></svg>`;
  }

  function historySvg(rows, ar, opts = {}) {
    const W = opts.width || 300, H = opts.height || 180, L = ar ? 8 : 26, R = ar ? W - 26 : W - 6, T = 8, B = H - 36;
    const n = rows.length;
    const x = (i) => (ar ? R - (i / (n - 1)) * (R - L) : L + (i / (n - 1)) * (R - L));
    const y = (v) => B - (v / 100) * (B - T);
    let s = "";
    for (const [a, b, c] of ZONES) s += `<rect x="${Math.min(L, R)}" y="${y(Math.min(b, 100)).toFixed(1)}" width="${Math.abs(R - L)}" height="${(y(a) - y(Math.min(b, 100))).toFixed(1)}" fill="var(${c})" opacity=".14"/>`;
    for (const t of [0, 25, 50, 75, 100]) s += `<text class="fg-axis" x="${ar ? R + 4 : L - 4}" y="${(y(t) + 3).toFixed(1)}" text-anchor="${ar ? "start" : "end"}">${t}</text>`;
    const ticks = opts.ticks || 4;
    for (let k = 0; k <= ticks; k += 1) {
      const i = Math.round((k * (n - 1)) / ticks), d = new Date(rows[i][0] + "T00:00:00Z");
      const text = new Intl.DateTimeFormat(ar ? "ar-KW-u-nu-latn" : "en-GB", { month: "short", year: opts.years ? "2-digit" : undefined, timeZone: "UTC" }).format(d);
      s += `<text class="fg-axis" x="${x(i).toFixed(1)}" y="${B + 14}" text-anchor="${k === 0 ? (ar ? "end" : "start") : k === ticks ? (ar ? "start" : "end") : "middle"}">${esc(text)}</text>`;
    }
    const avg = rows.map((_, i) => { const w = rows.slice(Math.max(0, i - 9), i + 1); return w.reduce((a, r) => a + r[1], 0) / w.length; });
    s += `<path d="${avg.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("")}" fill="none" stroke="var(--fg-avg)" stroke-width="1.6" stroke-dasharray="3 3"/>`;
    s += `<path d="${rows.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(r[1]).toFixed(1)}`).join("")}" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-linejoin="round"/>`;
    const lastV = rows[n - 1][1];
    s += `<circle cx="${x(n - 1).toFixed(1)}" cy="${y(lastV).toFixed(1)}" r="4" fill="var(${zone(lastV)[2]})" stroke="var(--card)" stroke-width="2"/>`;
    const lx = ar ? R : L, dir = ar ? -1 : 1, anchor = ar ? "end" : "start";
    s += `<line x1="${lx}" y1="${B + 30}" x2="${lx + dir * 14}" y2="${B + 30}" stroke="var(--ink)" stroke-width="1.6"/><text class="fg-axis" x="${lx + dir * 18}" y="${B + 33}" text-anchor="${anchor}">${ar ? "يومي" : "Daily"}</text>`;
    s += `<line x1="${lx + dir * 64}" y1="${B + 30}" x2="${lx + dir * 78}" y2="${B + 30}" stroke="var(--fg-avg)" stroke-width="1.6" stroke-dasharray="3 3"/><text class="fg-axis" x="${lx + dir * 82}" y="${B + 33}" text-anchor="${anchor}">${ar ? "متوسط 10 جلسات" : "10-session average"}</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" style="direction:ltr" role="img" aria-label="${ar ? "سجل المؤشر" : "Index history"}">${s}</svg>`;
  }

  function partsHtml(latest, ar) {
    return PART_KEYS.map((key) => {
      const part = latest.parts[key], z = zone(part.score), [en, a, den, dar] = PARTS[key];
      return `<div class="fg-part"><span class="fg-part-name">${ar ? a : en} <em style="color:var(${z[2]})">· ${ar ? z[4] : z[3]}</em></span><b class="fg-part-val">${Math.round(part.score)}</b><div class="fg-track"><i></i><span class="fg-marker" style="${ar ? "right" : "left"}:${part.score}%;background:var(${z[2]})"></span></div><small>${ar ? dar : den}</small></div>`;
    }).join("");
  }

  function compareHtml(compare, ar) {
    const items = [["day", "Previous close", "الإقفال السابق"], ["week", "1 week ago", "قبل أسبوع"], ["month", "1 month ago", "قبل شهر"], ["year", "1 year ago", "قبل سنة"]];
    return items.filter(([k]) => compare[k]).map(([k, en, a]) => {
      const v = compare[k].score, z = zone(v);
      return `<div title="${esc(fmtDate(compare[k].date, ar))}"><span>${ar ? a : en}</span><b>${Math.round(v)}</b><i style="color:var(${z[2]})">${ar ? z[4] : z[3]}</i></div>`;
    }).join("");
  }

  let data = null, renderedLang = null;

  function renderPanel() {
    const host = document.querySelector("#fear-greed");
    if (!host || !data) return;
    const ar = isArabic(); renderedLang = document.documentElement.lang;
    const latest = data.latest, z = zone(latest.score);
    host.hidden = false;
    host.innerHTML = `
      <div class="fg-head"><h2>${ar ? "مؤشر الخوف والطمع · السوق العام" : "Market Fear &amp; Greed · All-Share"}</h2><small>${ar ? "إقفال " + esc(fmtDate(data.tradingDate, true)) + " · من 0 إلى 100 · كل مكوّن مقارن بآخر سنتين · 50 = المعتاد" : "Close " + esc(fmtDate(data.tradingDate, false)) + " · 0–100 · each part ranked against the past 2 years · 50 = typical"}</small></div>
      <div class="fg-grid">
        <div class="fg-gauge">${gaugeSvg(latest.score)}<div class="fg-score">${Math.round(latest.score)}</div><div class="fg-state" style="color:var(${z[2]})">${ar ? z[4] : z[3]}</div><div class="fg-compare">${compareHtml(latest.compare, ar)}</div></div>
        <div class="fg-parts">${partsHtml(latest, ar)}</div>
        <div class="fg-history"><h3>${ar ? "آخر 12 شهراً" : "Past 12 months"}</h3>${historySvg(data.history.slice(-250), ar)}</div>
      </div>
      <div class="fg-foot"><span>${ar ? "متوسط 6 مكوّنات بأوزان متساوية · يُحدَّث يومياً بعد الإقفال · لأغراض المعلومات فقط وليس توصية استثمارية" : "Average of 6 equally weighted parts · updated daily after the close · for information only, not investment advice"}</span><a class="fg-link" href="/sentiment">${ar ? "السجل الكامل والمنهجية ←" : "Full history &amp; methodology →"}</a></div>`;
  }

  function renderPage() {
    const host = document.querySelector("#fear-greed-page");
    if (!host || !data) return;
    const ar = isArabic(); renderedLang = document.documentElement.lang;
    const latest = data.latest, z = zone(latest.score), c = data.check;
    const partCharts = PART_KEYS.map((key, idx) => {
      const rows = data.history.map((r) => [r[0], r[2 + idx]]);
      const [en, a, den, dar] = PARTS[key];
      return `<div class="fg-mini"><h3>${ar ? a : en} <b style="color:var(${zone(latest.parts[key].score)[2]})">${Math.round(latest.parts[key].score)}</b></h3><small>${ar ? dar : den}</small>${historySvg(rows, ar, { width: 320, height: 150, ticks: 3, years: true })}</div>`;
    }).join("");
    const method = ar ? `
      <li><b>الزخم:</b> مستوى المؤشر العام مقابل متوسطه لآخر 125 جلسة.</li>
      <li><b>اتساع السوق:</b> نسبة الأسهم التي يتداول سعرها فوق متوسط 50 جلسة.</li>
      <li><b>القوة:</b> عدد الأسهم التي تسجل قمة جديدة لـ 52 أسبوعاً ناقص التي تسجل قاعاً جديداً، كمتوسط 10 جلسات.</li>
      <li><b>التذبذب:</b> تقلب المؤشر في آخر 20 جلسة مقارنة بمتوسطه السنوي. التذبذب الأعلى يعني خوفاً أكثر.</li>
      <li><b>المشاركة:</b> قيمة التداول في الأسهم المرتفعة ناقص المنخفضة كنسبة من إجمالي قيمة التداول، لآخر 10 جلسات.</li>
      <li><b>الملاذ الآمن:</b> أداء بقية السوق مقابل أكبر 10 شركات في آخر 20 جلسة. عندما يلجأ المستثمرون للأسهم القيادية تنخفض القراءة.</li>
      <li>كل مكوّن يُرتَّب مقابل آخر 500 جلسة (حوالي سنتين) ويُعطى درجة من 0 إلى 100، ثم يُحسب المتوسط بأوزان متساوية. التصنيفات: 0–25 خوف شديد، 25–45 خوف، 45–55 محايد، 55–75 طمع، 75–100 طمع شديد.</li>
      <li>لا يوجد سجل منشور للمؤشر العام، لذلك يُعاد بناؤه من أسعار الشركات المدرجة بالأوزان السوقية. مطابقته للأداء الرسمي: شهر ${c.rebuilt1MonthPercent}% مقابل ${c.official1MonthPercent}% رسمياً، ومنذ بداية السنة ${c.rebuiltYtdPercent}% مقابل ${c.officialYtdPercent}%.</li>
      <li>المصادر: سجل الأسعار اليومي من Yahoo Finance، وإقفال اليوم من بيانات TradingView المستخدمة في الموقع. البيانات غير مدققة بشكل مستقل.</li>` : `
      <li><b>Momentum:</b> the All-Share level vs its 125-session average.</li>
      <li><b>Breadth:</b> the share of listed stocks trading above their 50-session average.</li>
      <li><b>Strength:</b> stocks at new 52-week highs minus those at new 52-week lows, averaged over 10 sessions.</li>
      <li><b>Volatility:</b> the index's 20-session volatility vs its 1-year average. Higher volatility scores as more fear.</li>
      <li><b>Participation:</b> value traded in rising stocks minus falling stocks, as a share of all value traded over 10 sessions.</li>
      <li><b>Safe haven:</b> the 20-session return of the rest of the market vs the 10 largest companies. When investors hide in the leaders, the score falls.</li>
      <li>Each part is ranked against its own last 500 sessions (about 2 years) and scored 0–100, then the six are averaged with equal weights. Labels: 0–25 Extreme fear, 25–45 Fear, 45–55 Neutral, 55–75 Greed, 75–100 Extreme greed.</li>
      <li>There is no published All-Share history, so the index is rebuilt from its listed companies, weighted by market value. Check against official performance: 1 month ${c.rebuilt1MonthPercent}% vs ${c.official1MonthPercent}% official; year to date ${c.rebuiltYtdPercent}% vs ${c.officialYtdPercent}%.</li>
      <li>Sources: daily price history from Yahoo Finance; today's close from the TradingView data used across this site. Data is not independently verified.</li>`;
    host.innerHTML = `
      <section class="card fg-summary">
        <div class="fg-grid fg-grid-page">
          <div class="fg-gauge">${gaugeSvg(latest.score)}<div class="fg-score">${Math.round(latest.score)}</div><div class="fg-state" style="color:var(${z[2]})">${ar ? z[4] : z[3]}</div><div class="fg-compare">${compareHtml(latest.compare, ar)}</div></div>
          <div class="fg-parts">${partsHtml(latest, ar)}</div>
        </div>
      </section>
      <section class="card"><div class="fg-head"><h2>${ar ? "السجل الكامل" : "Full history"}</h2><small>${esc(fmtDate(data.history[0][0], ar))} – ${esc(fmtDate(data.tradingDate, ar))}</small></div>${historySvg(data.history, ar, { width: 900, height: 280, ticks: 6, years: true })}</section>
      <section class="card"><div class="fg-head"><h2>${ar ? "المكوّنات عبر الزمن" : "Each part over time"}</h2></div><div class="fg-minis">${partCharts}</div></section>
      <section class="card fg-method"><h2>${ar ? "المنهجية" : "Methodology"}</h2><ul>${method}</ul><p class="fg-disclaimer">${ar ? "لأغراض المعلومات فقط وليس توصية استثمارية." : "For information only. Not investment advice."}</p></section>`;
    document.querySelectorAll("[data-fg-en]").forEach((el) => { el.textContent = ar ? el.dataset.fgAr : el.dataset.fgEn; });
  }

  function render() { renderPanel(); renderPage(); }

  new MutationObserver(() => { if (document.documentElement.lang !== renderedLang) render(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  fetch("./sentiment.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((json) => { if (json?.latest && Array.isArray(json.history) && json.history.length > 20) { data = json; render(); } })
    .catch((error) => console.warn("Fear & Greed unavailable:", error.message));
})();
