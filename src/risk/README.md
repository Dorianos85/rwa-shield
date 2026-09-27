# Deterministic Kamino comparison layer

`kaminoRisk.mjs` imports the frozen ECV engine. It contains no network requests,
clock reads, framework code, or Node-only imports. The browser and API use the
same `computeKaminoRiskScenario(input, { includeBoundaries: true })` export.
`findRiskBoundaries(input)` exposes the boundary calculation separately.

Inputs use USD for money, fractional utilization/LTV/annual rates, and percentage
points for execution impact. Unknown protocol fields remain null. Normalized
`{value, available, reason}` protocol fields are also accepted. The engine does
not manufacture protocol values, an independent issuer NAV, or position debt.
All calibration controls reside in `src/ecv/params.mjs`; grid resolution and
numeric input bounds are numerical implementation controls, not risk thresholds.

## USDC funding and xStock collateral

The dashboard supplies two normalized reserves:

* Input `reserve` is the selected xStock **collateral** reserve. Its LTV,
  liquidation threshold, oracle price, token identity and freshness describe
  the asset being tested for liquidation.
* Input `fundingReserve` is the **USDC** reserve in the same Kamino market.
  Its TVL, utilization, borrowed/available USD, borrow/supply caps and rate curve
  drive the utilization slider and all reserve-pressure boundaries.

The output `reserve` contains USDC pressure metrics (`role: 'funding'`), including
its own symbol, address, mint and freshness. Output `collateralReserve` contains
the selected xStock identity, LTV, liquidation threshold, oracle and provenance.
For old consumers, `reserve.configuredLtv` and `reserve.liquidationThreshold`
remain compatibility aliases **belonging to collateralReserve**, explicitly
marked by `reserve.policyBelongsTo`. New UI code must read collateral policy
from `collateralReserve`. `asset.kaminoOraclePrice` always means the xStock
oracle. `sources.reserve` is the pressure-source alias; explicit
`sources.fundingReserve` and `sources.collateralReserve` remove ambiguity.

Freshness is enforced independently for both reserves. Explicit funding must
identify USDC in the same nonempty market as the collateral; absent or mismatched
identity closes the gate even in sandbox. Explicit `fundingReserve: null` means
USDC is unavailable: pressure metrics remain null and lending stays disabled in
every mode. It never substitutes the xStock reserve. Legacy callers that omit
the property entirely retain single-reserve behavior, marked
`role: 'legacy-single-reserve'`.

## Three independent accounting layers

* **USDC reserve:** fixed supplied USD value times scenario utilization gives borrowed
  USD; its complement gives available reserve USD. Neither price, execution
  depth, nor abstract Average HF alters this debt or TVL.
* **Tested collateral:** quantity is baseline tested notional divided by baseline
  reference price. This quantity stays fixed through NAV shocks. Scenario
  reference value is quantity times scenario price. The reported Kamino oracle
  remains unchanged. Kamino comparison capacity is a hypothetical newly
  originated capacity at configured LTV, not an existing debt balance.
* **Abstract book health:** stressed Average HF is initial Average HF times
  scenario executable value divided by baseline executable value. There is no
  second price multiplier. A zero baseline makes the ratio unavailable and
  status critical. This is not a measured distribution of Kamino account health.

Recovery reuses `recoveryOnLiquidation`, including the existing liquidator bonus.
The displayed recovery ratio uses **baseline tested liquidation notional** as
its denominator. Debt recovery coverage remains null because no position debt
was supplied. Safe LTV uses stressed reference value; zero reference produces
safe LTV zero and blocks borrowing.

## Execution stress and the frozen model

Curve points are ordered by notional, with a nondecreasing impact envelope.
Scenario liquidity scales curve notional coordinates horizontally: a sale of
USD `N` at liquidity `L` queries the baseline curve at `N * L0 / L`. Lower
liquidity therefore worsens modeled impact. Linear interpolation is used within
the observed curve; the tail scales linearly from the final measured point and
is explicitly marked extrapolated. This tail is a stress assumption, not a live
executable quote. A missing curve never produces known proceeds or SAFE.

The frozen model has a constant slippage penalty beyond its tolerance. This
layer preserves that conservative penalty, but prevents optimistic plateaus
under more extreme impact: use the smaller of the model slippage factor and
`1 - actual impact`, normalize the tested fill before calling `computeEcv`, and
retain actual impact for its gate. The waterfall exposes this normalization.
The model's market depth floor is enforced separately against total execution
liquidity because the normalized fill represents the test position, not the
whole available market. A small position in a deep pool does not trip a market
depth floor merely because its own notional is small. The five frozen outputs
are retained under `rwaShield.outputs`; the existing ECV module is unchanged.

## Explicit data-time modes

* `current` (default): actual supplied `asset.priceAgeSec` controls the gate.
* `snapshot-replay`: uses `asset.priceAgeAtCaptureSec` only when explicitly
  supplied. A stale price at capture remains stale. Missing capture age falls
  back to the actual current age and current valuation mode.
* `sandbox`: explicitly assumes modeled price age zero for stress exploration.
  It also assumes the displayed execution curve is usable (including synthetic
  or stale curves) and the displayed reserve state remains fixed. It preserves
  factual ages, timestamps and all provenance, returns
  `modeledOnly: true`, and returns an assumption message. It must be presented
  as a hypothetical fresh reference, never as the current borrowing gate.

Source metadata is propagated unchanged. An oracle reference proxy explicitly
marked `source.independentNav: false` yields null oracle/NAV divergence. A stale
reference gates new borrowing but does not erase the estimated existing mark.
Missing actual age is conservatively stale. Freshness does not certify the
economic accuracy of a reference, particularly a proxy or synthetic curve.

Current and replay modes additionally close the borrowing gate when execution
is not explicitly `measured: true`, when observation age is unknown, or when age
exceeds `riskLab.maxExecutionAgeSec` (60 seconds by default). A cached measured
curve retains its actual observation age. Replay may use an explicitly supplied
`execution.ageAtCaptureSec` (or the same field in its source); absent that field,
the actual age still applies. The hypothetical sandbox is the only mode that
allows unmeasured execution to support an illustrative open gate.

Reserve observations similarly use `riskLab.maxReserveAgeSec` (60 seconds by
default). Unknown/stale age, a source not marked live/cached/verified, or missing
core TVL/utilization/LTV/liquidation-threshold data closes current/replay
borrowing. A recorded fallback is not automatically a current verified reserve.
Replay needs an explicit reserve capture age and a verified source. Sandbox
retains the incomplete-data warning. Both age limits are RWA data-validity
policies, not Kamino protocol thresholds.

## Concrete risk rules

Critical: zero collateral, unavailable/broken execution, stale-price/depth/impact
borrow breaker, zero baseline executable value, stressed HF below 1, execution
depth insufficient for the tested sale, binding borrow cap, or exhausted reserve.

Warning: stressed HF below existing RWA `targetHealth`, recommended safe LTV
below configured Kamino LTV, crossing a documented rate-curve breakpoint,
impact above existing tolerance, supplied value above the reported supply cap,
or incomplete core reserve comparison parameters. A rate-curve breakpoint is
kept separately from a nullable protocol-labeled optimal utilization. No
arbitrary utilization haircut, utilization threshold, or weighted score exists.

## Boundary semantics and limits

For each axis, all other scenario inputs stay fixed. The result searches for a
first healthy-to-warning-or-worse and healthy-to-critical crossing in the
adverse direction (`above` utilization, `below` the other axes). A deterministic
64-interval scan includes the actual scenario point, then refines the first
crossing with 40 bisection steps. Additional analytical NAV candidates include
the full execution coverage boundary, scaled curve knots, linear-segment
executable-value extrema, and slippage regime knots. These catch narrow healthy
interiors that a uniform scan alone misses. NAV can be nonmonotonic because higher price
increases the USD sale against fixed USD liquidity. The search therefore scans
for healthy interiors even if the highest NAV is already unhealthy.

An unrelated binding constraint can prevent an axis from reaching a healthy
state. Such a boundary is null with `noCrossing`, `alreadyBreached`, and an
explicit reason rather than a fictitious number. If the state goes directly
from SAFE to CRITICAL, the warning-or-worse and critical boundaries coincide.
The grid with analytical candidates is still a numerical approximation;
it is not a formal proof about the continuum or a full multi-variable liquidation
surface. Search ranges are returned with each axis, making the limitation
visible. No crossing outside the searched domain is claimed.

Invalid numeric scenario inputs throw a descriptive `RangeError`; callers must
map it to a validation error. Zero price/depth, 100% utilization, large supported
notionals and missing protocol data produce defined finite/null outputs.

Run verification: `node --test src/risk/kaminoRisk.test.mjs`.
