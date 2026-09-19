/** Realized volatility from a price series. Annualised, 24/7 basis (crypto venue). */

export function realizedVolAnnual(prices, windowDays = 14, samplesPerDay = 24) {
  const n = Math.min(prices.length - 1, windowDays * samplesPerDay);
  if (n < 2) return 0.2;
  const rets = [];
  for (let i = prices.length - n; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    if (a > 0 && b > 0) rets.push(Math.log(b / a));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  const perSample = Math.sqrt(varr);
  return perSample * Math.sqrt(samplesPerDay * 365);
}

/** Standard deviations the current price sits from the window mean. */
export function sigmaFromMean(prices, windowDays = 14, samplesPerDay = 24) {
  const n = Math.min(prices.length, windowDays * samplesPerDay);
  const w = prices.slice(-n);
  const mean = w.reduce((s, p) => s + p, 0) / w.length;
  const sd = Math.sqrt(w.reduce((s, p) => s + (p - mean) ** 2, 0) / w.length);
  if (sd === 0) return 0;
  return (w[w.length - 1] - mean) / sd;
}
