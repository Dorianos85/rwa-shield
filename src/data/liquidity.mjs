import { syntheticQuote } from './jupiter.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { fetchJson, provenance } from './kamino.mjs';

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const cache = new Map();
const inFlight = new Map();
const NATIVE_FETCH = globalThis.fetch;
const TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 64;
const MAX_IN_FLIGHT = 8;
const DEFAULT_QUOTE_URL = 'https://api.jup.ag/swap/v1/quote';
// Existing dashboard's explicit demo assumption, not measured liquidity.
const SYNTHETIC_DEPTH_USD = DEFAULT_PARAMS.riskLab.syntheticDepthUsd;
const PROBE_SIZES = [2_500, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

/** Serialize request starts across all ladders. Inject a clock/sleep in tests. */
export function createQuoteScheduler({ clock = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let tail = Promise.resolve();
  let nextAllowed = 0;
  return intervalMs => {
    const turn = tail.then(async () => {
      const delay = Math.max(0, nextAllowed - clock());
      if (delay) await sleep(delay);
      nextAllowed = clock() + intervalMs;
    });
    tail = turn.catch(() => {});
    return turn;
  };
}
const scheduleNativeQuote = createQuoteScheduler();

function saveCache(key, entry) {
  cache.delete(key);
  cache.set(key, entry);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
}

function observedCache(result, now, reason) {
  const timestamp = result.source.timestamp;
  return { ...result, source: { ...result.source,
    ...provenance(result.source.source, timestamp, { cached: result.measured, fallback: Boolean(reason) || result.source.fallback,
      fallbackReason: reason || result.source.fallbackReason, now }) } };
}

function unavailableLiquidity({ notionalUsd, maxImpactPct, reason, endpoint, now }) {
  return { routableUsd: 0, curve: [], available: false, measured: false, censored: false,
    testedNotionalUsd: notionalUsd, testedLimitUsd: null, maxImpactPct,
    source: { ...provenance('Jupiter exact-in quote ladder unavailable', null, { fallback: true, fallbackReason: reason, now }), endpoint },
    notes: ['Execution liquidity is unavailable. Zero is a fail-closed sentinel, not a measured zero-depth result.', 'Choose the explicit synthetic mode to explore a modeled execution curve.'] };
}

export function syntheticLiquidity({ notionalUsd = 100_000, maxImpactPct = DEFAULT_PARAMS.maxImpactPct, reason = 'Explicit deterministic execution model', now = Date.now() } = {}) {
  const curve = [...new Set([...PROBE_SIZES, notionalUsd])].sort((a, b) => a - b).map(notional => {
    const quote = syntheticQuote({ notionalUsd: notional, depthUsd: SYNTHETIC_DEPTH_USD });
    return { notionalUsd: notional, ...quote, impactPct: Math.min(100, quote.impactPct), outUsd: Math.max(0, quote.outUsd), route: 'synthetic execution curve' };
  });
  return {
    routableUsd: SYNTHETIC_DEPTH_USD, curve,
    source: provenance('Deterministic synthetic execution model (existing demo $400k depth assumption)', new Date(now).toISOString(), { fallback: true, fallbackReason: reason, now }),
    measured: false, available: true, synthetic: true, censored: false, testedNotionalUsd: notionalUsd,
    testedLimitUsd: Math.max(...curve.map(p => p.notionalUsd)), maxImpactPct,
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

export async function getLiquidity({ reserve, asset, notionalUsd = 100_000, synthetic = false, offline = false, refresh = false,
  maxImpactPct = DEFAULT_PARAMS.maxImpactPct,
  fetchImpl = fetch, now, clock = now === undefined ? Date.now : () => now,
  schedule = fetchImpl === NATIVE_FETCH ? scheduleNativeQuote : async () => {} } = {}) {
  if (!(notionalUsd > 0 && notionalUsd <= 10_000_000)) throw new RangeError('Invalid tested notional');
  if (!Number.isFinite(maxImpactPct) || maxImpactPct <= 0 || maxImpactPct > 100) throw new RangeError('Invalid maximum quote impact');
  if (synthetic) return syntheticLiquidity({ notionalUsd, maxImpactPct, now: clock(), reason: 'Explicit synthetic execution model requested' });
  const apiKey = process.env.JUP_API_KEY;
  const quoteUrl = process.env.JUP_QUOTE_URL || DEFAULT_QUOTE_URL;
  const key = `${quoteUrl}:${reserve.mint}:${reserve.decimals}:${asset.navPrice}:${notionalUsd}:${maxImpactPct}`;
  const prior = cache.get(key);
  if (offline) return prior?.result.measured
    ? observedCache(prior.result, clock(), 'Offline requested; using last measured Jupiter quotes')
    : unavailableLiquidity({ notionalUsd, maxImpactPct, endpoint: quoteUrl, now: clock(), reason: 'Offline requested; no measured Jupiter quotes cached' });
  if (prior && clock() - prior.loadedAt < TTL_MS && (!refresh || prior.failed)) return observedCache(prior.result, clock());
  if (inFlight.has(key)) return inFlight.get(key);
  if (inFlight.size >= MAX_IN_FLIGHT) return unavailableLiquidity({ notionalUsd, maxImpactPct, endpoint: quoteUrl, now: clock(), reason: 'Jupiter quote queue is busy; try again after the active ladders finish' });
  const pending = probeLiquidity({ reserve, asset, notionalUsd, maxImpactPct, fetchImpl, clock, schedule, apiKey, quoteUrl, key, prior });
  inFlight.set(key, pending);
  try { return await pending; } finally { inFlight.delete(key); }
}

async function probeLiquidity({ reserve, asset, notionalUsd, maxImpactPct, fetchImpl, clock, schedule, apiKey, quoteUrl, key, prior }) {
  try {
    if (!Number.isInteger(reserve.decimals) || !(asset.navPrice > 0)) throw new Error('Verified token decimals or reference price unavailable');
    const curve = [];
    let oldestProbeAt;
    for (const amount of [...new Set([...PROBE_SIZES, notionalUsd])].sort((a, b) => a - b)) {
      const raw = Math.floor(amount / asset.navPrice * 10 ** reserve.decimals);
      if (!Number.isSafeInteger(raw) || raw <= 0) throw new Error('Token amount cannot be represented safely');
      const url = new URL(quoteUrl);
      for (const [name, value] of Object.entries({ inputMint: reserve.mint, outputMint: USDC, amount: raw, slippageBps: 50, swapMode: 'ExactIn', instructionVersion: 'V2' })) url.searchParams.set(name, value);
      let data;
      try {
        await schedule(apiKey ? 1000 : 2000);
        oldestProbeAt ??= clock();
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
    const within = curve.filter(p => p.ok && p.impactPct <= maxImpactPct);
    const result = {
      routableUsd: within.length ? Math.max(...within.map(p => p.notionalUsd)) : 0,
      curve, available: true, measured: true, testedNotionalUsd: notionalUsd,
      testedLimitUsd: curve.at(-1)?.notionalUsd ?? null, maxImpactPct,
      censored: !!curve.at(-1)?.ok && curve.at(-1).impactPct <= maxImpactPct,
      source: { ...provenance('Jupiter exact-in quote ladder', new Date(oldestProbeAt).toISOString(), { live: true, now: clock() }), endpoint: quoteUrl },
      notes: ['Routable USD is the largest tested notional inside the impact limit, not total DEX TVL.', 'USDC output is valued at $1; quote is indicative and is not a guaranteed execution.'],
    };
    saveCache(key, { result, loadedAt: clock(), failed: false });
    return result;
  } catch (error) {
    const result = prior?.result.measured ? observedCache(prior.result, clock(), error.message)
      : unavailableLiquidity({ notionalUsd, maxImpactPct, endpoint: quoteUrl, now: clock(), reason: error.message });
    saveCache(key, { result, loadedAt: clock(), failed: true });
    return result;
  }
}
