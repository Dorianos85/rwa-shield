// Generated from src/api/server.mjs.
import { syntheticQuote } from './quote.mjs';
export function syntheticCurve({ notional, depthUsd }) {
  const relative = [0.1, 0.25, 0.5, 0.65, 0.8, 1, 1.5].map(multiplier => Math.round(depthUsd * multiplier));
  const notionals = [...new Set([10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, notional, ...relative])]
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return notionals.map(notionalUsd => ({
    notionalUsd,
    ...syntheticQuote({ notionalUsd, depthUsd })
  }));
}

export function boundedNumber(raw, fallback, min, max) {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

