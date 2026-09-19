/**
 * The ECV model. Pure, deterministic, no I/O.
 *
 *   ECV = P_oracle * q * D(q) * S(q) * M(t) * V(sigma) * B
 *
 * Every term returns a factor in (0, 1]; the product is the USDC we believe a
 * forced liquidation of this position would actually return, right now.
 */

import { DEFAULT_PARAMS } from './params.mjs';

/** @typedef {{
 *   mint: string,
 *   symbol: string,
 *   qty: number,
 *   oraclePrice: number,
 *   twapPrice?: number,
 *   priceAgeSec: number,
 *   impactPct: number,        // real price impact for this size, from the router
 *   routableUsd: number,      // USDC actually routable for this size
 *   sessionState: 'regular'|'afterHours'|'weekend'|'holiday',
 *   realizedVolAnnual: number
 * }} EcvInput */

export function priceTerm(input, p) {
  const spot = input.oraclePrice;
  const twap = input.twapPrice ?? spot;
  return spot * (1 - p.twapWeight) + twap * p.twapWeight;
}

export function depthTerm(input, p) {
  const notional = input.qty * input.oraclePrice;
  if (notional <= 0) return 0;
  const routable = Math.min(input.routableUsd, notional);
  return clamp01(routable / notional);
}

export function slippageTerm(input, p) {
  const impact = Math.max(0, input.impactPct) / 100;
  if (input.impactPct > p.maxImpactPct) {
    // beyond our tolerance the curve is unreliable - punish, do not extrapolate
    return clamp01(1 - p.maxImpactPct / 100) * 0.9;
  }
  return clamp01(1 - impact);
}

export function sessionTerm(input, p) {
  return p.session[input.sessionState] ?? p.session.weekend;
}

export function volatilityTerm(input, p) {
  const excess = Math.max(0, input.realizedVolAnnual - p.volRefAnnual);
  return clamp(1 - p.volSlope * excess, p.volFloor, 1);
}

export function breakerTerm(input, p) {
  if (input.priceAgeSec > p.maxStalenessSec) return { value: 0, reason: 'stale_price' };
  if (input.routableUsd < p.depthFloorUsd) return { value: 0, reason: 'depth_floor' };
  if (input.impactPct > p.maxImpactPct * 2) return { value: 0, reason: 'impact_extreme' };
  return { value: 1, reason: null };
}

/**
 * @param {EcvInput} input
 * @param {typeof DEFAULT_PARAMS} [params]
 */
export function computeEcv(input, params = DEFAULT_PARAMS) {
  const p = params;
  const price = priceTerm(input, p);
  const oracleValue = input.qty * input.oraclePrice;

  const D = depthTerm(input, p);
  const S = slippageTerm(input, p);
  const M = sessionTerm(input, p);
  const V = volatilityTerm(input, p);
  const B = breakerTerm(input, p);

  const executable = input.qty * price * D * S;
  // NOTE: the breaker gates NEW BORROWING. It does not make existing collateral
  // worthless - marking a position at zero because a feed is stale would create
  // exactly the cascade we are trying to prevent.
  const ecv = executable * M * V;

  const maxBorrow = B.value === 0 ? 0 : ecv * p.safetyFactor / p.targetHealth;
  const riskLevel = 1 - (S * M * V);
  const riskPremium = p.riskPremiumBase + p.riskPremiumSlope * riskLevel;

  return {
    oracleValue,
    // What a sale right now would actually return. This is the MARK: it is what
    // a liquidation recovers, so it is what the health factor is measured against.
    executableValue: executable,
    // The forward-looking, haircut value. This is what we are willing to LEND
    // against - session and volatility are buffers against the next few hours,
    // not a claim about what the asset is worth today.
    ecv,
    terms: { price, D, S, M, V, B: B.value },
    outputs: {
      max_borrow: round2(maxBorrow),
      collateral_cap: round2(ecv * 3),
      liquidation_route: input.routeLabel ?? 'jupiter:best',
      risk_premium: Number(riskPremium.toFixed(4)),
      borrow_disabled: B.value === 0,
      breaker_reason: B.reason
    },
    // what a fixed-LTV venue would have lent against the same position
    fixedLtvBorrow: round2(oracleValue * 0.70)
  };
}

/**
 * Health factor of an open position, measured against the EXECUTABLE value.
 * Deliberately not against ECV: marking a healthy loan down because the NYSE
 * closed on Friday would liquidate the entire book every weekend. The session
 * haircut protects the pool at origination; the mark protects it at exit.
 */
export function healthFactor(executableValue, debt, params = DEFAULT_PARAMS) {
  if (debt <= 0) return Infinity;
  return (executableValue * params.safetyFactor) / debt;
}

/** What a liquidation actually returns, net of the liquidator bonus. */
export function recoveryOnLiquidation(executableValue, params = DEFAULT_PARAMS) {
  return executableValue * (1 - params.liquidationBonusPct / 100);
}

const clamp01 = (x) => clamp(x, 0, 1);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const round2 = (x) => Math.round(x * 100) / 100;
