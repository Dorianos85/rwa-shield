import test from 'node:test';
import assert from 'node:assert/strict';
import { computeEcv, healthFactor, recoveryOnLiquidation } from './model.mjs';
import { DEFAULT_PARAMS } from './params.mjs';

const base = {
  mint: 'SPYx', symbol: 'SPYx', qty: 100, oraclePrice: 1000, twapPrice: 1000,
  priceAgeSec: 5, impactPct: 1.2, routableUsd: 400_000,
  sessionState: 'regular', realizedVolAnnual: 0.18
};

test('ECV never exceeds oracle value', () => {
  const r = computeEcv(base);
  assert.ok(r.ecv <= r.oracleValue, 'ecv must be <= oracle value');
});

test('a closed underlying market lowers ECV', () => {
  const open = computeEcv({ ...base, sessionState: 'regular' });
  const shut = computeEcv({ ...base, sessionState: 'weekend' });
  assert.ok(shut.ecv <= open.ecv);
});

test('bigger slippage lowers ECV monotonically', () => {
  const a = computeEcv({ ...base, impactPct: 0.5 });
  const b = computeEcv({ ...base, impactPct: 2.0 });
  assert.ok(b.ecv < a.ecv);
});

test('stale price disables borrowing but does not zero the mark', () => {
  const r = computeEcv({ ...base, priceAgeSec: 9999 });
  assert.equal(r.outputs.borrow_disabled, true);
  assert.equal(r.outputs.breaker_reason, 'stale_price');
  assert.equal(r.outputs.max_borrow, 0);
  assert.ok(r.executableValue > 0, 'existing collateral keeps a mark');
});

test('thin depth disables borrowing', () => {
  const r = computeEcv({ ...base, routableUsd: 1000 });
  assert.equal(r.outputs.borrow_disabled, true);
});

test('ECV lends less than a fixed 70% LTV in every non-trivial state', () => {
  for (const s of ['regular', 'afterHours', 'weekend']) {
    const r = computeEcv({ ...base, sessionState: s });
    assert.ok(r.outputs.max_borrow <= r.fixedLtvBorrow + 1e-6, `failed for ${s}`);
  }
});

test('health factor and recovery are consistent', () => {
  const r = computeEcv(base);
  const debt = r.outputs.max_borrow;
  assert.ok(healthFactor(r.executableValue, debt) > 1);
  assert.ok(recoveryOnLiquidation(r.executableValue) > debt);
});
