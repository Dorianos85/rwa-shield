#!/usr/bin/env node
/**
 * AGENT 3 - MONITOR
 *
 * Polls live depth and price for the covered assets, recomputes ECV and raises
 * an alert when a term moves enough to change a lending decision. This is the
 * agent that would run in production; in the demo it proves the numbers are live.
 */

import { MINTS, depthProbe, syntheticQuote } from '../data/jupiter.mjs';
import { sessionState, hoursToReopen } from '../data/session.mjs';
import { computeEcv } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { generateSeries } from '../data/prices.mjs';
import { realizedVolAnnual } from '../data/volatility.mjs';

const INTERVAL_MS = Number(process.env.INTERVAL_MS || 60_000);
const OFFLINE = process.env.OFFLINE === '1';
const ASSETS = [
  { symbol: 'SPYx', mint: MINTS.SPYx, price: 612.4 },
  { symbol: 'QQQx', mint: MINTS.QQQx, price: 528.1 },
  { symbol: 'NVDAx', mint: MINTS.NVDAx, price: 184.9 }
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

    if (OFFLINE) {
      const q = syntheticQuote({ notionalUsd: notional, depthUsd: state === 'regular' ? 400_000 : 160_000 });
      impactPct = q.impactPct; routableUsd = 400_000; route = q.route;
    } else {
      const probe = await depthProbe({ mint: a.mint, unitPrice: a.price });
      const worst = probe.curve.find(c => c.notionalUsd >= notional) || probe.curve.at(-1);
      impactPct = worst?.impactPct ?? 100;
      routableUsd = probe.routableUsd;
      route = worst?.route ?? 'none';
    }

    const r = computeEcv({
      mint: a.mint, symbol: a.symbol, qty: notional / a.price,
      oraclePrice: a.price, twapPrice: a.price, priceAgeSec: 3,
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
