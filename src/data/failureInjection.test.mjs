import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchJson, getKaminoReserve, normalizeReserve, provenance } from './kamino.mjs';
import { getLiquidity } from './liquidity.mjs';
import { getXstockAsset } from './xstocks.mjs';

const snapshot = JSON.parse(readFileSync(new URL('../../data/kamino.snapshot.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const now = Date.parse(snapshot.capturedAt);
const json = body => ({ ok: true, status: 200, json: async () => body });
const fixture = async () => {
  const reserve = await getKaminoReserve({ offline: true, now });
  return { reserve, asset: getXstockAsset({ reserve, now }) };
};
function quoteFetch(reserve, asset) {
  return async url => {
    const q = new URL(url).searchParams;
    return json({ inputMint: q.get('inputMint'), outputMint: q.get('outputMint'), inAmount: q.get('amount'),
      outAmount: String(Math.floor(Number(q.get('amount')) / 10 ** reserve.decimals * asset.navPrice * .99 * 1e6)),
      priceImpactPct: '.01', routePlan: [{ swapInfo: { label: 'Injected test venue' } }] });
  };
}
function configuredJupiter(t) {
  const prior = process.env.JUP_QUOTE_URL;
  process.env.JUP_QUOTE_URL = 'https://example.invalid/quote';
  t.after(() => prior === undefined ? delete process.env.JUP_QUOTE_URL : process.env.JUP_QUOTE_URL = prior);
}

test('upstream fetch timeout aborts rather than waiting indefinitely', async () => {
  await assert.rejects(fetchJson('https://example.invalid', {
    timeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(() => reject(new Error('abort signal was not delivered')), 500);
      signal.addEventListener('abort', () => { clearTimeout(keepAlive); reject(signal.reason); }, { once: true });
    })
  }), { name: 'TimeoutError' });
});

test('Kamino outages, bad JSON and malformed metrics preserve recorded provenance', async () => {
  const failures = [
    async () => { throw new Error('RPC unavailable'); },
    async () => { throw new DOMException('Request timed out', 'TimeoutError'); },
    async () => ({ ok: false, status: 429 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
    async () => json({ unexpected: 'shape' }),
    async () => json([{ liquidityToken: 'SPYx', totalSupplyUsd: '-1' }]),
  ];
  for (const fetchImpl of failures) {
    const reserve = await getKaminoReserve({ fetchImpl, refresh: true, now: now + 86400000 });
    assert.equal(reserve.source.live, false);
    assert.equal(reserve.source.fallback, true);
    assert.equal(reserve.source.timestamp, snapshot.capturedAt);
    assert.ok(reserve.source.fallbackReason);
    assert.ok(reserve.source.ageSec >= 86400);
    assert.ok(Number.isFinite(reserve.kaminoOraclePrice));
  }
});

test('expired Kamino cache attempts refresh and cannot relabel old observations as live', async () => {
  const bundle = snapshot.markets[0];
  let calls = 0;
  const fetchImpl = async url => {
    calls++;
    return json(url.includes('/metrics') ? bundle.metrics : url.includes('account-data')
      ? [{ market: bundle.config.lendingMarket, reserves: bundle.accounts }]
      : [{ lendingMarket: bundle.config.lendingMarket, prices: bundle.prices }]);
  };
  const live = await getKaminoReserve({ now, refresh: true, fetchImpl });
  assert.equal(live.source.live, true);
  assert.equal(calls, 3);
  const cached = await getKaminoReserve({ now: now + 59000, fetchImpl });
  assert.equal(cached.source.cached, true);
  assert.equal(cached.source.live, false);
  assert.equal(calls, 3);
  const expired = await getKaminoReserve({ now: now + 61000, fetchImpl: async () => { calls++; throw new Error('offline'); } });
  assert.ok(calls > 3);
  assert.equal(expired.source.fallback, true);
  assert.equal(expired.source.cached, true);
  assert.equal(expired.source.live, false);
  assert.equal(expired.source.timestamp, live.source.timestamp);
  assert.equal(expired.source.ageSec, 61);
});

test('missing oracle timestamp remains unknown instead of becoming a fresh NAV', () => {
  const bundle = structuredClone(snapshot.markets[0]);
  bundle.prices = bundle.prices.map(p => ({ ...p, timestamp: null }));
  const reserve = normalizeReserve(bundle.metrics[0], bundle, { source: provenance('test', snapshot.capturedAt), now });
  const asset = getXstockAsset({ reserve, now });
  assert.equal(reserve.oracleTimestamp, null);
  assert.equal(asset.priceAgeSec, null);
  assert.equal(asset.priceAgeAvailable, false);
  assert.equal(asset.issuerNav.available, false);
});

test('Jupiter transport/auth failures and invalid JSON remain unavailable without invented liquidity', async t => {
  configuredJupiter(t);
  const data = await fixture();
  const failures = [
    async () => { throw new Error('network down'); },
    async () => { throw new DOMException('Request timed out', 'TimeoutError'); },
    async () => ({ ok: false, status: 401 }),
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } }),
    async () => json({ priceImpactPct: '.01', outAmount: '100', routePlan: [] }),
  ];
  let notionalUsd = 100001;
  for (const fetchImpl of failures) {
    const execution = await getLiquidity({ ...data, notionalUsd: notionalUsd++, refresh: true, fetchImpl, now });
    assert.equal(execution.source.live, false);
    assert.equal(execution.source.fallback, true);
    assert.equal(execution.measured, false);
    assert.equal(execution.available, false);
    assert.equal(execution.routableUsd, 0);
    assert.equal(execution.source.timestamp, null);
    assert.deepEqual(execution.curve, []);
    assert.ok(execution.source.fallbackReason);
    assert.ok(execution.curve.every(p => Number.isFinite(p.outUsd)));
  }
});

test('expired Jupiter cache keeps original quote time and reports the failed refresh', async t => {
  configuredJupiter(t);
  const data = await fixture();
  const live = await getLiquidity({ ...data, notionalUsd: 100020, refresh: true, fetchImpl: quoteFetch(data.reserve, data.asset), now });
  const expired = await getLiquidity({ ...data, notionalUsd: 100020, fetchImpl: async () => { throw new Error('Jupiter timeout'); }, now: now + 61000 });
  assert.equal(live.measured, true);
  assert.equal(expired.measured, true);
  assert.equal(expired.source.cached, true);
  assert.equal(expired.source.fallback, true);
  assert.equal(expired.source.live, false);
  assert.equal(expired.source.timestamp, live.source.timestamp);
  assert.equal(expired.source.ageSec, 61);
});

test('confirmed HTTP 400 no-route is measured zero depth, never synthetic liquidity', async t => {
  configuredJupiter(t);
  const data = await fixture();
  const execution = await getLiquidity({ ...data, notionalUsd: 100030, refresh: true, now,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: 'Could not find any route', errorCode: 'COULD_NOT_FIND_ANY_ROUTE' }) }) });
  assert.equal(execution.measured, true);
  assert.equal(execution.routableUsd, 0);
  assert.equal(execution.source.fallback, false);
  assert.equal(execution.curve[0].ok, false);
});

test('a larger confirmed no-route preserves only the smaller measured fill', async t => {
  configuredJupiter(t);
  const data = await fixture();
  const valid = quoteFetch(data.reserve, data.asset);
  let calls = 0;
  const execution = await getLiquidity({ ...data, notionalUsd: 100031, refresh: true, now,
    fetchImpl: async url => ++calls === 1 ? valid(url)
      : ({ ok: false, status: 400, json: async () => ({ errorCode: 'COULD_NOT_FIND_ANY_ROUTE' }) }) });
  assert.equal(calls, 2);
  assert.equal(execution.measured, true);
  assert.equal(execution.routableUsd, 2500);
  assert.equal(execution.censored, false);
  assert.equal(execution.source.fallback, false);
  assert.deepEqual(execution.curve.map(p => p.ok), [true, false]);
});

test('zero and out-of-range notionals fail before a network request', async () => {
  const data = await fixture();
  for (const notionalUsd of [0, -1, Infinity, NaN, 10000001]) {
    await assert.rejects(getLiquidity({ ...data, notionalUsd, fetchImpl: () => { throw new Error('Unexpected network call'); } }), /Invalid tested notional/);
  }
  const execution = await getLiquidity({ ...data, notionalUsd: 10000000, offline: true });
  assert.ok(execution.curve.every(p => Number.isFinite(p.outUsd) && Number.isFinite(p.impactPct)));
});
