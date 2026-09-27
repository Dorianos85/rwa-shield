import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteScheduler, getLiquidity } from './liquidity.mjs';

const reserve = { mint: 'testMint', decimals: 8 };
const asset = { navPrice: 100 };
const start = Date.parse('2026-09-27T12:00:00Z');
const valid = async url => {
  const query = new URL(url).searchParams;
  return { ok: true, json: async () => ({ inputMint: query.get('inputMint'), outputMint: query.get('outputMint'),
    inAmount: query.get('amount'), outAmount: String(Math.floor(Number(query.get('amount')) * .99)),
    priceImpactPct: '.01', routePlan: [{ swapInfo: { label: 'test' } }] }) };
};
const noRoute = async () => ({ ok: false, status: 400, json: async () => ({ errorCode: 'COULD_NOT_FIND_ANY_ROUTE' }) });

test('default keyless configuration attempts real quote endpoint without inventing an API key', async t => {
  const apiKey = process.env.JUP_API_KEY, endpoint = process.env.JUP_QUOTE_URL;
  delete process.env.JUP_API_KEY;
  delete process.env.JUP_QUOTE_URL;
  t.after(() => {
    if (apiKey === undefined) delete process.env.JUP_API_KEY; else process.env.JUP_API_KEY = apiKey;
    if (endpoint === undefined) delete process.env.JUP_QUOTE_URL; else process.env.JUP_QUOTE_URL = endpoint;
  });
  const intervals = [];
  let calls = 0;
  const result = await getLiquidity({ reserve, asset, notionalUsd: 100011, now: start,
    schedule: async interval => { intervals.push(interval); },
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url.origin + url.pathname, 'https://api.jup.ag/swap/v1/quote');
      assert.equal(options.headers['x-api-key'], undefined);
      return valid(url);
    } });
  assert.equal(calls, 9);
  assert.ok(intervals.every(ms => ms === 2000));
  assert.equal(result.available, true);
  assert.equal(result.measured, true);
  assert.equal(result.routableUsd, 1000000);
  assert.equal(result.testedLimitUsd, 1000000);
  assert.equal(result.source.endpoint, 'https://api.jup.ag/swap/v1/quote');
});

test('offline without measured cache is unavailable; synthetic model requires explicit selection', async () => {
  const options = { reserve, asset, notionalUsd: 100012, now: start, fetchImpl: () => { throw new Error('Unexpected network'); } };
  const unavailable = await getLiquidity({ ...options, offline: true });
  assert.equal(unavailable.available, false);
  assert.equal(unavailable.measured, false);
  assert.equal(unavailable.routableUsd, 0);
  assert.deepEqual(unavailable.curve, []);
  assert.equal(unavailable.source.timestamp, null);
  const synthetic = await getLiquidity({ ...options, synthetic: true });
  assert.equal(synthetic.synthetic, true);
  assert.equal(synthetic.measured, false);
  assert.equal(synthetic.source.live, false);
  assert.ok(synthetic.routableUsd > 0);
  assert.ok(synthetic.curve.length > 0);
});

test('offline can retain last measured quotes with original age and provenance', async () => {
  const options = { reserve, asset, notionalUsd: 100013 };
  const measured = await getLiquidity({ ...options, fetchImpl: valid, now: start });
  const cached = await getLiquidity({ ...options, offline: true, now: start + 120000,
    fetchImpl: () => { throw new Error('Unexpected network'); } });
  assert.equal(cached.available, true);
  assert.equal(cached.measured, true);
  assert.equal(cached.source.timestamp, measured.source.timestamp);
  assert.equal(cached.source.ageSec, 120);
  assert.equal(cached.source.live, false);
  assert.equal(cached.source.cached, true);
  assert.equal(cached.source.fallback, true);
});

test('singleflight shares duplicate ladders and failed probes respect cooldown even on refresh', async () => {
  let calls = 0;
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const options = { reserve, asset, notionalUsd: 100014, now: start,
    fetchImpl: async () => { calls++; await barrier; throw new Error('Rate limited'); } };
  const a = getLiquidity(options), b = getLiquidity(options);
  await Promise.resolve();
  release();
  const [first, second] = await Promise.all([a, b]);
  assert.deepEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(first.available, false);
  await getLiquidity({ ...options, refresh: true, now: start + 1000 });
  assert.equal(calls, 1);
  await getLiquidity({ ...options, now: start + 61000 });
  assert.equal(calls, 2);
});

test('bounded in-flight queue rejects overflow without network calls or invented depth', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const pending = Array.from({ length: 8 }, (_, i) => getLiquidity({ reserve, asset, notionalUsd: 200000 + i, now: start,
    fetchImpl: async () => { calls++; await barrier; return noRoute(); } }));
  const overflow = await getLiquidity({ reserve, asset, notionalUsd: 200009, now: start, fetchImpl: valid });
  assert.equal(overflow.available, false);
  assert.match(overflow.source.fallbackReason, /queue is busy/);
  assert.equal(overflow.routableUsd, 0);
  release();
  await Promise.all(pending);
  assert.equal(calls, 8);
});

test('quote pacing is shared and capture time starts at oldest actual probe after queue wait', async () => {
  let time = start;
  const waits = [];
  const schedule = createQuoteScheduler({ clock: () => time, sleep: async ms => { waits.push(ms); time += ms; } });
  await Promise.all([schedule(2000), schedule(2000), schedule(1000), schedule(1000)]);
  assert.deepEqual(waits, [2000, 2000, 1000]);
  const captureStart = time;
  const result = await getLiquidity({ reserve, asset, notionalUsd: 100000, clock: () => time,
    schedule: async () => { time += 2000; }, fetchImpl: valid });
  assert.equal(result.source.timestamp, new Date(captureStart + 2000).toISOString());
  assert.equal(result.source.ageSec, 14);
});

test('impact threshold determines measured depth, is validated and separates cache entries', async () => {
  let calls = 0;
  const fetchImpl = async url => { calls++; return valid(url); };
  const options = { reserve, asset, notionalUsd: 100015, now: start, fetchImpl };
  const relaxed = await getLiquidity({ ...options, maxImpactPct: 2 });
  const strict = await getLiquidity({ ...options, maxImpactPct: .5 });
  assert.equal(relaxed.routableUsd, 1000000);
  assert.equal(strict.routableUsd, 0);
  assert.equal(strict.available, true);
  assert.equal(strict.maxImpactPct, .5);
  assert.equal(calls, 18);
  for (const maxImpactPct of [0, -1, 101, NaN, Infinity, '2']) {
    await assert.rejects(getLiquidity({ ...options, maxImpactPct }), /Invalid maximum quote impact/);
  }
});
