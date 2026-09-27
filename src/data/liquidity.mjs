import { syntheticQuote } from './jupiter.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { fetchJson, provenance } from './kamino.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const cache = new Map();
const TTL_MS = 60_000;
// Existing dashboard's explicit demo assumption, not measured liquidity.
const SYNTHETIC_DEPTH_USD = DEFAULT_PARAMS.riskLab.syntheticDepthUsd;
const PROBE_SIZES = [2_500, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

export function syntheticLiquidity({ notionalUsd = 100_000, reason = 'Offline deterministic execution model', now = Date.now() } = {}) {
  const curve = [...new Set([...PROBE_SIZES, notionalUsd])].sort((a, b) => a - b).map(notional => {
    const quote = syntheticQuote({ notionalUsd: notional, depthUsd: SYNTHETIC_DEPTH_USD });
    return { notionalUsd: notional, ...quote, impactPct: Math.min(100, quote.impactPct), outUsd: Math.max(0, quote.outUsd), route: 'synthetic execution curve' };
  });
  return {
    routableUsd: SYNTHETIC_DEPTH_USD, curve,
    source: provenance('Deterministic synthetic execution model (existing demo $400k depth assumption)', new Date(now).toISOString(), { fallback: true, fallbackReason: reason, now }),
    measured: false, censored: false, testedNotionalUsd: notionalUsd,
    notes: ['Synthetic depth is a model assumption, not a live quote or an estimate of total DEX liquidity.'],
  };
}

export function normalizeJupiterQuote(data, notionalUsd, expected = {}) {
  const impact = Number(data.priceImpactPct);
  const output = Number(data.outAmount);
  if (data.priceImpactPct == null || data.priceImpactPct === '' || !/^\d+$/.test(String(data.outAmount)) || !Number.isFinite(impact) || Math.abs(impact) > 1 || !Number.isFinite(output) || output <= 0 || !Array.isArray(data.routePlan) || !data.routePlan.length || !(notionalUsd > 0)) throw new Error('Invalid Jupiter quote');
  for (const field of ['inputMint', 'outputMint', 'inAmount']) {
    if (expected[field] != null && String(data[field]) !== String(expected[field])) throw new Error(`Jupiter ${field} mismatch`);
  }
  const reportedPriceImpactPct = Math.abs(impact) * 100;
  const referenceLossPct = Math.max(0, 100 * (1 - output / 1e6 / notionalUsd));
  return { notionalUsd, impactPct: Math.max(reportedPriceImpactPct, referenceLossPct), reportedPriceImpactPct, referenceLossPct,
    referenceBasis: 'Conservative maximum of Jupiter impact versus DEX spot and quote proceeds loss versus reference notional', outUsd: output / 1e6, ok: true,
    route: data.routePlan.map(r => r.swapInfo?.label).filter(v => typeof v === 'string').join(' > ') || 'Jupiter route',
    contextSlot: Number.isSafeInteger(data.contextSlot) ? data.contextSlot : null };
}

export async function getLiquidity({ reserve, asset, notionalUsd = 100_000, offline = false, refresh = false, fetchImpl = fetch, now = Date.now() } = {}) {
  if (!(notionalUsd > 0 && notionalUsd <= 10_000_000)) throw new RangeError('Invalid tested notional');
  const key = `${reserve.mint}:${asset.navPrice}:${notionalUsd}`;
  const prior = cache.get(key);
  if (!offline && !refresh && prior && now - prior.loadedAt < TTL_MS) return { ...prior.result, source: { ...prior.result.source, live: false, cached: true, ageSec: (now - prior.loadedAt) / 1000 } };
  const apiKey = process.env.JUP_API_KEY;
  const configuredUrl = process.env.JUP_QUOTE_URL;
  if (offline || (!apiKey && !configuredUrl)) return syntheticLiquidity({ notionalUsd, now, reason: offline ? 'Offline execution model requested' : 'Jupiter requires an API key; JUP_API_KEY is not configured' });
  try {
    if (!Number.isInteger(reserve.decimals) || !(asset.navPrice > 0)) throw new Error('Verified token decimals or reference price unavailable');
    const quoteUrl = configuredUrl || 'https://api.jup.ag/swap/v1/quote';
    const curve = [];
    for (const amount of [...new Set([...PROBE_SIZES, notionalUsd])].sort((a, b) => a - b)) {
      const raw = Math.floor(amount / asset.navPrice * 10 ** reserve.decimals);
      if (!Number.isSafeInteger(raw) || raw <= 0) throw new Error('Token amount cannot be represented safely');
      const url = new URL(quoteUrl);
      for (const [name, value] of Object.entries({ inputMint: reserve.mint, outputMint: USDC, amount: raw, slippageBps: 50, swapMode: 'ExactIn', instructionVersion: 'V2' })) url.searchParams.set(name, value);
      let data;
      try {
        data = await fetchJson(url, { fetchImpl, timeoutMs: 2500, headers: apiKey ? { 'x-api-key': apiKey } : {} });
      } catch (error) {
        if (error.upstreamCode !== 'COULD_NOT_FIND_ANY_ROUTE') throw error;
        data = { errorCode: error.upstreamCode };
      }
      // A confirmed absence of a route is market evidence, not a network failure.
      // Preserve zero/limited measured depth; never replace it with a demo curve.
      if (data.errorCode === 'COULD_NOT_FIND_ANY_ROUTE') { curve.push({ notionalUsd: amount, ok: false, impactPct: 100, outUsd: 0, route: 'no route' }); break; }
      curve.push(normalizeJupiterQuote(data, amount, { inputMint: reserve.mint, outputMint: USDC, inAmount: raw }));
    }
    const within = curve.filter(p => p.ok && p.impactPct <= DEFAULT_PARAMS.maxImpactPct);
    const result = {
      routableUsd: within.length ? Math.max(...within.map(p => p.notionalUsd)) : 0,
      curve, measured: true, testedNotionalUsd: notionalUsd,
      censored: !!curve.at(-1)?.ok && curve.at(-1).impactPct <= DEFAULT_PARAMS.maxImpactPct,
      source: provenance('Jupiter exact-in quote ladder', new Date(now).toISOString(), { live: true, now }),
      notes: ['Routable USD is the largest tested notional inside the impact limit, not total DEX TVL.', 'USDC output is valued at $1; quote is indicative and is not a guaranteed execution.'],
    };
    cache.set(key, { result, loadedAt: now });
    return result;
  } catch (error) {
    if (prior) return { ...prior.result, source: { ...prior.result.source, live: false, cached: true, fallback: true, fallbackReason: error.message, ageSec: (now - prior.loadedAt) / 1000 } };
    return syntheticLiquidity({ notionalUsd, now, reason: error.message });
  }
}
