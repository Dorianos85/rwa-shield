/** Browser transport for the repository dashboard's synthetic/offline API path. */
import { computeEcv } from './core/model.mjs';
import { DEFAULT_PARAMS } from './core/params.mjs';
import { syntheticQuote } from './core/quote.mjs';
import { sessionState, hoursToReopen } from './core/session.mjs';
import { syntheticCurve, boundedNumber } from './core/api-helpers.mjs';
import { PRICES, MINTS, VOL, BACKTEST } from './core/data.mjs';

export async function demoApi(path) {
  const url = new URL(path, location.origin);
  const params = DEFAULT_PARAMS;
  const paramsMode = 'priors';
  const paramsSource = 'priors (default) · static synthetic demo';
  if (url.pathname === '/api/state') return {
    session: sessionState(), hoursToReopen: hoursToReopen(),
    paramsSource, paramsMode, fittedAvailable: false, params,
    assets: Object.keys(PRICES), vol: VOL
  };
  if (url.pathname === '/api/agents') return { calibration: null, adversary: null };
  if (url.pathname === '/api/backtest') return structuredClone(BACKTEST);
  if (url.pathname !== '/api/ecv') throw new Error('Unsupported static demo route');
  const requestedSymbol = url.searchParams.get('symbol') || 'SPYx';
  const symbol = Object.hasOwn(PRICES, requestedSymbol) ? requestedSymbol : 'SPYx';
  const notional = boundedNumber(url.searchParams.get('notional'), 100000, 10000, 1000000);
  const requestedState = url.searchParams.get('session') || sessionState();
  const state = ['regular', 'afterHours', 'weekend', 'holiday'].includes(requestedState) ? requestedState : sessionState();
  const depthUsd = boundedNumber(url.searchParams.get('depth'), 400000, 10000, 1200000);
  const price = PRICES[symbol];
  const quote = syntheticQuote({ notionalUsd: notional, depthUsd });
  const route = 'offline:synthetic-curve';
  const result = computeEcv({
    mint: MINTS[symbol], symbol, qty: notional / price,
    oraclePrice: price, twapPrice: price, priceAgeSec: 4,
    impactPct: quote.impactPct, routableUsd: depthUsd, sessionState: state,
    realizedVolAnnual: VOL, routeLabel: route
  }, params);
  return {
    ...result, session: state, impactPct: quote.impactPct, route, live: false,
    quoteSource: 'synthetic', liveError: null,
    depthCurve: syntheticCurve({ notional, depthUsd }), paramsMode, paramsSource,
    limits: {
      maxImpactPct: params.maxImpactPct, breakerImpactPct: params.maxImpactPct * 2,
      depthFloorUsd: params.depthFloorUsd
    }
  };
}
