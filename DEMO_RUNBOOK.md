# RWA Shield — 60-second live demo runbook

## Launch

```powershell
node src/api/server.mjs
```

Open this exact local URL:

```text
http://localhost:8787/?present=1&params=fitted&symbol=SPYx&notional=100000&session=regular&depth=400000&step=0
```

Press `P` for presentation/fullscreen, then use only `Right Arrow` twice.

- `Home`: reset to the regular-session baseline
- `Left Arrow` / `Right Arrow`: previous / next step
- `F`: switch priors / fitted parameters
- `Esc`: exit presentation mode

Do not use **Probe Jupiter route** in the core pitch. The deterministic curve is deliberate and labeled. If a live Jupiter probe fails, the API returns to the offline curve rather than turning a network failure into a false market breaker.

## 60-second talk track

### 1 — Oracle price → executable cash (0–20s)

> An oracle tells us the quoted price. It does not tell a lending pool what liquidation returns. For this $100,000 SPYx position, route impact leaves $98,800 executable now. The fitted policy can offer $77,322 of new credit because measured execution is healthy.

Press `Right Arrow`.

### 2 — Weekend + thin book (20–40s)

> Now the position is $250,000 against a thinner weekend book. Expected impact is 9.05%, above the 5% breaker threshold. Existing collateral still marks at $219,375, but new borrowing becomes zero. The fit removed our weekend haircut—liquidity and the breaker did the work.

Press `Right Arrow`.

### 3 — Synthetic stress replay (40–60s)

> On the base scenario, ECV preserves 100% of fixed-model credit. In this synthetic persistent-tail replay, fixed 70% LTV produces $3.98 million of bad debt. ECV records zero by refusing all 369 new loans in that regime. This is an in-sample stress harness, not historical or predictive performance.

## Preflight

```powershell
node --test src/ecv/*.test.mjs
node src/backtest/run.mjs
```

Then hard-refresh the launch URL and rehearse `Home`, `Right Arrow`, `Right Arrow`, `Left Arrow` without a mouse.

Expected stage anchors with fitted parameters:

| Screen | Visible anchor |
|---|---|
| Baseline | `$100,000` oracle · `$98,800` executable · `$77,322` max borrow · gate `OPEN` |
| Stress | `9.05%` impact · `$219,375` executable · `$0` max borrow · gate `CLOSED` |
| Replay | base credit `100%` · tail `$3,982,378 → $0` · `369 refusals / 0% credit` |

## Do not claim on stage

- Do not call the price feed or route live unless the badge says `LIVE · JUPITER`.
- Do not call the scenario replay historical validation; the price series is synthetic and calibration is in-sample.
- Do not say the current harness applies the documented 96-hour maturity or 1h/16h liquidation delays. Those variables exist in `src/backtest/engine.mjs` but are not yet applied by the engine.
- Do not present `$3.98M` as expected loss. It is the result of the current persistent-tail scenario and underwriting comparison.
