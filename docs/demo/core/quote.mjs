// Generated from the canonical offline adapter.
export function syntheticQuote({ notionalUsd, depthUsd = 400_000, k = 0.096 }) {
  // convex size-impact curve, calibrated so $100k into a $400k book costs ~1.2%
  const impactPct = 100 * k * Math.pow(notionalUsd / depthUsd, 1.5);
  return {
    ok: true,
    outUsd: notionalUsd * (1 - impactPct / 100),
    impactPct,
    route: 'synthetic:raydium>orca'
  };
}
