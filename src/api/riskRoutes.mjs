/** Additive risk-lab endpoints; no changes to the legacy ECV response contract. */
import { getKaminoMarkets, getKaminoReservePair } from '../data/kamino.mjs';
import { getXstockAsset } from '../data/xstocks.mjs';
import { getLiquidity } from '../data/liquidity.mjs';
import { computeKaminoRiskScenario } from '../risk/kaminoRisk.mjs';

const ROUTES = new Set([
  '/api/kamino/markets', '/api/kamino/reserve', '/api/xstocks/asset',
  '/api/liquidity', '/api/risk/baseline', '/api/risk/compare'
]);

export async function handleRiskRequest(req, res, url, rwaParams) {
  if (!ROUTES.has(url.pathname)) return false;
  try {
    if (req.method !== 'GET') return reply(res, 405, { error: 'method_not_allowed' });
    const query = url.searchParams;
    const options = {
      offline: query.get('offline') === '1' || process.env.RISK_OFFLINE === '1',
      refresh: query.get('refresh') === '1'
    };
    if (url.pathname === '/api/kamino/markets') {
      const result = await getKaminoMarkets(options);
      return reply(res, 200, Array.isArray(result) ? { markets: result } : result);
    }
    const market = query.get('market') || undefined;
    const symbol = query.get('symbol') || 'SPYx';
    if (market && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(market)) throw badRequest('invalid_market');
    if (!/^[A-Za-z0-9]{1,12}$/.test(symbol)) throw badRequest('invalid_symbol');
    const notionalUsd = number(query, 'notional', 100_000, 1, 10_000_000);
    let { reserve, fundingReserve, fundingReserveUnavailable } = await getKaminoReservePair({ market, symbol, ...options });
    if (!reserve) throw badRequest('unsupported_market_or_asset');
    reserve = { ...reserve, source: ageSource(reserve.source) };
    if (url.pathname === '/api/kamino/reserve') return reply(res, 200, reserve);
    let asset = await getXstockAsset({ reserve, ...options });
    if (url.pathname === '/api/xstocks/asset') return reply(res, 200, asset);
    let execution = await getLiquidity({ reserve, asset, notionalUsd, ...options });
    // Acquisition latency counts toward validity. A slow quote ladder must not
    // return a fresh-price signal based on the price age before that ladder ran.
    reserve = { ...reserve, source: ageSource(reserve.source) };
    asset = getXstockAsset({ reserve });
    execution = { ...execution, source: ageSource(execution.source) };
    if (fundingReserve) fundingReserve = { ...fundingReserve, source: ageSource(fundingReserve.source) };
    if (url.pathname === '/api/liquidity') return reply(res, 200, execution);
    const baseline = {
      reserve, fundingReserve, fundingReserveUnavailable, asset, execution, rwaParams,
      sources: { kamino: reserve.source, fundingReserve: fundingReserve?.source ?? null, xstocks: asset.source, execution: execution.source }
    };
    if (url.pathname === '/api/risk/baseline') return reply(res, 200, baseline);
    const scenario = { notionalUsd };
    for (const [key, min, max] of [
      ['utilization', 0, 0.999], ['navPrice', 0, 1_000_000],
      ['ammLiquidityUsd', 0, 1_000_000_000_000], ['averageHealthFactor', 0, 10]
    ]) {
      if (query.has(key)) scenario[key] = number(query, key, null, min, max);
    }
    if (query.has('mode')) {
      const mode = query.get('mode');
      if (!['current', 'snapshot-replay', 'sandbox'].includes(mode)) throw badRequest('invalid_mode');
      scenario.mode = mode;
    }
    return reply(res, 200, computeKaminoRiskScenario({ ...baseline, scenario }));
  } catch (error) {
    const message = String(error?.message || error);
    const invalid = error instanceof RangeError || error instanceof TypeError
      || /unsupported|unknown|invalid|not found/i.test(message);
    return reply(res, error.status || (invalid ? 400 : 503), { error: message });
  }
}

function number(query, key, fallback, min, max) {
  if (!query.has(key)) return fallback;
  const raw = query.get(key);
  const value = raw?.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(value) || value < min || value > max) throw badRequest(`invalid_${key}`);
  return value;
}

function badRequest(message) { return Object.assign(new Error(message), { status: 400 }); }
function ageSource(source) {
  if (!source) return source;
  const time = Date.parse(source.timestamp);
  return { ...source, ageSec: Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 1000) : null };
}
function reply(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
  return true;
}
