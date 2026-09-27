/**
 * Real execution data from Jupiter's quote API. This is what makes ECV a
 * measurement rather than an assumption: we ask the router what a sale of this
 * exact size would actually return, right now.
 *
 * Docs: https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis
 */

const QUOTE_URL = process.env.JUP_QUOTE_URL || 'https://api.jup.ag/swap/v1/quote';

export const MINTS = {
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // Verified against official Kamino xStocks reserve account data, 2026-09-27.
  SPYx: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
  QQQx: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
  NVDAx: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh'
};

/**
 * @returns {Promise<{outUsd:number, impactPct:number, route:string, ok:boolean, error?:string}>}
 */
export async function quoteSell({ mint, amountRaw, decimals = 8, slippageBps = 300 }) {
  const url = `${QUOTE_URL}?inputMint=${mint}&outputMint=${MINTS.USDC}` +
              `&amount=${amountRaw}&slippageBps=${slippageBps}&swapMode=ExactIn&instructionVersion=V2`;
  try {
    if (!/^\d+$/.test(String(amountRaw)) || !(Number(amountRaw) > 0)) throw new Error('Invalid quote amount');
    const res = await fetch(url, { headers: { accept: 'application/json', ...(process.env.JUP_API_KEY ? { 'x-api-key': process.env.JUP_API_KEY } : {}) }, signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, outUsd: 0, impactPct: 100, route: 'none', error: `http_${res.status}` };
    const j = await res.json();
    if (j.priceImpactPct == null || j.priceImpactPct === '' || !Number.isFinite(Number(j.priceImpactPct)) || Math.abs(Number(j.priceImpactPct)) > 1 || !/^\d+$/.test(String(j.outAmount)) || !(Number(j.outAmount) > 0) || !Number.isFinite(Number(j.outAmount)) || !Array.isArray(j.routePlan) || !j.routePlan.length) throw new Error('Invalid Jupiter quote');
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
 */
export async function depthProbe({ mint, decimals = 8, unitPrice, maxImpactPct = 2.5, steps = [0.25, 0.5, 1, 2, 4] }) {
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
  return { routableUsd, curve: results };
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
