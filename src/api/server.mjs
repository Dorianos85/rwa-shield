#!/usr/bin/env node
/** Zero-dependency API + static host for the demo dashboard. node src/api/server.mjs */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { computeEcv } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { sessionState, hoursToReopen } from '../data/session.mjs';
import { syntheticQuote, depthProbe, MINTS } from '../data/jupiter.mjs';
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
// PARAMS_MODE=fitted switches the pricing demo to the fitted set.
let PARAMS = DEFAULT_PARAMS, paramsSource = 'priors (default)';
let FITTED = null;
try {
  FITTED = JSON.parse(await readFile(new URL('data/params.fitted.json', ROOT), 'utf8'));
  if (process.env.PARAMS_MODE === 'fitted') { PARAMS = FITTED.params; paramsSource = `fitted ${FITTED.fittedAt?.slice(0, 16) ?? ''}`; }
} catch { /* not calibrated yet */ }

const SERIES = (await loadSeries('SPYx')) ?? generateSeries();
const VOL = realizedVolAnnual(SERIES.map(x => x.p));
let backtestCache = null;

const PRICES = { SPYx: 612.4, QQQx: 528.1, NVDAx: 184.9 };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === '/api/state') return json(res, {
      session: sessionState(), hoursToReopen: hoursToReopen(),
      paramsSource, params: PARAMS, assets: Object.keys(PRICES), vol: VOL
    });

    if (url.pathname === '/api/ecv') {
      const symbol = url.searchParams.get('symbol') || 'SPYx';
      const notional = Number(url.searchParams.get('notional') || 100_000);
      const state = url.searchParams.get('session') || sessionState();
      const depthUsd = Number(url.searchParams.get('depth') || 400_000);
      const live = url.searchParams.get('live') === '1';
      const price = PRICES[symbol] ?? 100;

      let impactPct, routableUsd, route;
      if (live) {
        const probe = await depthProbe({ mint: MINTS[symbol], unitPrice: price });
        const hit = probe.curve.find(c => c.notionalUsd >= notional) || probe.curve.at(-1);
        impactPct = hit?.impactPct ?? 100; routableUsd = probe.routableUsd; route = hit?.route ?? 'none';
      } else {
        const q = syntheticQuote({ notionalUsd: notional, depthUsd });
        impactPct = q.impactPct; routableUsd = depthUsd; route = q.route;
      }

      const r = computeEcv({
        mint: MINTS[symbol] ?? symbol, symbol, qty: notional / price,
        oraclePrice: price, twapPrice: price, priceAgeSec: 4,
        impactPct, routableUsd, sessionState: state, realizedVolAnnual: VOL,
        routeLabel: route
      }, PARAMS);
      return json(res, { ...r, session: state, impactPct, route, live });
    }

    if (url.pathname === '/api/backtest') {
      if (!backtestCache) {
        backtestCache = SCENARIOS.map(sc => {
          const r = runBacktest(sc.transform(SERIES), { params: PARAMS, depthStressFactor: sc.depthStressFactor, label: sc.id });
          return {
            id: sc.id, label: sc.label,
            fixedBadDebt: Math.round(r.fixed.badDebt), ecvBadDebt: Math.round(r.ecv.badDebt),
            avoided: Math.round(r.delta.badDebtAvoided), lentRatio: r.delta.lentRatio,
            offHours: r.ecv.offHoursLiquidations, refusals: r.ecv.refusals
          };
        });
      }
      return json(res, backtestCache);
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
  console.log(`parametry: ${paramsSource} | seria: ${SERIES.length}h | vol ${(VOL * 100).toFixed(1)}%`);
});

function json(res, obj) {
  res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}
function mime(f) {
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[extname(f)] || 'text/plain';
}
