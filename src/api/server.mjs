#!/usr/bin/env node
/** Zero-dependency API + static host for the demo dashboard. node src/api/server.mjs */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { computeEcv } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { sessionState, hoursToReopen } from '../data/session.mjs';
import { syntheticQuote, depthProbe, MINTS } from '../data/jupiter.mjs';
import { fetchLivePrice, OFFLINE_PRICES } from '../data/oracle.mjs';
import { generateSeries, loadSeries } from '../data/prices.mjs';
import { realizedVolAnnual } from '../data/volatility.mjs';
import { runBacktest } from '../backtest/engine.mjs';
import { SCENARIOS } from '../backtest/scenarios.mjs';

const PORT = Number(process.env.PORT || 8787);
const ROOT = new URL('../../', import.meta.url);

// Two parameter sets, on purpose:
//  - DEFAULT_PARAMS are our priors - they express the thesis (a closed market is
//    worth a haircut) and drive the pricing demo.
//  - data/params.fitted.json is what the calibrator concluded from the data.
//    On the synthetic series it sets the weekend modifier to 1.0, i.e. the data
//    does NOT justify our favourite term. We show that instead of hiding it.
// PARAMS_MODE=fitted changes the initial mode. Every API route also accepts
// ?params=priors|fitted so the stage demo can switch without a server restart.
let FITTED = null;
try {
  FITTED = JSON.parse(await readFile(new URL('data/params.fitted.json', ROOT), 'utf8'));
} catch { /* not calibrated yet */ }
const INITIAL_PARAMS_MODE = process.env.PARAMS_MODE === 'fitted' && FITTED ? 'fitted' : 'priors';

const SERIES = (await loadSeries('SPYx')) ?? generateSeries();
const VOL = realizedVolAnnual(SERIES.map(x => x.p));
const backtestCache = new Map();

const PRICES = { ...OFFLINE_PRICES };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    const selected = selectParams(url);
    if (url.pathname === '/api/state') return json(res, {
      session: sessionState(), hoursToReopen: hoursToReopen(),
      paramsSource: selected.source, paramsMode: selected.mode,
      fittedAvailable: Boolean(FITTED), params: selected.params,
      assets: Object.keys(PRICES), vol: VOL
    });

    if (url.pathname === '/api/ecv') {
      const requestedSymbol = url.searchParams.get('symbol') || 'SPYx';
      const symbol = Object.hasOwn(PRICES, requestedSymbol) ? requestedSymbol : 'SPYx';
      const notional = boundedNumber(url.searchParams.get('notional'), 100_000, 10_000, 1_000_000);
      const requestedState = url.searchParams.get('session') || sessionState();
      const state = ['regular', 'afterHours', 'weekend', 'holiday'].includes(requestedState) ? requestedState : sessionState();
      const depthUsd = boundedNumber(url.searchParams.get('depth'), 400_000, 10_000, 1_200_000);
      const live = url.searchParams.get('live') === '1';
      const livePrice = await fetchLivePrice({ mint: MINTS[symbol], symbol });
      const price = livePrice.price || PRICES[symbol] || 100;
      const priceAgeSec = livePrice.priceAgeSec;

      let impactPct, routableUsd, route, curve;
      let quoteSource = 'synthetic', liveError = null;
      if (live) {
        try {
          const probe = await withTimeout(
            depthProbe({
              mint: MINTS[symbol], unitPrice: price,
              steps: [1, 2.5, 5, 10, 25, 50, 100]
            }),
            3_500,
            'jupiter_timeout'
          );
          const usable = probe.curve.some(point => point.ok);
          if (!usable) throw new Error(probe.curve.at(-1)?.error || 'no_route');
          const hit = probe.curve.find(point => point.notionalUsd >= notional) || probe.curve.at(-1);
          impactPct = hit?.impactPct ?? 100;
          routableUsd = probe.routableUsd;
          route = hit?.route ?? 'none';
          curve = probe.curve;
          quoteSource = 'jupiter';
        } catch (error) {
          liveError = String(error.message || error);
        }
      }
      if (quoteSource !== 'jupiter') {
        const q = syntheticQuote({ notionalUsd: notional, depthUsd });
        impactPct = q.impactPct; routableUsd = depthUsd; route = 'offline:synthetic-curve';
        curve = syntheticCurve({ notional, depthUsd });
        if (live) quoteSource = 'offline-fallback';
      }

      const r = computeEcv({
        mint: MINTS[symbol] ?? symbol, symbol, qty: notional / price,
        oraclePrice: price, twapPrice: price, priceAgeSec,
        impactPct, routableUsd, sessionState: state, realizedVolAnnual: VOL,
        routeLabel: route
      }, selected.params);
      return json(res, {
        ...r, session: state, impactPct, route, live,
        price, priceAgeSec, priceSource: livePrice.source,
        quoteSource, liveError, depthCurve: curve,
        paramsMode: selected.mode, paramsSource: selected.source,
        limits: {
          maxImpactPct: selected.params.maxImpactPct,
          breakerImpactPct: selected.params.maxImpactPct * 2,
          depthFloorUsd: selected.params.depthFloorUsd
        }
      });
    }

    if (url.pathname === '/api/backtest') {
      if (!backtestCache.has(selected.mode)) {
        backtestCache.set(selected.mode, SCENARIOS.map(sc => {
          const r = runBacktest(sc.transform(SERIES), { params: selected.params, depthStressFactor: sc.depthStressFactor, label: sc.id });
          return {
            id: sc.id, label: sc.label,
            fixedBadDebt: Math.round(r.fixed.badDebt), ecvBadDebt: Math.round(r.ecv.badDebt),
            avoided: Math.round(r.delta.badDebtAvoided), lentRatio: r.delta.lentRatio,
            offHours: r.ecv.offHoursLiquidations, refusals: r.ecv.refusals
          };
        }));
      }
      return json(res, backtestCache.get(selected.mode));
    }

    if (url.pathname === '/api/agents') {
      const out = {};
      for (const [k, f] of [['calibration', 'data/params.fitted.json'], ['adversary', 'data/adversary.json']]) {
        try { out[k] = JSON.parse(await readFile(new URL(f, ROOT), 'utf8')); } catch { out[k] = null; }
      }
      return json(res, out);
    }

    const file = url.pathname === '/' ? 'web/index.html' : url.pathname.replace(/^\//, '');
    const body = await readFile(new URL(file, ROOT));
    res.writeHead(200, { 'content-type': mime(file) });
    return res.end(body);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: String(e.message || e) }));
  }
});

server.listen(PORT, () => {
  console.log(`RWA Shield demo:  http://localhost:${PORT}`);
  console.log(`parametry: ${selectParams().source} | seria: ${SERIES.length}h | vol ${(VOL * 100).toFixed(1)}%`);
});

function selectParams(url) {
  const requested = url?.searchParams.get('params') || INITIAL_PARAMS_MODE;
  if (requested === 'fitted' && FITTED?.params) {
    return {
      mode: 'fitted', params: FITTED.params,
      source: `fitted ${FITTED.fittedAt?.slice(0, 16) ?? ''}`.trim()
    };
  }
  return { mode: 'priors', params: DEFAULT_PARAMS, source: 'priors (default)' };
}

function syntheticCurve({ notional, depthUsd }) {
  const relative = [0.1, 0.25, 0.5, 0.65, 0.8, 1, 1.5].map(multiplier => Math.round(depthUsd * multiplier));
  const notionals = [...new Set([10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, notional, ...relative])]
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  return notionals.map(notionalUsd => ({
    notionalUsd,
    ...syntheticQuote({ notionalUsd, depthUsd })
  }));
}

function boundedNumber(raw, fallback, min, max) {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

async function withTimeout(promise, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}
function mime(f) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(f)] || 'text/plain';
}
