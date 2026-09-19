/**
 * ECV parameters. Every value here is a decision that must survive the question
 * "where does this number come from?". Defaults are priors; the calibrator agent
 * fits them on historical data and writes data/params.fitted.json.
 */

export const DEFAULT_PARAMS = {
  // --- price / staleness ---
  maxStalenessSec: 30,          // feed older than this => breaker
  twapWeight: 0.35,             // blend: 0 = pure spot, 1 = pure TWAP

  // --- depth ---
  maxImpactPct: 2.5,            // size beyond this impact is treated as unexecutable
  depthFloorUsd: 25_000,        // below this routable depth => breaker

  // --- session modifiers (underlying market state) ---
  session: {
    regular: 1.00,
    afterHours: 0.93,
    weekend: 0.85,
    holiday: 0.85
  },

  // --- volatility haircut ---
  volWindowDays: 14,
  volRefAnnual: 0.18,           // "normal" annualised vol for a broad index
  volSlope: 0.9,                // haircut per unit of excess vol
  volFloor: 0.70,               // never cut more than this

  // --- protocol ---
  safetyFactor: 0.80,           // final buffer on top of ECV
  liquidationBonusPct: 5,       // paid to liquidator, reduces recovery
  riskPremiumBase: 0.02,        // 2% base spread
  riskPremiumSlope: 0.35,       // spread added per unit of risk
  targetHealth: 1.15            // health factor at which borrowing is capped
};

export const PARAM_BOUNDS = {
  twapWeight:        [0.0, 0.8, 0.05],
  maxImpactPct:      [1.0, 6.0, 0.5],
  'session.weekend': [0.60, 1.00, 0.05],
  'session.afterHours': [0.75, 1.00, 0.02],
  volSlope:          [0.0, 2.0, 0.1],
  safetyFactor:      [0.60, 0.95, 0.05]
};

export function clone(p) { return JSON.parse(JSON.stringify(p)); }

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] ?? {}), obj);
  target[last] = value;
  return obj;
}
