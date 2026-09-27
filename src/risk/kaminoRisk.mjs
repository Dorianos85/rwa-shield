/**
 * Deterministic reserve / execution / abstract borrower-book comparison.
 * No networking or wall-clock reads; suitable for Node and browser imports.
 * Percent inputs: utilization/LTV are fractions; quote impact is percentage points.
 */
import { computeEcv, recoveryOnLiquidation, slippageTerm } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';

const MAX_MONEY = Number.MAX_SAFE_INTEGER / 100;
const SEARCH_STEPS = 64; // numerical resolution, not a financial risk parameter
const SEARCH_REFINEMENTS = 40;
const RANK = { SAFE: 0, WARNING: 1, CRITICAL: 2 };
const unwrap = value => value && typeof value === 'object' && 'value' in value ? value.value : value;
const optional = value => {
  value = unwrap(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
const ratio = (numerator, denominator) => {
  const quotient = denominator > 0 ? numerator / denominator : NaN;
  return Number.isFinite(quotient) ? quotient : null;
};
const percentChange = (value, baseline) => {
  const quotient = ratio(value, baseline);
  const change = quotient === null ? null : (quotient - 1) * 100;
  return change !== null && Number.isFinite(change) ? change : null;
};
const bounded = (value, name, lo, hi) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < lo || value > hi) {
    throw new RangeError(`${name} must be finite and between ${lo} and ${hi}`);
  }
  return value;
};
const money = (value, name) => bounded(value, name, 0, MAX_MONEY);
const fraction = (value, name) => bounded(value, name, 0, 1);
const round2 = x => Math.round(x * 100) / 100;

function normalize(input) {
  const { reserve = {}, asset = {}, execution = {}, scenario = {} } = input;
  const supplied = input.rwaParams ?? DEFAULT_PARAMS;
  const p = { ...DEFAULT_PARAMS, ...supplied,
    session: { ...DEFAULT_PARAMS.session, ...supplied.session },
    riskLab: { ...DEFAULT_PARAMS.riskLab, ...supplied.riskLab } };
  bounded(p.maxImpactPct, 'maxImpactPct', Number.EPSILON, 100);
  bounded(p.targetHealth, 'targetHealth', 1, MAX_MONEY);
  fraction(p.safetyFactor, 'safetyFactor');
  money(p.depthFloorUsd, 'depthFloorUsd');
  money(p.maxStalenessSec, 'maxStalenessSec');
  money(p.riskLab.maxExecutionAgeSec, 'maxExecutionAgeSec');
  money(p.riskLab.maxReserveAgeSec, 'maxReserveAgeSec');
  bounded(p.liquidationBonusPct, 'liquidationBonusPct', 0, 100);
  fraction(p.twapWeight, 'twapWeight');
  fraction(p.volFloor, 'volFloor');
  money(p.volSlope, 'volSlope');
  money(p.volRefAnnual, 'volRefAnnual');
  fraction(p.riskPremiumBase, 'riskPremiumBase');
  fraction(p.riskPremiumSlope, 'riskPremiumSlope');
  for (const value of Object.values(p.session)) fraction(value, 'session modifier');
  const currentNav = optional(asset.navPrice) ?? 0;
  const currentLiquidity = optional(execution.routableUsd) ?? 0;
  const currentUtilization = optional(reserve.currentUtilization);
  money(currentNav, 'asset.navPrice');
  money(currentLiquidity, 'execution.routableUsd');
  if (currentUtilization !== null) fraction(currentUtilization, 'reserve.currentUtilization');
  const s = {
    utilization: fraction(scenario.utilization ?? currentUtilization ?? 0, 'utilization'),
    navPrice: money(scenario.navPrice ?? currentNav, 'navPrice'),
    ammLiquidityUsd: money(scenario.ammLiquidityUsd ?? currentLiquidity, 'ammLiquidityUsd'),
    averageHealthFactor: bounded(scenario.averageHealthFactor ?? p.riskLab.defaultAverageHealthFactor,
      'averageHealthFactor', 0, MAX_MONEY),
    notionalUsd: money(scenario.notionalUsd ?? p.riskLab.defaultNotionalUsd, 'notionalUsd'),
    mode: scenario.mode ?? 'current'
  };
  if (!['current', 'snapshot-replay', 'sandbox'].includes(s.mode)) throw new RangeError('Unknown scenario mode');
  const tvl = optional(reserve.tvlUsd);
  if (tvl !== null) money(tvl, 'reserve.tvlUsd');
  for (const key of ['configuredLtv', 'liquidationThreshold', 'optimalUtilization', 'firstCurveKink']) {
    if (optional(reserve[key]) !== null) fraction(unwrap(reserve[key]), `reserve.${key}`);
  }
  for (const key of ['borrowCapUsd', 'supplyCapUsd', 'kaminoOraclePrice']) {
    if (optional(reserve[key]) !== null) money(unwrap(reserve[key]), `reserve.${key}`);
  }
  const qty = currentNav > 0 ? s.notionalUsd / currentNav : 0;
  money(qty, 'collateral quantity');
  money(qty * s.navPrice, 'stressed collateral reference value');
  const priceAgeActual = optional(asset.priceAgeSec);
  const captureAge = optional(asset.priceAgeAtCaptureSec);
  const replay = s.mode === 'snapshot-replay' && captureAge !== null && captureAge >= 0;
  const age = s.mode === 'sandbox' ? 0 : replay ? captureAge : priceAgeActual;
  if (age !== null) money(age, 'price age');
  const volatility = optional(asset.realizedVolAnnual);
  if (volatility !== null) money(volatility, 'realizedVolAnnual');
  const executionAgeActual = optional(execution.source?.ageSec);
  const executionCaptureAge = optional(execution.ageAtCaptureSec ?? execution.source?.ageAtCaptureSec);
  const executionAge = s.mode === 'snapshot-replay' && executionCaptureAge !== null ? executionCaptureAge : executionAgeActual;
  let executionGateReason = null;
  if (s.mode !== 'sandbox') {
    if (execution.measured !== true) executionGateReason = 'execution_unverified';
    else if (executionAge === null || executionAge < 0) executionGateReason = 'execution_freshness_unknown';
    else if (executionAge > p.riskLab.maxExecutionAgeSec) executionGateReason = 'stale_execution';
  }
  const reserveAgeActual = optional(reserve.source?.ageSec);
  const reserveCaptureAge = optional(reserve.ageAtCaptureSec ?? reserve.source?.ageAtCaptureSec);
  const reserveAge = s.mode === 'snapshot-replay' && reserveCaptureAge !== null ? reserveCaptureAge : reserveAgeActual;
  const reserveVerified = reserve.source?.live === true || reserve.source?.cached === true || reserve.source?.verified === true;
  let reserveGateReason = null;
  if (s.mode !== 'sandbox') {
    if (reserveAge === null || reserveAge < 0) reserveGateReason = 'reserve_freshness_unknown';
    else if (reserveAge > p.riskLab.maxReserveAgeSec) reserveGateReason = 'stale_reserve';
    else if (!reserveVerified) reserveGateReason = 'reserve_unverified';
    else if (tvl === null || currentUtilization === null || optional(reserve.configuredLtv) === null || optional(reserve.liquidationThreshold) === null) reserveGateReason = 'reserve_parameters_unavailable';
  }
  return { reserve, asset, execution, p, s, currentNav, currentLiquidity, currentUtilization,
    tvl, qty, age: age ?? MAX_MONEY, priceAgeActual, replay,
    executionAgeActual, executionAge, executionGateReason,
    reserveAgeActual, reserveAge, reserveGateReason,
    volatility: volatility ?? p.volRefAnnual };
}

/**
 * Rescale horizontal curve notionals by liquidity / baseline liquidity.
 * A monotone impact envelope removes noisy quote improvements. Beyond measured
 * support, linear extrapolation is a conservative stress assumption, not a quote.
 */
function executionAt(n, navPrice, liquidity) {
  const referenceValue = n.qty * navPrice;
  const routable = Math.min(referenceValue, liquidity);
  const curve = (Array.isArray(n.execution.curve) ? n.execution.curve : [])
    .filter(q => q.ok !== false && optional(q.notionalUsd) > 0 && optional(q.impactPct) !== null)
    .map(q => ({ ...q, impactPct: Math.max(0, Math.min(100, q.impactPct)) }))
    .sort((a, b) => a.notionalUsd - b.notionalUsd);
  if (liquidity <= 0 || n.currentLiquidity <= 0 || curve.length === 0) {
    return { referenceValue, routableUsd: 0, impactPct: 100,
      route: 'unavailable', curveAvailable: curve.length > 0, extrapolated: false };
  }
  const scaledNotional = referenceValue * (n.currentLiquidity / liquidity);
  let previous = { notionalUsd: 0, impactPct: 0, route: curve[0].route };
  for (const raw of curve) {
    const point = { ...raw, impactPct: Math.max(previous.impactPct, raw.impactPct) };
    if (scaledNotional <= point.notionalUsd) {
      const span = point.notionalUsd - previous.notionalUsd;
      const weight = span > 0 ? (scaledNotional - previous.notionalUsd) / span : 1;
      return { referenceValue, routableUsd: routable,
        impactPct: previous.impactPct + weight * (point.impactPct - previous.impactPct),
        route: point.route ?? n.execution.route ?? 'measured curve', curveAvailable: true, extrapolated: false };
    }
    previous = point;
  }
  return { referenceValue, routableUsd: routable,
    impactPct: Math.min(100, previous.impactPct * (scaledNotional / previous.notionalUsd)),
    route: previous.route ?? n.execution.route ?? 'measured curve', curveAvailable: true, extrapolated: true };
}

function valuationAt(n, navPrice, liquidity) {
  const x = executionAt(n, navPrice, liquidity);
  const rawInput = { mint: n.asset.mint ?? n.reserve.mint, symbol: n.asset.symbol ?? n.reserve.symbol,
    qty: n.qty, oraclePrice: navPrice, twapPrice: navPrice, priceAgeSec: n.age,
    impactPct: x.impactPct, routableUsd: x.routableUsd, routeLabel: x.route,
    sessionState: n.asset.sessionState ?? 'weekend', realizedVolAnnual: n.volatility };
  // The frozen engine caps loss beyond maxImpactPct. Normalize route proceeds
  // BEFORE calling it so extreme losses cannot become a flat optimistic mark.
  // Preserve its existing conservative step at maxImpactPct via min().
  const frozenS = slippageTerm(rawInput, n.p);
  const conservativeS = Math.min(frozenS, Math.max(0, 1 - x.impactPct / 100));
  const impactAdjustment = frozenS > 0 ? conservativeS / frozenS : 0;
  // The normalized model input is the tested fill, not total market depth.
  // Enforce the original depth floor against available market depth below;
  // otherwise a $10k test position in a deep pool incorrectly trips a $25k floor.
  const model = computeEcv({ ...rawInput, routableUsd: x.routableUsd * impactAdjustment },
    { ...n.p, depthFloorUsd: 0 });
  const zeroCollateral = x.referenceValue <= 0;
  const unavailableCurve = !x.curveAvailable;
  const reason = zeroCollateral ? 'zero_collateral' : unavailableCurve ? 'execution_unavailable' :
    n.age > n.p.maxStalenessSec ? 'stale_price' : n.executionGateReason ?? n.reserveGateReason ??
    (liquidity < n.p.depthFloorUsd ? 'depth_floor' : model.outputs.breaker_reason);
  const borrowDisabled = reason !== null;
  const outputs = { ...model.outputs,
    max_borrow: borrowDisabled ? 0 : model.outputs.max_borrow,
    borrow_disabled: borrowDisabled, breaker_reason: reason };
  const riskPremium = Number((n.p.riskPremiumBase + n.p.riskPremiumSlope *
    (1 - conservativeS * model.terms.M * model.terms.V)).toFixed(4));
  outputs.risk_premium = riskPremium;
  return { ...x, model: { ...model, terms: { ...model.terms, B: borrowDisabled ? 0 : 1 }, outputs }, conservativeS, impactAdjustment };
}

function borrowRateAt(curve, utilization) {
  const nodes = (Array.isArray(curve) ? curve : [])
    .filter(n => optional(n.utilization) !== null && optional(n.borrowRate) !== null)
    .filter(n => n.utilization >= 0 && n.utilization <= 1 && n.borrowRate >= 0)
    .sort((a, b) => a.utilization - b.utilization);
  if (!nodes.length) return null;
  if (utilization <= nodes[0].utilization) return nodes[0].borrowRate;
  for (let i = 1; i < nodes.length; i++) {
    if (utilization <= nodes[i].utilization) {
      const a = nodes[i - 1], b = nodes[i];
      const weight = (utilization - a.utilization) / (b.utilization - a.utilization);
      return a.borrowRate + weight * (b.borrowRate - a.borrowRate);
    }
  }
  return nodes.at(-1).borrowRate;
}

function evaluate(n) {
  const { reserve, asset, execution, s, p, tvl } = n;
  const baseline = valuationAt(n, n.currentNav, n.currentLiquidity);
  const v = valuationAt(n, s.navPrice, s.ammLiquidityUsd);
  const m = v.model;
  const configuredLtv = optional(reserve.configuredLtv);
  const liquidationThreshold = optional(reserve.liquidationThreshold);
  const cap = optional(reserve.borrowCapUsd);
  const supplyCap = optional(reserve.supplyCapUsd);
  const optimalUtilization = optional(reserve.optimalUtilization);
  const kink = optimalUtilization ?? optional(reserve.firstCurveKink);
  const borrowed = tvl === null ? null : tvl * s.utilization;
  const available = tvl === null ? null : tvl * (1 - s.utilization);
  const executableRatio = ratio(m.executableValue, baseline.model.executableValue);
  const stressedHf = executableRatio === null ? null : s.averageHealthFactor * executableRatio;
  if (stressedHf !== null && !Number.isFinite(stressedHf)) throw new RangeError('Health stress ratio exceeds numeric domain');
  const safeLtv = ratio(m.outputs.max_borrow, v.referenceValue) ?? 0;
  const kaminoCapacity = configuredLtv === null ? null : v.referenceValue * configuredLtv;
  const recovery = recoveryOnLiquidation(m.executableValue, p);
  const constraints = [];
  const add = (id, severity, message, value, threshold) => constraints.push({ id, severity, message, value, threshold });
  if (v.referenceValue <= 0) add('zero_collateral', 'CRITICAL', 'The tested collateral has zero reference value.', v.referenceValue, 0);
  if (m.outputs.borrow_disabled) {
    const breakerNumbers = {
      stale_price: [n.age, p.maxStalenessSec],
      depth_floor: [s.ammLiquidityUsd, p.depthFloorUsd],
      impact_extreme: [v.impactPct, p.maxImpactPct * 2],
      stale_execution: [n.executionAge, p.riskLab.maxExecutionAgeSec],
      execution_freshness_unknown: [null, p.riskLab.maxExecutionAgeSec],
      execution_unverified: [null, null],
      stale_reserve: [n.reserveAge, p.riskLab.maxReserveAgeSec],
      reserve_freshness_unknown: [null, p.riskLab.maxReserveAgeSec],
      reserve_unverified: [null, null],
      reserve_parameters_unavailable: [null, null],
      zero_collateral: [v.referenceValue, 0],
      execution_unavailable: [null, null]
    }[m.outputs.breaker_reason] ?? [null, null];
    add('borrow_breaker', 'CRITICAL', `RWA new borrowing disabled: ${m.outputs.breaker_reason}.`, ...breakerNumbers);
  }
  if (baseline.model.executableValue <= 0) add('baseline_unexecutable', 'CRITICAL', 'Baseline executable collateral is zero; an average health stress ratio cannot be defined.', 0, null);
  if (stressedHf !== null && stressedHf < 1) add('health_liquidation', 'CRITICAL', `Stressed Average HF ${stressedHf.toFixed(3)} is below the modeled liquidation boundary 1.000.`, stressedHf, 1);
  if (v.routableUsd < v.referenceValue) add('execution_shortfall', 'CRITICAL', `Execution depth $${round2(v.routableUsd)} cannot cover tested collateral $${round2(v.referenceValue)}.`, v.routableUsd, v.referenceValue);
  if (cap !== null && borrowed !== null && borrowed >= cap) add('borrow_cap', 'CRITICAL', `Scenario reserve borrowing $${round2(borrowed)} reaches borrow cap $${round2(cap)}.`, borrowed, cap);
  if (available !== null && available <= 0) add('reserve_exhausted', 'CRITICAL', 'Scenario reserve liquidity is exhausted.', available, 0);
  if (supplyCap !== null && tvl !== null && tvl > supplyCap) add('supply_cap', 'WARNING', 'Reserve supplied value exceeds the reported supply cap; this does not imply borrower insolvency.', tvl, supplyCap);
  if (stressedHf !== null && stressedHf >= 1 && stressedHf < p.targetHealth) add('health_buffer', 'WARNING', `Stressed Average HF ${stressedHf.toFixed(3)} is below RWA target ${p.targetHealth.toFixed(3)}.`, stressedHf, p.targetHealth);
  if (configuredLtv !== null && safeLtv < configuredLtv) add('ltv_gap', 'WARNING', `RWA safe LTV ${(safeLtv * 100).toFixed(2)}% is below Kamino configured LTV ${(configuredLtv * 100).toFixed(2)}%.`, safeLtv, configuredLtv);
  if (kink !== null && s.utilization >= kink) add('utilization_kink', 'WARNING', `Scenario utilization ${(s.utilization * 100).toFixed(2)}% reaches the reported ${(kink * 100).toFixed(2)}% rate-curve breakpoint.`, s.utilization, kink);
  if (v.impactPct > p.maxImpactPct && !m.outputs.borrow_disabled) add('execution_impact', 'WARNING', `Modeled price impact ${v.impactPct.toFixed(2)}% exceeds RWA tolerance ${p.maxImpactPct.toFixed(2)}%.`, v.impactPct, p.maxImpactPct);
  if (tvl === null || n.currentUtilization === null || configuredLtv === null || liquidationThreshold === null) {
    add('protocol_data_incomplete', 'WARNING', 'Some reserve parameters are unavailable; the reserve comparison is incomplete.', null, null);
  }
  const dominant = constraints.find(c => c.severity === 'CRITICAL') ?? constraints[0];
  return {
    scenario: { ...s }, valuationMode: s.mode === 'sandbox' ? 'sandbox' : n.replay ? 'snapshot-replay' : 'current',
    modeledOnly: s.mode !== 'current',
    assumptions: s.mode === 'sandbox' ? ['Hypothetical fresh reference (modeled age zero), usable execution curve (including synthetic or stale curves), and fixed reserve state; this is not the current borrowing gate. Actual timestamps and provenance remain unchanged.'] : [],
    sources: { reserve: reserve.source ?? null, asset: asset.source ?? null, execution: execution.source ?? null },
    reserve: { market: reserve.market ?? reserve.marketName ?? null, reserve: reserve.reserve ?? reserve.reserveAddress ?? null,
      symbol: reserve.symbol ?? asset.symbol ?? null, tvlUsd: tvl, currentUtilization: n.currentUtilization,
      ageSec: n.reserveAgeActual, modeledAgeSec: n.reserveAge, maxAgeSec: p.riskLab.maxReserveAgeSec,
      scenarioUtilization: s.utilization,
      currentBorrowedUsd: tvl === null || n.currentUtilization === null ? null : tvl * n.currentUtilization,
      currentAvailableUsd: tvl === null || n.currentUtilization === null ? null : tvl * (1 - n.currentUtilization),
      scenarioBorrowedUsd: borrowed, scenarioAvailableUsd: available, reserveLiquidityBuffer: 1 - s.utilization,
      configuredLtv, liquidationThreshold, borrowCapUsd: cap, supplyCapUsd: supplyCap, optimalUtilization,
      rateCurveKink: kink,
      borrowCapUsage: borrowed === null || cap === null ? null : ratio(borrowed, cap),
      borrowCapHeadroomUsd: borrowed === null || cap === null ? null : cap - borrowed,
      remainingReserveCapacityUsd: available === null ? null : Math.max(0, cap === null ? available : Math.min(available, cap - borrowed)),
      distanceToKink: kink === null ? null : kink - s.utilization,
      interestRateRegime: kink === null ? 'unknown' : s.utilization >= kink ? 'above-kink' : 'below-kink',
      borrowRate: borrowRateAt(reserve.borrowRateCurve, s.utilization) },
    asset: { kaminoOraclePrice: optional(reserve.kaminoOraclePrice), navPriceCurrent: n.currentNav,
      navPriceScenario: s.navPrice, navShockPct: percentChange(s.navPrice, n.currentNav),
      collateralQty: n.qty, collateralReferenceValue: v.referenceValue,
      priceAgeSec: n.priceAgeActual, modeledPriceAgeSec: n.age,
      oracleNavDivergencePct: asset.source?.independentNav === false ? null : percentChange(n.currentNav, optional(reserve.kaminoOraclePrice)) },
    execution: { ammLiquidityCurrentUsd: n.currentLiquidity, ammLiquidityScenarioUsd: s.ammLiquidityUsd,
      priceImpactPct: v.impactPct, route: v.route, routableUsd: v.routableUsd,
      effectiveRoutableUsd: v.routableUsd * v.impactAdjustment, extrapolated: v.extrapolated,
      measured: execution.measured === true, ageSec: n.executionAgeActual,
      modeledAgeSec: n.executionAge, maxAgeSec: p.riskLab.maxExecutionAgeSec,
      baselinePriceImpactPct: baseline.impactPct,
      curveModel: 'Monotone impact envelope; horizontal liquidity scaling; linear tail stress extrapolation.' },
    health: { averageHealthFactorInitial: s.averageHealthFactor, averageHealthFactorStressed: stressedHf,
      targetHealth: p.targetHealth, liquidationBoundary: 1, baselineExecutableValue: baseline.model.executableValue,
      executableValueRatio: executableRatio, healthBuffer: stressedHf === null ? null : stressedHf - 1,
      interpretation: 'Abstract borrower-book stress parameter, not measured Kamino account health.' },
    rwaShield: { oracleValue: m.oracleValue, executableValue: m.executableValue, ecv: m.ecv,
      maxBorrow: m.outputs.max_borrow, safeLtv, collateralCap: m.outputs.collateral_cap,
      riskPremium: m.outputs.risk_premium, borrowDisabled: m.outputs.borrow_disabled,
      breakerReason: m.outputs.breaker_reason, liquidationRoute: m.outputs.liquidation_route,
      recovery, recoveryVsNotional: ratio(recovery, s.notionalUsd),
      recoveryCoverage: null, recoveryDenominator: 'baseline tested liquidation notional; no position debt is assumed',
      terms: { ...m.terms }, outputs: { ...m.outputs },
      waterfall: [
        { label: 'Scenario reference value', value: v.referenceValue },
        { label: 'Depth / extreme-impact adjustment', value: v.referenceValue * m.terms.D },
        { label: 'Executable after slippage', value: m.executableValue },
        { label: 'Session buffer', value: m.executableValue * m.terms.M },
        { label: 'ECV after volatility', value: m.ecv },
        { label: 'RWA max borrow', value: m.outputs.max_borrow }
      ] },
    comparison: { kaminoBorrowCapacityUsd: kaminoCapacity, rwaBorrowCapacityUsd: m.outputs.max_borrow,
      safetyGapUsd: kaminoCapacity === null ? null : m.outputs.max_borrow - kaminoCapacity,
      safetyGapLtvPoints: configuredLtv === null ? null : (safeLtv - configuredLtv) * 100 },
    constraints, overallStatus: dominant?.severity ?? 'SAFE',
    dominantReason: dominant?.message ?? 'All modeled constraints pass for this tested exposure.'
  };
}

/** Compute one scenario. Set includeBoundaries=false for grids/batch evaluation. */
export function computeKaminoRiskScenario(input, { includeBoundaries = true } = {}) {
  const n = normalize(input);
  const result = evaluate(n);
  if (includeBoundaries) result.boundaries = boundariesFromNormalized(n);
  return result;
}

function boundary(n, key, range, direction, severity) {
  const targetRank = RANK[severity];
  const testAt = value => evaluate({ ...n, s: { ...n.s, [key]: value } });
  const breached = result => RANK[result.overallStatus] >= targetRank;
  const current = testAt(n.s[key]);
  const alreadyBreached = breached(current);
  const first = direction === 'above' ? range[0] : range[1];
  const last = direction === 'above' ? range[1] : range[0];
  // NAV is not globally monotone: a higher price increases the USD sale size at
  // fixed token quantity and can consume the whole dollar depth. Scan the full
  // axis for healthy interiors, including the actual current point, before
  // refining the first healthy -> breached transition in the adverse direction.
  const points = Array.from({ length: SEARCH_STEPS + 1 }, (_, step) => first + (last - first) * step / SEARCH_STEPS);
  if (key === 'navPrice') points.push(...navCandidates(n, range));
  points.push(n.s[key]);
  points.sort((a, b) => direction === 'above' ? a - b : b - a);
  let previousValue = null;
  let firstResult = null;
  let foundHealthy = false;
  for (const value of points) {
    const result = testAt(value);
    firstResult ??= result;
    if (breached(result) && previousValue !== null) {
      let healthy = previousValue, unhealthy = value;
      for (let refine = 0; refine < SEARCH_REFINEMENTS; refine++) {
        const middle = (healthy + unhealthy) / 2;
        if (breached(testAt(middle))) unhealthy = middle;
        else healthy = middle;
      }
      const crossed = testAt(unhealthy);
      const trigger = crossed.constraints.find(c => RANK[c.severity] >= targetRank);
      return { value: (healthy + unhealthy) / 2, reason: trigger?.message ?? crossed.dominantReason,
        alreadyBreached, noCrossing: false, limitingConstraint: trigger?.id ?? null };
    }
    if (!breached(result)) {
      foundHealthy = true;
      previousValue = value;
    }
  }
  const trigger = firstResult.constraints.find(c => RANK[c.severity] >= targetRank);
  return { value: null, reason: foundHealthy ? `No ${severity.toLowerCase()} crossing in the searched range.` :
    `No point below ${severity.toLowerCase()} was found in the searched range: ${firstResult.dominantReason}`,
    alreadyBreached, noCrossing: true, limitingConstraint: foundHealthy ? null : trigger?.id ?? null };
}

/** Analytical curve/coverage knots and executable-value extrema supplement the
 * scan so even a very narrow healthy NAV island contains a candidate point. */
function navCandidates(n, range) {
  if (!(n.qty > 0 && n.currentLiquidity > 0 && n.s.ammLiquidityUsd > 0)) return [];
  const [minimum, maximum] = range;
  const knots = [minimum, maximum, n.s.ammLiquidityUsd / n.qty];
  const scale = n.s.ammLiquidityUsd / n.currentLiquidity / n.qty;
  for (const point of n.execution.curve ?? []) {
    if (point.ok !== false && optional(point.notionalUsd) > 0) knots.push(point.notionalUsd * scale);
  }
  const inRange = value => Number.isFinite(value) && value >= minimum && value <= maximum;
  const ordered = [...new Set(knots.filter(inRange))].sort((a, b) => a - b);
  const candidates = [...ordered];
  // On a curve segment impact=a*NAV+b. Below full-depth coverage, proceeds
  // are qty*NAV*(1-(a*NAV+b)/100), whose interior maximum is (100-b)/(2*a).
  // Constant capped-slippage sections have no interior maximum; their knots
  // and the original model's discontinuity are included explicitly.
  for (let i = 1; i < ordered.length; i++) {
    const left = ordered[i - 1], right = ordered[i];
    if (!(right > left)) continue;
    const x1 = left + (right - left) / 3, x2 = left + 2 * (right - left) / 3;
    const y1 = executionAt(n, x1, n.s.ammLiquidityUsd).impactPct;
    const y2 = executionAt(n, x2, n.s.ammLiquidityUsd).impactPct;
    const slope = (y2 - y1) / (x2 - x1);
    const intercept = y1 - slope * x1;
    if (!(slope > 0)) continue;
    const extrema = (100 - intercept) / (2 * slope);
    const impactKnots = [n.p.maxImpactPct, 2 * n.p.maxImpactPct,
      100 * (1 - (1 - n.p.maxImpactPct / 100) * 0.9), 100];
    const local = [extrema, ...impactKnots.map(impact => (impact - intercept) / slope)];
    candidates.push(...local.filter(value => value >= left && value <= right));
  }
  return candidates.flatMap(value => [value, value * (1 - 32 * Number.EPSILON), value * (1 + 32 * Number.EPSILON)]).filter(inRange);
}

function boundariesFromNormalized(n) {
  const axes = {
    utilization: ['utilization', [0, 1], 'above'],
    nav: ['navPrice', [0, Math.max(n.currentNav * n.p.riskLab.navRangeMultiplier, n.s.navPrice)], 'below'],
    ammLiquidity: ['ammLiquidityUsd', [0, Math.max(n.currentLiquidity * n.p.riskLab.liquidityRangeMultiplier, n.s.ammLiquidityUsd)], 'below'],
    averageHealthFactor: ['averageHealthFactor', [0, Math.max(n.p.riskLab.maxAverageHealthFactor, n.s.averageHealthFactor)], 'below']
  };
  return Object.fromEntries(Object.entries(axes).map(([axis, [key, range, direction]]) => [axis, {
    direction, range,
    warning: boundary(n, key, range, direction, 'WARNING'),
    critical: boundary(n, key, range, direction, 'CRITICAL')
  }]));
}

/** Full-state first crossings: all other scenario inputs remain fixed. */
export function findRiskBoundaries(input) {
  return boundariesFromNormalized(normalize(input));
}
