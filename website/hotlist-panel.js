// Hot List v2 panel: renders website/hotlist.json (built in the daily update).
(function () {
  const SETUPS = {
    range: ["Range breakout", "اختراق نطاق", "Closed above the high of the previous 20 sessions", "أغلق فوق أعلى سعر في آخر 20 جلسة"],
    "52w": ["52-week high", "قمة 52 أسبوعاً", "Closed above the high of the previous 12 months", "أغلق فوق أعلى سعر في آخر 12 شهراً"],
    squeeze: ["Squeeze release", "انطلاق بعد انكماش", "Broke out after a period of unusually narrow trading", "اختراق بعد فترة تداول ضيقة بشكل غير معتاد"]
  };
  let data = null, renderedLang = null;
  const ar = () => document.documentElement.lang === "ar";
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const signed = (v) => (v > 0 ? "+" : "") + v;
  const kd = (v) => "KD " + (v >= 1e6 ? (v / 1e6).toFixed(1) + "m" : Math.round(v / 1e3) + "k");
  const fmtDate = (d, a) => new Intl.DateTimeFormat(a ? "ar-KW-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(d + "T00:00:00Z"));

  function ring(score, top) {
    const r = 22, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 56 56" class="hl-ring" role="img" aria-label="${score} / 100"><circle cx="28" cy="28" r="${r}" fill="none" stroke="var(--hl-sunk)" stroke-width="6"/><circle cx="28" cy="28" r="${r}" fill="none" stroke="${top ? "var(--hl-gold)" : "var(--hl-green)"}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${((c * score) / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 28 28)"/><text x="28" y="33" text-anchor="middle" font-weight="800" font-size="15" fill="var(--ink)">${score}</text></svg>`;
  }

  function card(r, a) {
    const s = SETUPS[r.setup], t = data.tested[r.setup] || data.tested.all;
    const ticker = a && r.tickerArabic ? r.tickerArabic : r.ticker, name = a && r.nameArabic ? r.nameArabic : r.name;
    const check = (ok, yes, no) => `<div class="${ok ? "y" : "n"}"><i>${ok ? "✓" : "!"}</i><span>${ok ? yes : no}</span></div>`;
    const c = r.checks;
    const checks = a
      ? check(c.volume, `الحجم ${r.volumeRatio}× متوسط 20 جلسة ومستمر 3 أيام`, "الحجم غير مستمر") +
        check(c.trend, "اتجاه صاعد: فوق متوسط 50 جلسة", "ليس في اتجاه صاعد") +
        check(c.strength, `أقوى من ${r.strengthPercentile}% من الأسهم خلال 3 أشهر`, "أضعف من السوق") +
        check(c.close, "أغلق قرب أعلى سعر في اليوم", `أغلق في منتصف نطاق اليوم (${r.closeLocationPercent}%)`) +
        check(c.notStretched, `غير ممتد: ${r.stretchPercent}% فوق متوسط 20 جلسة`, `ممتد ${r.stretchPercent}% فوق متوسط 20 جلسة؛ التراجعات شائعة`)
      : check(c.volume, `Volume ${r.volumeRatio}× its 20-day average, sustained over 3 days`, "Volume not sustained") +
        check(c.trend, "Uptrend: above its 50-day average", "Not in an uptrend") +
        check(c.strength, `Stronger than ${r.strengthPercentile}% of stocks over 3 months`, "Weak vs the market") +
        check(c.close, "Closed near the day's high", `Closed mid-range (${r.closeLocationPercent}% of the day's range)`) +
        check(c.notStretched, `Not stretched: ${r.stretchPercent}% above its 20-day average`, `${r.stretchPercent}% above its 20-day average: stretched, pullbacks are common`);
    const hist = a
      ? `${s[3]}. <b>إشارات ${s[1]} منذ 2022:</b> ${t.n} · تفوقت على السوق ${t.beat10}% من المرات · متوسط <b>${signed(t.excess10)}%</b> مقابل السوق بعد 10 أيام و<b>${signed(t.excess20)}%</b> بعد 20.`
      : `${s[2]}. <b>${s[0]} signals since 2022:</b> ${t.n} · beat the market ${t.beat10}% of the time · average <b>${signed(t.excess10)}%</b> vs the market after 10 days, <b>${signed(t.excess20)}%</b> after 20.`;
    return `<article class="hl-card${r.top ? " top" : ""}">
      <div class="hl-top"><div><div class="hl-tk">${esc(ticker)}</div><div class="hl-nm">${esc(name)}</div>
        <div class="hl-chips"><span class="hl-chip">${a ? s[1] : s[0]}</span>${r.top ? `<span class="hl-chip gold">${a ? "أفضل إعداد" : "Top setup"}</span>` : ""}${c.notStretched ? "" : `<span class="hl-chip warn">${a ? "ممتد" : "Stretched"}</span>`}</div></div>
        <div class="hl-score">${ring(r.score, r.top)}<span>${a ? "درجة الإعداد" : "Setup score"}</span></div></div>
      <div class="hl-levels">
        <div><span>${a ? "الإغلاق" : "Close"}</span><b>${r.close}</b></div>
        <div><span>${a ? "مستوى الاختراق" : "Breakout level"}</span><b>${r.level}</b><small>${signed(r.aboveLevelPercent)}% ${a ? "فوقه" : "above"}</small></div>
        <div><span>${a ? "مستوى الإلغاء" : "Invalidation"}</span><b>${r.stop}</b><small>${r.stopPercent}% ${a ? "من الإغلاق" : "from close"}</small></div>
        <div><span>${a ? "متوسط التداول" : "Avg traded"}</span><b>${kd(r.avgValueKwd)}</b><small>${a ? "يومياً، 20 جلسة" : "per day, 20 days"}</small></div>
      </div>
      <div class="hl-checks">${checks}</div>
      <div class="hl-hist">${hist}</div>
      <button type="button" class="hl-open" data-ticker="${esc(r.ticker)}">${a ? "فتح بحث الشركة ←" : "Open company research →"}</button>
    </article>`;
  }

  function recordLine(a) {
    const live = data.record?.live, all = data.record?.all;
    const pick = live && live.day10?.completed >= 5 ? live : all;
    if (!pick?.day10?.completed) return a ? "سيظهر سجل الأداء بعد اكتمال 10 جلسات من أول إشارة." : "The live track record appears once signals are 10 sessions old.";
    const label = pick === live ? (a ? "الأداء الفعلي منذ الإطلاق" : "Live record since launch") : (a ? "الأداء منذ " + fmtDate(all.since, true) : "Record since " + fmtDate(all.since, false));
    return `<b>${label}:</b> ${pick.day10.completed} ${a ? "إشارة مكتملة" : "completed signals"} · ${a ? "تفوقت على السوق" : "beat the market"} ${pick.day10.beatMarketPercent}% · ${a ? "متوسط" : "average"} ${signed(pick.day10.averageExcess)}% ${a ? "مقابل السوق بعد 10 جلسات" : "vs the market after 10 sessions"}.`;
  }

  function render() {
    const grid = document.querySelector("#hotlist-grid"), count = document.querySelector("#hotlist-count");
    if (!grid || !count || !data) return;
    const a = ar(); renderedLang = document.documentElement.lang;
    count.textContent = data.rows.length + " " + (a ? "سهم" : data.rows.length === 1 ? "STOCK" : "STOCKS");
    const notice = document.querySelector("#hotlist-notice");
    if (notice) notice.innerHTML = a
      ? "أسهم سائلة تغلق فوق قمة سابقة مع ارتفاع الحجم، في اتجاه صاعد ومتفوقة على السوق، مرتبة بدرجة من 0 إلى 100. نحو نصف الإشارات تتأخر عن السوق؛ المكاسب تأتي من عدد أقل من التحركات القوية. ليست توصية استثمارية."
      : "Liquid stocks closing above a previous high on rising volume, in an uptrend and outperforming the market, ranked by a 0–100 setup score. About half of signals lag the market; gains come from a minority of strong moves. Not investment advice.";
    const m = data.market, weak = m.weak;
    const banner = `<div class="hl-banner ${weak ? "weak" : "ok"}"><b>${weak ? (a ? "سوق ضعيف" : "Weak market") : (a ? "ظروف السوق طبيعية" : "Market conditions normal")}</b>${a ? `${m.breadthPercent}% فقط من الأسهم فوق متوسط 50 جلسة` : `${m.breadthPercent}% of stocks are above their 50-day average`}${m.fearGreed ? (a ? ` · مؤشر الخوف والطمع ${m.fearGreed.score}` : ` · Fear & Greed ${m.fearGreed.score}`) : ""}${weak ? (a ? ". الاختراقات أقل في موجات البيع الواسعة؛ تعامل بحذر إضافي." : ". Breakouts are rarer in broad sell-offs; treat any signal with extra caution.") : "."}</div>`;
    const list = data.rows.length
      ? `<div class="hl-cards">${data.rows.map((r) => card(r, a)).join("")}</div>`
      : `<div class="hl-empty"><b>${a ? "لا توجد اختراقات اليوم" : "No breakouts today"}</b>${a ? "لم يغلق أي سهم سائل فوق قمته الأخيرة مع حجم مرتفع واتجاه صاعد. هذا طبيعي في سوق هابط." : "No liquid stock closed above its recent high with rising volume and an uptrend. That is normal in a falling market."}</div>`;
    const recent = (data.recent || []).slice(0, 8);
    const recentHtml = recent.length ? `<details class="hl-recent"><summary>${a ? "الإشارات السابقة ونتائجها" : "Recent signals and how they did"}</summary><div class="hl-table"><table><thead><tr><th>${a ? "التاريخ" : "Date"}</th><th>${a ? "السهم" : "Stock"}</th><th>${a ? "الدرجة" : "Score"}</th><th>${a ? "5 جلسات" : "5 sessions"}</th><th>${a ? "10 جلسات" : "10 sessions"}</th></tr></thead><tbody>${recent.map((s) => `<tr><td>${esc(fmtDate(s.date, a))}</td><td><b>${esc(s.ticker)}</b></td><td>${s.score}</td><td class="${s.excess5 == null ? "" : s.excess5 >= 0 ? "up" : "down"}">${s.excess5 == null ? "—" : signed(s.excess5) + "%"}</td><td class="${s.excess10 == null ? "" : s.excess10 >= 0 ? "up" : "down"}">${s.excess10 == null ? "—" : signed(s.excess10) + "%"}</td></tr>`).join("")}</tbody></table></div><small>${a ? "العائد مقابل السوق العام بعد الإشارة." : "Return vs the All-Share index after the signal."}</small></details>` : "";
    grid.className = "hotlist-v2";
    grid.innerHTML = banner + list + `<p class="hl-record">${recordLine(a)} ${a ? `اختُبرت القواعد على ${data.tested.period}: متوسط ${signed(data.tested.all.excess10)}% مقابل السوق بعد 10 جلسات.` : `Rules tested on ${data.tested.period}: average ${signed(data.tested.all.excess10)}% vs the market after 10 sessions.`}</p>` + recentHtml;
  }

  document.addEventListener("click", (event) => {
    const b = event.target.closest(".hl-open");
    if (b) location.href = "?stock=" + encodeURIComponent(b.dataset.ticker);
  });
  new MutationObserver(() => { if (document.documentElement.lang !== renderedLang) render(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });
  window.MarketHotList = { render };
  fetch("./hotlist.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
    .then((json) => { if (json?.version === 2 && Array.isArray(json.rows)) { data = json; render(); } })
    .catch((error) => console.warn("Hot List unavailable:", error.message));
})();
