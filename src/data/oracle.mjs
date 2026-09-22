/**
 * Live USD price feed for xStocks mints.
 *
 * Primary: Jupiter Price API v3 (token usdPrice for the verified mint).
 *   GET https://lite-api.jup.ag/price/v3?ids=<mint>
 * Offline: static last-known priors so the demo never fails closed.
 *
 * priceAgeSec is the age of our last successful observation (ms since fetch),
 * not a hardcoded constant — it grows until the next refresh. Cache TTL is
 * kept below DEFAULT_PARAMS.maxStalenessSec (30s) so a fresh poll stays live.
 */

import { MINTS } from './jupiter.mjs';

const PRICE_URL = process.env.JUP_PRICE_URL || 'https://lite-api.jup.ag/price/v3';
const CACHE_TTL_MS = Number(process.env.PRICE_CACHE_MS || 10_000);

/** Offline priors used only when the network feed fails. */
export const OFFLINE_PRICES = {
  SPYx: 774.0,
  QQQx: 741.0,
  NVDAx: 227.0
};

/** @type {Map<string, { fetchedAt: number, price: number, source: string }>} */
const cache = new Map();

/**
 * @param {{ mint?: string, symbol?: string }} opts
 * @returns {Promise<{ ok: boolean, price: number, priceAgeSec: number, source: string, error?: string }>}
 */
export async function fetchLivePrice({ mint, symbol } = {}) {
  const sym = symbol || Object.entries(MINTS).find(([, m]) => m === mint)?.[0];
  const resolvedMint = mint || (sym ? MINTS[sym] : null);
  if (!resolvedMint) {
    return { ok: false, price: 100, priceAgeSec: 5, source: 'offline-fallback', error: 'unknown_mint' };
  }

  const now = Date.now();
  const hit = cache.get(resolvedMint);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return {
      ok: true,
      price: hit.price,
      priceAgeSec: (now - hit.fetchedAt) / 1000,
      source: hit.source
    };
  }

  try {
    const res = await fetch(`${PRICE_URL}?ids=${resolvedMint}`, {
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.json();
    const entry = body?.[resolvedMint];
    const price = Number(entry?.usdPrice);
    if (!Number.isFinite(price) || price <= 0) throw new Error('bad_price');

    cache.set(resolvedMint, { fetchedAt: now, price, source: 'jupiter' });
    return { ok: true, price, priceAgeSec: 0, source: 'jupiter' };
  } catch (e) {
    if (hit) {
      // Stale cache beats a hard fail: age reflects how old the last good tick is.
      return {
        ok: false,
        price: hit.price,
        priceAgeSec: (now - hit.fetchedAt) / 1000,
        source: 'stale-cache',
        error: String(e.message || e)
      };
    }
    const fallback = OFFLINE_PRICES[sym] ?? 100;
    return {
      ok: false,
      price: fallback,
      priceAgeSec: 5,
      source: 'offline-fallback',
      error: String(e.message || e)
    };
  }
}

/** Clear in-memory price cache (tests / forced refresh). */
export function clearPriceCache() {
  cache.clear();
}
