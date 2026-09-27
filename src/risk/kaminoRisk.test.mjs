import test from 'node:test';
import assert from 'node:assert/strict';
import { computeKaminoRiskScenario, findRiskBoundaries } from './kaminoRisk.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';

const fixture = () => ({
  reserve: { tvlUsd: 20_000_000, currentUtilization: 0.6, configuredLtv: 0.55,
    liquidationThreshold: 0.75, borrowCapUsd: 18_000_000, supplyCapUsd: 30_000_000,
    optimalUtilization: 0.8, kaminoOraclePrice: 101,
    borrowRateCurve: [{ utilization: 0, borrowRate: 0 }, { utilization: 0.8, borrowRate: 0.1 }, { utilization: 1, borrowRate: 1 }],
    source: { source: 'test fixture', live: true, fallback: false, ageSec: 5 } },
  asset: { navPrice: 100, priceAgeSec: 5, priceAgeAtCaptureSec: 5,
    sessionState: 'regular', realizedVolAnnual: 0.18, source: { source: 'test fixture', live: false } },
  execution: { routableUsd: 400_000, measured: true, curve: [
    { notionalUsd: 25_000, impactPct: 0.2, ok: true, route: 'test:route' },
    { notionalUsd: 100_000, impactPct: 1.2, ok: true, route: 'test:route' },
    { notionalUsd: 400_000, impactPct: 4.8, ok: true, route: 'test:route' }
  ], source: { source: 'test fixture', live: false, fallback: true, ageSec: 5 } },
  scenario: { utilization: 0.6, navPrice: 100, ammLiquidityUsd: 400_000, averageHealthFactor: 1.5, notionalUsd: 100_000 }
});
const run = (scenario = {}, baseline = fixture()) => computeKaminoRiskScenario({
  ...baseline, scenario: { ...baseline.scenario, ...scenario }
}, { includeBoundaries: false });
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);

test('fixed reserve accounting depends only on TVL and utilization', () => {
  const base = run();
  for (const scenario of [{ navPrice: 50 }, { averageHealthFactor: 0.5 }, { ammLiquidityUsd: 20_000 }]) {
    const r = run(scenario);
    assert.equal(r.reserve.tvlUsd, base.reserve.tvlUsd);
    assert.equal(r.reserve.scenarioBorrowedUsd, base.reserve.scenarioBorrowedUsd);
    assert.equal(r.reserve.scenarioAvailableUsd, base.reserve.scenarioAvailableUsd);
  }
  for (const utilization of [0, 0.35, 0.92, 0.999, 1]) {
    const r = run({ utilization });
    close(r.reserve.scenarioBorrowedUsd, 20_000_000 * utilization);
    close(r.reserve.scenarioAvailableUsd, 20_000_000 * (1 - utilization));
    close(r.reserve.scenarioBorrowedUsd + r.reserve.scenarioAvailableUsd, r.reserve.tvlUsd);
    assert.equal(r.health.averageHealthFactorInitial, 1.5);
    assert.equal(r.rwaShield.ecv, base.rwaShield.ecv);
    assert.equal(r.rwaShield.executableValue, base.rwaShield.executableValue);
  }
});

test('NAV changes a fixed quantity, never the Kamino oracle or reserve debt', () => {
  const base = run();
  const r = run({ navPrice: 70 });
  assert.equal(r.asset.collateralQty, 1000);
  assert.equal(r.asset.collateralReferenceValue, 70_000);
  assert.equal(r.asset.kaminoOraclePrice, 101);
  assert.ok(r.rwaShield.ecv < base.rwaShield.ecv);
  assert.ok(r.rwaShield.recovery < base.rwaShield.recovery);
  close(r.health.averageHealthFactorStressed, 1.5 * r.rwaShield.executableValue / base.rwaShield.executableValue);
  assert.equal(r.reserve.scenarioBorrowedUsd, base.reserve.scenarioBorrowedUsd);
  assert.equal(r.comparison.kaminoBorrowCapacityUsd, 70_000 * 0.55);
});

test('lower liquidity worsens impact, execution, ECV, recovery, and recommended capacity monotonically', () => {
  let previous = run({ ammLiquidityUsd: 1_000_000 });
  for (let liquidity = 990_000; liquidity >= 0; liquidity -= 1_000) {
    const r = run({ ammLiquidityUsd: liquidity });
    assert.ok(r.execution.priceImpactPct >= previous.execution.priceImpactPct);
    assert.ok(r.rwaShield.executableValue <= previous.rwaShield.executableValue + 1e-8);
    assert.ok(r.rwaShield.ecv <= previous.rwaShield.ecv + 1e-8);
    assert.ok(r.rwaShield.recovery <= previous.rwaShield.recovery + 1e-8);
    assert.ok(r.rwaShield.maxBorrow <= previous.rwaShield.maxBorrow + 1e-8);
    assert.ok(r.rwaShield.riskPremium >= previous.rwaShield.riskPremium);
    assert.equal(r.reserve.scenarioAvailableUsd, previous.reserve.scenarioAvailableUsd);
    previous = r;
  }
});

test('extreme impact cannot leave the frozen capped-slippage optimistic liquidation mark', () => {
  const r = run({ ammLiquidityUsd: 10_000 });
  assert.ok(r.execution.priceImpactPct > DEFAULT_PARAMS.maxImpactPct * 2);
  assert.ok(r.rwaShield.executableValue <= r.execution.routableUsd * (1 - r.execution.priceImpactPct / 100) + 1e-8);
  assert.equal(r.rwaShield.borrowDisabled, true);
});

test('Average HF is independent and stress is counted exactly once', () => {
  const a = run({ navPrice: 80, averageHealthFactor: 1.1 });
  const b = run({ navPrice: 80, averageHealthFactor: 1.8 });
  assert.deepEqual(a.reserve, b.reserve);
  assert.deepEqual(a.rwaShield, b.rwaShield);
  close(a.health.averageHealthFactorStressed / b.health.averageHealthFactorStressed, 1.1 / 1.8);
  close(a.health.averageHealthFactorStressed, 1.1 * a.health.executableValueRatio);
});

test('safe, warning and critical have explicit independent conditions', () => {
  assert.equal(run().overallStatus, 'SAFE');
  for (const s of [{ averageHealthFactor: 1.1 }, { navPrice: 70 }, { utilization: 0.85 }, { ammLiquidityUsd: 110_000 }]) {
    const r = run(s);
    assert.equal(r.overallStatus, 'WARNING', JSON.stringify(s));
    assert.ok(r.constraints.length);
  }
  for (const s of [{ averageHealthFactor: 0.99 }, { navPrice: 50 }, { utilization: 0.95 }, { ammLiquidityUsd: 70_000 }]) {
    assert.equal(run(s).overallStatus, 'CRITICAL', JSON.stringify(s));
  }
  assert.equal(run({ averageHealthFactor: 1 }).overallStatus, 'WARNING');
  assert.equal(run({ averageHealthFactor: DEFAULT_PARAMS.targetHealth }).overallStatus, 'SAFE');
});

test('RWA safe LTV, gap, recovery use explicitly defined exposure and frozen outputs remain present', () => {
  const r = run();
  close(r.rwaShield.safeLtv, r.rwaShield.maxBorrow / r.asset.collateralReferenceValue);
  close(r.comparison.safetyGapUsd, r.rwaShield.maxBorrow - r.comparison.kaminoBorrowCapacityUsd);
  close(r.rwaShield.recoveryVsNotional, r.rwaShield.recovery / 100_000);
  assert.equal(r.rwaShield.recoveryCoverage, null);
  for (const key of ['max_borrow', 'collateral_cap', 'liquidation_route', 'risk_premium', 'borrow_disabled']) {
    assert.ok(key in r.rwaShield.outputs);
  }
});

test('zero NAV/depth/notional and zero baseline keep finite serialized outputs and disable borrowing', () => {
  const cases = [run({ navPrice: 0 }), run({ ammLiquidityUsd: 0 }), run({ notionalUsd: 0 })];
  const noPrice = fixture(); noPrice.asset.navPrice = 0;
  cases.push(run({}, noPrice));
  const noDepth = fixture(); noDepth.execution.routableUsd = 0;
  cases.push(run({}, noDepth));
  for (const r of cases) {
    assert.equal(r.overallStatus, 'CRITICAL');
    assert.equal(r.rwaShield.borrowDisabled, true);
    assert.equal(r.rwaShield.maxBorrow, 0);
    const visit = value => {
      if (typeof value === 'number') assert.ok(Number.isFinite(value));
      if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(r);
    assert.doesNotThrow(() => JSON.stringify(r));
  }
});

test('staleness gates current borrowing and replay uses explicit historical price age, retaining provenance', () => {
  const input = fixture(); input.asset.priceAgeSec = 3600;
  const current = run({}, input);
  assert.equal(current.overallStatus, 'CRITICAL');
  assert.equal(current.rwaShield.breakerReason, 'stale_price');
  assert.ok(current.rwaShield.executableValue > 0);
  const replay = run({ mode: 'snapshot-replay' }, input);
  assert.equal(replay.overallStatus, 'SAFE');
  assert.equal(replay.valuationMode, 'snapshot-replay');
  assert.equal(replay.asset.priceAgeSec, 3600);
  assert.equal(replay.asset.modeledPriceAgeSec, 5);
  assert.equal(replay.sources.asset.live, false);
  delete input.asset.priceAgeAtCaptureSec;
  assert.equal(run({ mode: 'snapshot-replay' }, input).rwaShield.breakerReason, 'stale_price');
});

test('missing protocol fields stay null with a documented incomplete-comparison warning', () => {
  const input = fixture();
  input.reserve = { tvlUsd: 20_000_000, currentUtilization: 0.6 };
  const r = run({}, input);
  for (const key of ['configuredLtv', 'liquidationThreshold', 'borrowCapUsd', 'optimalUtilization']) assert.equal(r.reserve[key], null);
  assert.equal(r.comparison.kaminoBorrowCapacityUsd, null);
  assert.equal(r.reserve.interestRateRegime, 'unknown');
  assert.equal(r.overallStatus, 'CRITICAL');
  assert.equal(r.rwaShield.borrowDisabled, true);
  assert.equal(run({ mode: 'sandbox' }, input).overallStatus, 'WARNING');
});

test('missing or invalid curve cannot produce SAFE or claim known executable proceeds', () => {
  const input = fixture(); input.execution.curve = [];
  const r = run({}, input);
  assert.equal(r.rwaShield.executableValue, 0);
  assert.equal(r.overallStatus, 'CRITICAL');
  assert.equal(r.rwaShield.breakerReason, 'execution_unavailable');
});

test('bounded finite inputs reject negatives, NaN, infinities and overflow before calculation', () => {
  for (const key of ['utilization', 'navPrice', 'ammLiquidityUsd', 'averageHealthFactor', 'notionalUsd']) {
    for (const value of [-1, NaN, Infinity, -Infinity, Number.MAX_VALUE, '100']) {
      assert.throws(() => run({ [key]: value }), RangeError, `${key} ${value}`);
    }
  }
  assert.throws(() => run({ utilization: 1.01 }), RangeError);
  const input = fixture(); input.asset.navPrice = Number.MIN_VALUE;
  assert.throws(() => run({}, input), RangeError);
  const huge = run({ notionalUsd: 1e12 });
  assert.equal(huge.overallStatus, 'CRITICAL');
  assert.equal(Number.isFinite(huge.rwaShield.ecv), true);
});

test('boundary search recovers protocol cap/kink and exact abstract HF crossings', () => {
  const b = findRiskBoundaries(fixture());
  close(b.utilization.warning.value, 0.8);
  close(b.utilization.critical.value, 0.9);
  close(b.averageHealthFactor.warning.value, DEFAULT_PARAMS.targetHealth);
  close(b.averageHealthFactor.critical.value, 1);
  assert.equal(b.nav.direction, 'below');
  assert.equal(b.nav.critical.noCrossing, false);
  assert.ok(b.nav.warning.value > b.nav.critical.value);
  assert.ok(b.ammLiquidity.warning.value > b.ammLiquidity.critical.value);
});

test('boundaries recompute with NAV and HF; each crossing brackets classifier state', () => {
  const input = fixture();
  const before = findRiskBoundaries(input);
  input.scenario.navPrice = 90;
  const after = findRiskBoundaries(input);
  assert.ok(after.averageHealthFactor.critical.value > before.averageHealthFactor.critical.value);
  input.scenario.navPrice = 100;
  input.scenario.averageHealthFactor = 1.8;
  assert.ok(findRiskBoundaries(input).nav.critical.value < before.nav.critical.value);
  for (const [axis, key] of [['nav', 'navPrice'], ['ammLiquidity', 'ammLiquidityUsd'], ['averageHealthFactor', 'averageHealthFactor']]) {
    const boundary = before[axis].critical.value;
    assert.equal(run({ [key]: boundary * (1 - 1e-6) }).overallStatus, 'CRITICAL');
    assert.notEqual(run({ [key]: boundary * (1 + 1e-6) }).overallStatus, 'CRITICAL');
  }
});

test('unrelated breached constraints yield explanatory no-crossing instead of fictitious thresholds', () => {
  const input = fixture(); input.asset.priceAgeSec = 500;
  const b = findRiskBoundaries(input);
  for (const axis of Object.values(b)) {
    assert.equal(axis.critical.value, null);
    assert.equal(axis.critical.alreadyBreached, true);
    assert.equal(axis.critical.noCrossing, true);
    assert.match(axis.critical.reason, /stale_price/);
  }
});

test('already breached but recoverable axis still returns an actual numerical crossing', () => {
  const input = fixture(); input.scenario.averageHealthFactor = 0.9;
  const b = findRiskBoundaries(input);
  close(b.averageHealthFactor.critical.value, 1);
  assert.equal(b.averageHealthFactor.critical.alreadyBreached, true);
  assert.equal(b.averageHealthFactor.critical.noCrossing, false);
});

test('boundary without a protocol kink/cap does not invent utilization warning', () => {
  const input = fixture(); input.reserve.optimalUtilization = null; input.reserve.borrowCapUsd = null;
  const b = findRiskBoundaries(input);
  // Exhaustion at exactly 100% is a critical crossing and therefore also a warning-or-worse crossing.
  close(b.utilization.warning.value, 1);
  close(b.utilization.critical.value, 1);
  assert.equal(b.utilization.warning.limitingConstraint, 'reserve_exhausted');
});

test('interest-rate curve interpolates independently of collateral execution', () => {
  close(run({ utilization: 0.4 }).reserve.borrowRate, 0.05);
  close(run({ utilization: 0.9 }).reserve.borrowRate, 0.55);
  assert.equal(run({ utilization: 0.9 }).reserve.interestRateRegime, 'above-kink');
});

test('explicit sandbox models fresh age without overwriting factual provenance', () => {
  const input = fixture();
  input.asset.priceAgeSec = 800;
  input.asset.priceAgeAtCaptureSec = 103;
  const current = run({}, input), replay = run({ mode: 'snapshot-replay' }, input);
  const sandbox = run({ mode: 'sandbox' }, input);
  assert.equal(current.overallStatus, 'CRITICAL');
  assert.equal(replay.overallStatus, 'CRITICAL');
  assert.equal(sandbox.overallStatus, 'SAFE');
  assert.equal(sandbox.asset.priceAgeSec, 800);
  assert.equal(sandbox.asset.modeledPriceAgeSec, 0);
  assert.equal(sandbox.valuationMode, 'sandbox');
  assert.equal(sandbox.modeledOnly, true);
  assert.match(sandbox.assumptions[0], /Hypothetical fresh reference/);
  assert.deepEqual(sandbox.sources, current.sources);
});

test('NAV boundary search finds healthy interior even when larger NAV exhausts depth', () => {
  const input = fixture();
  input.execution.routableUsd = 120_000;
  input.execution.curve = [{ notionalUsd: 120_000, impactPct: 0.1, ok: true, route: 'test' }];
  input.scenario.ammLiquidityUsd = 120_000;
  const b = findRiskBoundaries(input);
  assert.equal(run({ navPrice: 150 }, input).overallStatus, 'CRITICAL');
  assert.equal(run({}, input).overallStatus, 'SAFE');
  assert.equal(b.nav.critical.noCrossing, false);
  assert.ok(b.nav.critical.value > 60 && b.nav.critical.value < 70);
});

test('actual rate breakpoint is preserved separately from unknown optimal utilization', () => {
  const input = fixture(); input.reserve.optimalUtilization = null; input.reserve.firstCurveKink = 0.82;
  const r = run({ utilization: 0.85 }, input);
  assert.equal(r.reserve.optimalUtilization, null);
  assert.equal(r.reserve.rateCurveKink, 0.82);
  assert.equal(r.reserve.interestRateRegime, 'above-kink');
  assert.match(r.dominantReason, /rate-curve breakpoint/);
});

test('proxy reference never claims an independent NAV/oracle divergence', () => {
  const input = fixture(); input.asset.source.independentNav = false;
  assert.equal(run({}, input).asset.oracleNavDivergencePct, null);
});

test('breaker constraint numbers correspond to actual stale-price and impact triggers', () => {
  const input = fixture(); input.asset.priceAgeSec = 800;
  const stale = run({}, input).constraints.find(c => c.id === 'borrow_breaker');
  assert.equal(stale.value, 800);
  assert.equal(stale.threshold, DEFAULT_PARAMS.maxStalenessSec);
  const r = run({ ammLiquidityUsd: 90_000 });
  const impact = r.constraints.find(c => c.id === 'borrow_breaker');
  assert.equal(impact.value, r.execution.priceImpactPct);
  assert.equal(impact.threshold, DEFAULT_PARAMS.maxImpactPct * 2);
});

test('server-provided waterfall matches valuation without frontend financial formulas', () => {
  const r = run();
  assert.equal(r.rwaShield.waterfall[0].value, r.asset.collateralReferenceValue);
  assert.equal(r.rwaShield.waterfall[2].value, r.rwaShield.executableValue);
  assert.equal(r.rwaShield.waterfall.at(-1).value, r.rwaShield.maxBorrow);
});

test('depth floor applies to market execution depth rather than a small tested fill', () => {
  assert.equal(run({ notionalUsd: 10_000 }).rwaShield.borrowDisabled, false);
  const r = run({ notionalUsd: 1000, ammLiquidityUsd: 20_000 });
  assert.equal(r.rwaShield.breakerReason, 'depth_floor');
  assert.equal(r.rwaShield.terms.B, 0);
  assert.equal(r.rwaShield.maxBorrow, 0);
  assert.equal(r.constraints.find(c => c.id === 'borrow_breaker').value, 20_000);
});

test('stale or unmeasured execution cannot enable current borrowing despite a fresh reference', () => {
  const input = fixture();
  input.execution.source.ageSec = DEFAULT_PARAMS.riskLab.maxExecutionAgeSec + 1;
  let r = run({}, input);
  assert.equal(r.rwaShield.breakerReason, 'stale_execution');
  assert.equal(r.overallStatus, 'CRITICAL');
  assert.equal(r.rwaShield.maxBorrow, 0);
  assert.ok(r.rwaShield.executableValue > 0);
  assert.equal(r.constraints.find(c => c.id === 'borrow_breaker').value, input.execution.source.ageSec);
  input.execution.source.ageSec = DEFAULT_PARAMS.riskLab.maxExecutionAgeSec;
  assert.equal(run({}, input).rwaShield.borrowDisabled, false);
  input.execution.measured = false;
  assert.equal(run({}, input).rwaShield.breakerReason, 'execution_unverified');
  input.execution.measured = true;
  delete input.execution.source.ageSec;
  assert.equal(run({}, input).rwaShield.breakerReason, 'execution_freshness_unknown');
});

test('execution replay requires explicit capture age and sandbox retains actual stale metadata', () => {
  const input = fixture(); input.execution.source.ageSec = 100_000;
  assert.equal(run({ mode: 'snapshot-replay' }, input).rwaShield.breakerReason, 'stale_execution');
  input.execution.ageAtCaptureSec = 5;
  assert.equal(run({ mode: 'snapshot-replay' }, input).rwaShield.borrowDisabled, false);
  const replay = run({ mode: 'snapshot-replay' }, input);
  assert.equal(replay.execution.ageSec, 100_000);
  assert.equal(replay.execution.modeledAgeSec, 5);
  input.execution.measured = false;
  const sandbox = run({ mode: 'sandbox' }, input);
  assert.equal(sandbox.overallStatus, 'SAFE');
  assert.equal(sandbox.execution.ageSec, 100_000);
  assert.equal(sandbox.sources.execution.ageSec, 100_000);
  assert.equal(sandbox.modeledOnly, true);
  assert.match(sandbox.assumptions[0], /synthetic or stale curves/);
});

test('NAV candidate at full execution coverage resolves arbitrarily narrow healthy interior', () => {
  const input = fixture();
  input.execution.routableUsd = 101_010;
  input.execution.curve = [{ notionalUsd: 101_010, impactPct: 0, ok: true, route: 'test' }];
  input.scenario.ammLiquidityUsd = 101_010;
  input.scenario.averageHealthFactor = 100 / 101;
  assert.equal(run({ navPrice: 100 }, input).overallStatus, 'CRITICAL');
  assert.notEqual(run({ navPrice: 101.005 }, input).overallStatus, 'CRITICAL');
  assert.equal(run({ navPrice: 102 }, input).overallStatus, 'CRITICAL');
  const b = findRiskBoundaries(input);
  assert.equal(b.nav.critical.noCrossing, false);
  close(b.nav.critical.value, 101);
});

test('stale, unknown and unverified reserve observations cannot enable current borrowing', () => {
  const input = fixture(); input.reserve.source.ageSec = DEFAULT_PARAMS.riskLab.maxReserveAgeSec + 1;
  assert.equal(run({}, input).rwaShield.breakerReason, 'stale_reserve');
  input.reserve.source.ageSec = DEFAULT_PARAMS.riskLab.maxReserveAgeSec;
  assert.equal(run({}, input).rwaShield.borrowDisabled, false);
  delete input.reserve.source.ageSec;
  assert.equal(run({}, input).rwaShield.breakerReason, 'reserve_freshness_unknown');
  input.reserve.source = { ageSec: 0, live: false, cached: false, fallback: true };
  assert.equal(run({}, input).rwaShield.breakerReason, 'reserve_unverified');
  assert.equal(run({ mode: 'sandbox' }, input).overallStatus, 'SAFE');
});

test('current missing core protocol parameters closes gate; explicit sandbox remains incomplete', () => {
  const input = fixture(); input.reserve.liquidationThreshold = null;
  assert.equal(run({}, input).rwaShield.breakerReason, 'reserve_parameters_unavailable');
  assert.equal(run({ mode: 'sandbox' }, input).overallStatus, 'WARNING');
});

test('fresh known cached reserve is permitted; replay requires explicit capture observation age', () => {
  const input = fixture(); input.reserve.source = { ageSec: 30, cached: true, live: false, fallback: true };
  assert.equal(run({}, input).rwaShield.borrowDisabled, false);
  input.reserve.source.ageSec = 1000;
  assert.equal(run({ mode: 'snapshot-replay' }, input).rwaShield.breakerReason, 'stale_reserve');
  input.reserve.ageAtCaptureSec = 5;
  const replay = run({ mode: 'snapshot-replay' }, input);
  assert.equal(replay.rwaShield.borrowDisabled, false);
  assert.equal(replay.reserve.ageSec, 1000);
  assert.equal(replay.reserve.modeledAgeSec, 5);
});

test('subnormal denominators never leak non-finite ratios or percentage changes', () => {
  const input = fixture(); input.reserve.borrowCapUsd = Number.MIN_VALUE;
  assert.equal(run({}, input).reserve.borrowCapUsage, null);
  input.asset.navPrice = Number.MIN_VALUE;
  input.reserve.kaminoOraclePrice = Number.MIN_VALUE;
  const r = run({ notionalUsd: 0 }, input);
  assert.equal(r.asset.navShockPct, null);
  const visit = value => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(r);
});
