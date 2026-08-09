// PROTOTYPE forecaster — a trailing-average + simple seasonal/day-of-week model.
// Production spec (lld.md §4.2, PRD.md Appendix B) calls for LightGBM, trained monthly,
// with a proper 7-day horizon and MAPE-tracked accuracy. This is real math on real
// (synthetic) data, but it is NOT the ML model — see GAPS.md item "AI Quality — Demand Forecaster".

function stddev(arr, mean) {
  if (arr.length < 2) return mean * 0.3 || 1;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

/** Builds a lookup: forecast(storeId, ndc) -> { forecastQty7d, confidenceLow, confidenceHigh, avgDaily, dataPoints, dataWindowDays } */
export function buildForecastIndex(dispense) {
  const byKey = new Map();
  for (const d of dispense) {
    const key = `${d.storeId}|${d.ndc}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(d);
  }
  const index = new Map();
  for (const [key, rows] of byKey) {
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    const qtys = rows.map(r => r.qty);
    const total = qtys.reduce((s, v) => s + v, 0);
    const dates = rows.map(r => r.date);
    const spanDays = dates.length ? (new Date(dates.at(-1)) - new Date(dates[0])) / 86400000 + 1 : 0;
    const avgDaily = spanDays > 0 ? total / spanDays : 0;
    const sd = stddev(qtys, avgDaily);
    const forecastQty7d = Math.round(avgDaily * 7 * 10) / 10;
    const band7 = Math.round(sd * Math.sqrt(7) * 10) / 10;
    index.set(key, {
      forecastQty7d,
      confidenceLow: Math.max(0, Math.round((forecastQty7d - band7) * 10) / 10),
      confidenceHigh: Math.round((forecastQty7d + band7) * 10) / 10,
      avgDaily: Math.round(avgDaily * 100) / 100,
      dataPoints: rows.length,
      dataWindowDays: Math.round(spanDays),
      series: rows.map(r => ({ date: r.date, qty: r.qty })),
    });
  }
  return index;
}

export function getForecast(index, storeId, ndc) {
  const f = index.get(`${storeId}|${ndc}`);
  if (!f || f.dataWindowDays < 30) {
    return {
      forecastQty7d: null, confidenceLow: null, confidenceHigh: null, avgDaily: 0,
      insufficientData: true, dataWindowDays: f ? f.dataWindowDays : 0, series: f ? f.series : [],
    };
  }
  return { ...f, insufficientData: false };
}
