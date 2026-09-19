# RWA Shield — Grok handoff (2026-09-19)

## Current objective

Blockchain Hack Krakow pitch on 2026-09-20. The highest-priority deliverable is the 60-second keyboard-controlled ECV demo, not a full on-chain lending protocol.

## Run

```powershell
node src/api/server.mjs
```

Open:

```text
http://localhost:8787/?present=1&params=fitted&symbol=SPYx&notional=100000&session=regular&depth=400000&step=0
```

Keys: `P` presentation/fullscreen, `Home` reset, `Left/Right` navigate, `F` priors/fitted, `Esc` exit.

## Completed in this handoff

- English three-step presentation: valuation → weekend/thin-book breaker → synthetic stress replay.
- URL-restorable scenario and presentation state.
- Position-size/price-impact depth curve with a visible 5% breaker threshold.
- Request-level `?params=priors|fitted` support across state, ECV, and backtest APIs.
- Jupiter probe timeout and explicit deterministic offline fallback.
- Input bounds and stale-response protection for stage controls.
- Projector-scale browser verification at 1366×768 with 125% Windows scaling.
- Stage script and preflight checklist in `DEMO_RUNBOOK.md`.

Modified files:

- `web/index.html`
- `src/api/server.mjs`

Added files:

- `DEMO_RUNBOOK.md`
- `GROK_HANDOFF.md`

## Hard constraints

- Zero new npm dependencies.
- Do not change the five frozen ECV outputs: `max_borrow`, `collateral_cap`, `liquidation_route`, `risk_premium`, `borrow_disabled`.
- Keep an offline path; venue/API failure must not break the pitch.
- Do not invent TVL, revenue, market, or performance numbers.

## Verified

- `node --test src/ecv/*.test.mjs`: 7/7 passing.
- `node src/backtest/run.mjs`: completes with six scenarios.
- Baseline fitted demo: `$100,000` oracle, `$98,800` executable, `$77,322` max borrow.
- Stress fitted demo: `9.05%` impact, `$219,375` executable mark, `$0` max new borrow, `impact_extreme` breaker.
- Failed Jupiter probe returns the offline curve instead of a false breaker.
- Browser console: no warnings or errors in the three-step flow.

## Critical known limitation

The `$3,982,378 → $0` result is a synthetic, in-sample stress replay—not historical or predictive validation. `src/backtest/engine.mjs` declares `maturityHours` and `LIQ_LAG_HOURS` but does not apply them, and the price-gap scenarios currently shock individual hourly points. Do not describe the harness as modeling 96-hour repayment or 1h/16h liquidation delays until those mechanics are implemented, tested, recalibrated, and the pitch number is re-baselined.

The stage UI and `DEMO_RUNBOOK.md` disclose this limitation. Do not silently “fix” the engine immediately before the pitch while retaining the old `$3.98M` claim.
