import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodeReserveConfig, getKaminoMarkets, getKaminoReserve, getKaminoReservePair, normalizeReserve, provenance, USDC_MINT } from './kamino.mjs';
import { getXstockAsset } from './xstocks.mjs';
import { getLiquidity, normalizeJupiterQuote } from './liquidity.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../../data/kamino.snapshot.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const offline = { offline: true, now: Date.parse(snapshot.capturedAt) + 1000 };

test('USDC funding reserve is canonical and independent of the selected collateral', async () => {
  const a = await getKaminoReservePair({ ...offline, symbol: 'TSLAx' });
  const b = await getKaminoReservePair({ ...offline, symbol: 'SPYx' });
  assert.deepEqual(a.fundingReserve, b.fundingReserve);
  assert.equal(a.fundingReserve.mint, USDC_MINT);
  assert.equal(a.fundingReserve.symbol, 'USDC');
  assert.equal(a.fundingReserve.market, a.reserve.market);
  assert.equal(a.fundingReserve.decimals, 6);
  const recorded = snapshot.markets[0].metrics.find(row => row.liquidityTokenMint === USDC_MINT);
  assert.equal(a.fundingReserve.currentUtilization, Number(recorded.totalBorrowUsd) / Number(recorded.totalSupplyUsd));
  assert.notEqual(a.fundingReserve.currentUtilization, a.reserve.currentUtilization);
  assert.equal(a.fundingReserve.source.timestamp, a.reserve.source.timestamp);
  assert.ok(a.fundingReserve.borrowRateCurve.length > 0);
});

test('a market without USDC returns unavailable instead of another reserve', async () => {
  const result = await getKaminoReservePair({ ...offline, market: snapshot.markets[1].config.lendingMarket });
  assert.equal(result.reserve.symbol, 'SPYx');
  assert.equal(result.fundingReserve, null);
  assert.match(result.fundingReserveUnavailable, /No verified USDC/);
});

test('recorded official accounts decode units, caps, real curve, identity and thresholds', async () => {
  const reserve = await getKaminoReserve(offline);
  assert.equal(reserve.symbol, 'SPYx');
  assert.equal(reserve.mint, 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W');
  assert.equal(reserve.configuredLtv, 0.73);
  assert.equal(reserve.liquidationThreshold, 0.75);
  assert.equal(reserve.borrowCapTokens, 5000);
  assert.equal(reserve.supplyCapTokens, 20000);
  assert.equal(reserve.decimals, 8);
  assert.equal(reserve.firstCurveKink, .8);
  assert.equal(reserve.optimalUtilization, null);
  assert.equal(reserve.borrowCapUsd, 5000 * reserve.kaminoOraclePrice);
  assert.equal(reserve.currentUtilization, reserve.currentBorrowedUsd / reserve.tvlUsd);
  assert.equal(reserve.source.live, false);
  assert.equal(reserve.source.fallback, true);
});

test('market membership is verified separately and unknown selections rejected', async () => {
  const { markets } = await getKaminoMarkets(offline);
  assert.equal(markets.length, 2);
  assert.deepEqual(markets[1].reserves.map(r => r.symbol), ['SPYx', 'QQQx', 'NVDAx']);
  await assert.rejects(getKaminoReserve({ ...offline, market: markets[1].address, symbol: 'TSLAx' }), /not listed/);
  await assert.rejects(getKaminoReserve({ ...offline, market: 'bad' }), /Unknown/);
  await assert.rejects(getKaminoReserve({ ...offline, symbol: 'fake' }), /Unknown/);
});

test('failed network falls back truthfully without changing observed timestamps', async () => {
  const reserve = await getKaminoReserve({ refresh: true, fetchImpl: async () => { throw new Error('rate limited'); } });
  assert.equal(reserve.source.live, false);
  assert.equal(reserve.source.timestamp, snapshot.capturedAt);
  assert.match(reserve.source.fallbackReason, /rate limited/);
});

test('bad account data cannot fabricate risk settings', () => {
  const bundle = structuredClone(snapshot.markets[0]);
  const row = bundle.metrics[0];
  bundle.accounts[0].data = 'bad';
  const reserve = normalizeReserve(row, bundle, { source: provenance('test', snapshot.capturedAt) });
  assert.equal(reserve.liquidationThreshold, null);
  assert.equal(reserve.borrowCapUsd, null);
  assert.equal(reserve.unavailable.borrowCapUsd.available, false);
  assert.throws(() => decodeReserveConfig(snapshot.markets[0].accounts[0].data, { mint: 'wrong' }), /identity/);
  assert.throws(() => normalizeReserve({ ...row, totalSupplyUsd: 'NaN' }, bundle), /Invalid/);
});

test('reference proxy preserves price age and explicitly marks NAV/volatility limitations', async () => {
  const reserve = await getKaminoReserve(offline);
  const asset = getXstockAsset({ reserve, now: offline.now });
  assert.equal(asset.navPrice, reserve.kaminoOraclePrice);
  assert.equal(asset.issuerNav.available, false);
  assert.equal(asset.source.independentNav, false);
  assert.ok(asset.priceAgeSec > asset.priceAgeAtCaptureSec);
  assert.ok(asset.priceAgeAtCaptureSec > 30);
  assert.equal(asset.source.live, false);
});

test('explicit synthetic liquidity never claims live and finite quote ladder worsens with size', async () => {
  const reserve = await getKaminoReserve(offline);
  const asset = getXstockAsset({ reserve });
  const execution = await getLiquidity({ reserve, asset, synthetic: true });
  assert.equal(execution.source.live, false);
  assert.equal(execution.measured, false);
  assert.equal(execution.source.fallback, true);
  for (let i = 1; i < execution.curve.length; i++) assert.ok(execution.curve[i].impactPct >= execution.curve[i - 1].impactPct);
  assert.ok(execution.curve.every(p => Number.isFinite(p.outUsd) && p.outUsd >= 0));
});

test('Jupiter decimal impact converts to percent points and raw USDC to dollars', () => {
  const quote = normalizeJupiterQuote({ priceImpactPct: '.012', outAmount: '98800000000', routePlan: [{ swapInfo: { label: 'Orca' } }] }, 100000);
  assert.ok(Math.abs(quote.impactPct - 1.2) < 1e-9);
  assert.equal(quote.outUsd, 98800);
  assert.throws(() => normalizeJupiterQuote({ priceImpactPct: 'NaN', outAmount: '42' }, 10), /Invalid/);
});

test('Jupiter oracle-to-DEX basis loss cannot be hidden by small venue impact', () => {
  const quote = normalizeJupiterQuote({ priceImpactPct: '.01', outAmount: '70000000000', routePlan: [{ swapInfo: { label: 'Orca' } }] }, 100000);
  assert.ok(Math.abs(quote.impactPct - 30) < 1e-9);
  assert.equal(quote.reportedPriceImpactPct, 1);
  assert.throws(() => normalizeJupiterQuote({ priceImpactPct: null, outAmount: '42', routePlan: [{}] }, 10), /Invalid/);
  assert.throws(() => normalizeJupiterQuote({ priceImpactPct: '.01', outAmount: '42', routePlan: [{}], inputMint: 'wrong' }, 10, {inputMint:'verified'}), /mismatch/);
});

test('live quote ladder validates amounts and API failure returns marked last-known cache', async () => {
  const previous = process.env.JUP_QUOTE_URL;
  process.env.JUP_QUOTE_URL = 'https://example.invalid/quote';
  try {
    const reserve = await getKaminoReserve(offline);
    const asset = getXstockAsset({ reserve });
    const response = async url => {
      const query = new URL(url).searchParams;
      const inAmount = query.get('amount');
      return { ok: true, json: async () => ({ inputMint: query.get('inputMint'), outputMint: query.get('outputMint'), inAmount,
        outAmount: String(Math.floor(Number(inAmount) / 10 ** reserve.decimals * asset.navPrice * .99 * 1e6)),
        priceImpactPct: '.01', routePlan: [{ swapInfo: { label: 'test venue' } }], contextSlot: 123 }) };
    };
    const live = await getLiquidity({ reserve, asset, refresh: true, fetchImpl: response });
    assert.equal(live.source.live, true);
    assert.equal(live.measured, true);
    assert.equal(live.routableUsd, 1000000);
    assert.equal(live.censored, true);
    const failed = await getLiquidity({ reserve, asset, refresh: true, fetchImpl: async () => { throw new Error('quota'); } });
    assert.equal(failed.source.live, false);
    assert.equal(failed.source.cached, true);
    assert.equal(failed.source.fallback, true);
    assert.equal(failed.source.timestamp, live.source.timestamp);
  } finally {
    if (previous === undefined) delete process.env.JUP_QUOTE_URL;
    else process.env.JUP_QUOTE_URL = previous;
  }
});
