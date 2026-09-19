/**
 * Price history. Real loader reads data/prices.<symbol>.json (hourly closes);
 * the generator produces a defensible series when we are offline, including the
 * thing that actually kills lending books: weekend gaps.
 */
import { readFile } from 'node:fs/promises';

export async function loadSeries(symbol) {
  try {
    const raw = await readFile(new URL(`../../data/prices.${symbol}.json`, import.meta.url), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Hourly series with realistic structure: low weekend drift, Monday-open gaps,
 * occasional earnings-style jumps.
 * @returns {{t:number, p:number}[]}
 */
export function generateSeries({ start = Date.UTC(2026, 5, 1), hours = 24 * 110, p0 = 100, seed = 7 } = {}) {
  let s = seed, p = p0;
  const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const gauss = () => {
    const u = Math.max(rnd(), 1e-9), v = Math.max(rnd(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const out = [];
  for (let h = 0; h < hours; h++) {
    const t = start + h * 3600_000;
    const d = new Date(t);
    const day = d.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const hourUtc = d.getUTCHours();
    const isRegular = !isWeekend && hourUtc >= 13 && hourUtc < 20;

    const vol = isRegular ? 0.0016 : (isWeekend ? 0.0009 : 0.0011);
    p *= Math.exp(gauss() * vol);

    // Monday reopen gap: the weekend's drift gets repriced at once
    if (day === 1 && hourUtc === 13) p *= Math.exp(gauss() * 0.012);
    // rare shock
    if (rnd() < 0.0015) p *= Math.exp(gauss() * 0.05);

    out.push({ t, p: Number(p.toFixed(4)) });
  }
  return out;
}
