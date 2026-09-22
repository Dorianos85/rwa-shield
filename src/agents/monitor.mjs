#!/usr/bin/env node
/**
 * AGENT 3 - MONITOR
 *
 * Polls live depth and price for the covered assets, recomputes ECV and raises
 * an alert when a term moves enough to change a lending decision. This is the
 * agent that would run in production; in the demo it proves the numbers are live.
 */

import { MINTS, depthProbe, syntheticQuote } from '../data/jupiter.mjs';
import { fetchLivePrice, OFFLINE_PRICES } from '../data/oracle.mjs';
import { sessionState, hoursToReopen } from '../data/session.mjs';
import { computeEcv } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { generateSeries } from '../data/prices.mjs';
import { realizedVolAnnual } from '../data/volatility.mjs';

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000);
const OFFLINE = process.env.OFFLINE === '1';
const ASSETS = [
  { symbol: 'SPYx', mint: MINTS.SPYx },
  { symbol: 'QQQx', mint: MINTS.QQQx },
  { symbol: 'NVDAx', mint: MINTS.NVDAx }
];

const hist = generateSeries({ hours: 24 * 30 }).map(x => x.p);
const vol = realizedVolAnnual(hist);
let last = {};

async function tick() {
  const state = sessionState();
  const reopen = hoursToReopen();
  console.log(`\n[${new Date().toISOString()}] sesja: ${state} | do otwarcia rynku: ${reopen}h`);

  for (const a of ASSETS) {
    const notional = 100_000;
    let impactPct, routableUsd, route;
    const livePrice = OFFLINE
      ? { price: OFFLINE_PRICES[a.symbol], priceAgeSec: 5, source: 'offline-fallback' }
      : await fetchLivePrice({ mint: a.mint, symbol: a.symbol });
    const price = livePrice.price;

    if (OFFLINE) {
      const q = syntheticQuote({ notionalUsd: notional, depthUsd: state === 'regular' ? 400_000 : 160_000 });
      impactPct = q.impactPct; routableUsd = 400_000; route = q.route;
    } else {
      const probe = await depthProbe({ mint: a.mint, unitPrice: price });
      const worst = probe.curve.find(c => c.notionalUsd >= notional) || probe.curve.at(-1);
      impactPct = worst?.impactPct ?? 100;
      routableUsd = probe.routableUsd;
      route = worst?.route ?? 'none';
    }

    const r = computeEcv({
      mint: a.mint, symbol: a.symbol, qty: notional / price,
      oraclePrice: price, twapPrice: price, priceAgeSec: livePrice.priceAgeSec,
      impactPct, routableUsd, sessionState: state, realizedVolAnnual: vol
    }, DEFAULT_PARAMS);

    const haircut = 100 * (1 - r.ecv / r.oracleValue);
    const prev = last[a.symbol];
    const moved = prev != null && Math.abs(haircut - prev) > 1.0;

    console.log(
      `  ${a.symbol.padEnd(6)} haircut ${haircut.toFixed(2).padStart(6)}%  ` +
      `max_borrow $${Math.round(r.outputs.max_borrow).toLocaleString('en-US').padStart(8)}  ` +
      `impact ${impactPct.toFixed(2)}%  ${r.outputs.borrow_disabled ? 'BREAKER: ' + r.outputs.breaker_reason : 'ok'}` +
      (moved ? `  << ALERT: zmiana o ${(haircut - prev).toFixed(2)} pp` : '')
    );
    last[a.symbol] = haircut;
  }
}

await tick();
if (process.env.ONCE !== '1') setInterval(tick, INTERVAL_MS);
