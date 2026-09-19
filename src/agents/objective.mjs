/**
 * The objective every learning agent optimises.
 *
 *   minimise lostCredit   subject to   badDebt <= tolerance
 *
 * Stated as a constrained problem on purpose. A linear "badDebt * w + lostCredit"
 * loss is what a naive fit uses, and it degenerates: with no bad debt at the
 * starting point the optimiser simply loosens every safety parameter until bad
 * debt appears, then stops. Socialised loss is a tail risk, not a line item you
 * trade off against revenue, so it enters as a constraint with a punitive
 * violation cost instead.
 *
 * tolerance = 5 bps of everything the fixed-LTV venue lent over the same period.
 */

import { runBacktest } from '../backtest/engine.mjs';
import { SCENARIOS } from '../backtest/scenarios.mjs';

export const BAD_DEBT_TOLERANCE_BPS = 5;
export const VIOLATION_WEIGHT = 500;

export function evaluate(params, baseSeries, { scenarios = SCENARIOS } = {}) {
  let badDebt = 0, lostCredit = 0, lentEcv = 0, lentFixed = 0, refusals = 0;

  for (const sc of scenarios) {
    const r = runBacktest(sc.transform(baseSeries), {
      params, depthStressFactor: sc.depthStressFactor, label: sc.id
    });
    badDebt += r.ecv.badDebt;
    lentEcv += r.ecv.lent;
    lentFixed += r.fixed.lent;
    refusals += r.ecv.refusals;
  }
  lostCredit = Math.max(0, lentFixed - lentEcv);

  const tolerance = lentFixed * (BAD_DEBT_TOLERANCE_BPS / 10_000);
  const violation = Math.max(0, badDebt - tolerance);

  return {
    loss: lostCredit + violation * VIOLATION_WEIGHT,
    badDebt, tolerance, violation, lostCredit, lentEcv, lentFixed, refusals,
    lentRatio: lentFixed > 0 ? lentEcv / lentFixed : 0
  };
}
