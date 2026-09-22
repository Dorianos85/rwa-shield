/**
 * Real execution data from Jupiter's quote API. This is what makes ECV a
 * measurement rather than an assumption: we ask the router what a sale of this
 * exact size would actually return, right now.
 *
 * Docs: https://dev.jup.ag/docs/swap/get-quote  (lite-api swap/v1/quote)
 * Legacy host quote-api.jup.ag no longer resolves from many networks; override
 * with JUP_QUOTE_URL if needed.
 */

const QUOTE_URL = process.env.JUP_QUOTE_URL || 'https://lite-api.jup.ag/swap/v1/quote';

/**
 * xStocks (Backed Finance) Solana mints — verified 2026-09-22 against:
 *   - Jupiter token search: GET https://lite-api.jup.ag/tokens/v2/search?query=SPYx|QQQx|NVDAx
 *   - Public registries citing the same addresses (Terminalpedia XSTOCK family;
 *     DexPaprika / Solflare token pages; mint authority S7vYFF…JuRaS)
 * Previous placeholders were wrong: SPYx pointed at TSLAx, QQQx at CRCLx.
 */
export const MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  SPYx: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  QQQx: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
  NVDAx: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
};

const DEPTH_CACHE_TTL_MS = 60_000;
/** @type {Map<string, { at: number, value: any }>} */
const depthCache = new Map();

/**
 * @returns {Promise<{outUsd:number, impactPct:number, route:string, ok:boolean, error?:string}>}
 */
export async function quoteSell({ mint, amountRaw, decimals = 8, slippageBps = 300 }) {
  const url = `${QUOTE_URL}?inputMint=${mint}&outputMint=${MINTS.USDC}` +
              `&amount=${amountRaw}&slippageBps=${slippageBps}&swapMode=ExactIn`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, outUsd: 0, impactPct: 100, route: 'none', error: `http_${res.status}` };
    const j = await res.json();
    return {
      ok: true,
      outUsd: Number(j.outAmount) / 1e6,
      impactPct: Math.abs(Number(j.priceImpactPct ?? 0)) * 100,
      route: (j.routePlan || []).map(r => r.swapInfo?.label).filter(Boolean).join(' > ') || 'direct'
    };
  } catch (e) {
    return { ok: false, outUsd: 0, impactPct: 100, route: 'none', error: String(e.message || e) };
  }
}

/**
 * Depth curve: quote the same asset at increasing sizes to find where the book
 * stops absorbing. Returns the largest notional executable inside maxImpactPct.
 * Results are cached 60s per mint/params so the monitor does not burn API limits.
 */
export async function depthProbe({ mint, decimals = 8, unitPrice, maxImpactPct = 2.5, steps = [0.25, 0.5, 1, 2, 4] }) {
  const cacheKey = `${mint}|${unitPrice}|${maxImpactPct}|${steps.join(',')}`;
  const hit = depthCache.get(cacheKey);
  if (hit && Date.now() - hit.at < DEPTH_CACHE_TTL_MS) return hit.value;

  const results = [];
  for (const mult of steps) {
    const qty = (10_000 * mult) / unitPrice;
    const amountRaw = Math.floor(qty * 10 ** decimals);
    const q = await quoteSell({ mint, amountRaw, decimals });
    results.push({ notionalUsd: 10_000 * mult, ...q });
    if (!q.ok || q.impactPct > maxImpactPct * 3) break;
  }
  const inside = results.filter(r => r.ok && r.impactPct <= maxImpactPct);
  const routableUsd = inside.length ? Math.max(...inside.map(r => r.notionalUsd)) : 0;
  const value = { routableUsd, curve: results, cachedAt: Date.now() };
  depthCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

/** Offline fallback so the demo never dies on a flaky venue. */
export function syntheticQuote({ notionalUsd, depthUsd = 400_000, k = 0.096 }) {
  // convex size-impact curve, calibrated so $100k into a $400k book costs ~1.2%
  const impactPct = 100 * k * Math.pow(notionalUsd / depthUsd, 1.5);
  return {
    ok: true,
    outUsd: notionalUsd * (1 - impactPct / 100),
    impactPct,
    route: 'synthetic:raydium>orca'
  };
}
