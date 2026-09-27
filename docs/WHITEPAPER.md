# RWA Shield — Whitepaper

**Executable Collateral Value (ECV) for lending against tokenized equities on Solana**

Status: prototype. The ECV engine and demos run locally. The `ecv_oracle` Anchor program is deployed on Solana **devnet**. Numbers in this document come from the repository or the Warsaw deck (v11); each one lists its source. Backtest results are **synthetic and in-sample**. They are not historical validation and not a forecast.

> One-liner (deck S1): *Oracle price is not cash. We price recoverable collateral.*

---

## 1. Problem

A lending venue that accepts a tokenized stock (for example an xStock such as SPYx) as collateral usually values it as `oracle price × fixed LTV`. The oracle tells the venue the quoted price. It does not tell the venue how much USDC a forced liquidation of *this position* would actually return. That amount depends on DEX depth for the position's size, on whether the underlying market (NYSE) is open, and on volatility. When the book is thin or the underlying market is closed, a liquidation can recover much less than the mark. The gap becomes bad debt for the pool.

Market context shown on deck slide S2 (press figures, **not audited**):

| Figure | Deck wording | Source cited on the deck |
|---|---|---|
| $200M+ | Tokenized-equity trading volume on Solana in one day (12.09.2026) | Solana Compass 13.09.2026 (Solana Foundation newsletter) |
| $53M | Tokenized-stock lending TVL on Solana, all-time high (late Jul 2026) | Crypto Briefing + Solana Compass 11.08.2026 |
| ~63% | Of cumulative trading through Aug 2026, settled outside US market hours | Crypto Briefing + Solana Compass 11.08.2026 |

First user (deck S2): a Solana lending venue or vault that integrates xStocks, not retail.

## 2. ECV — Executable Collateral Value

ECV is the USDC we believe a forced liquidation of a position would return under current liquidity, session and volatility conditions. It is a pure, deterministic function with no I/O (`src/ecv/model.mjs`); its parameters and their calibration bounds are in `src/ecv/params.mjs`.

```
executableValue = qty × P × D(q) × S(q)
ECV             = executableValue × M(t) × V(σ)
B               = breaker (gates NEW borrowing only)
```

### 2.1 Terms (from `src/ecv/model.mjs`, default priors from `src/ecv/params.mjs`)

| Term | What it measures | How it is computed (defaults) |
|---|---|---|
| **P** price | Blended reference price | `spot × (1 − twapWeight) + twap × twapWeight`, `twapWeight = 0.35` |
| **D(q)** depth | Share of the position that is routable | `min(routableUsd, notional) / notional`, clamped to [0, 1] |
| **S(q)** slippage | Price impact for this size | `1 − impact`; if impact > `maxImpactPct` (2.5%), the curve is treated as unreliable and the term is set to `(1 − 2.5%) × 0.9` instead of extrapolating |
| **M(t)** session | State of the underlying market | regular 1.00, afterHours 0.93, weekend 0.85, holiday 0.85 (NYSE session in UTC, `src/data/session.mjs`) |
| **V(σ)** volatility | Excess realized volatility | `clamp(1 − volSlope × max(0, σ − 0.18), 0.70, 1)`, `volSlope = 0.9`, 14-day window |
| **B** breaker | Hard stop for new credit | trips on `stale_price` (price age > 30 s), `depth_floor` (routable < $25,000) or `impact_extreme` (impact > 2 × `maxImpactPct` = 5%) |

### 2.2 The five frozen outputs

`computeEcv()` returns exactly five outputs (plus `breaker_reason`). Their shape is a frozen contract with the rest of the system (`AGENTS.md` rule 1, `README.md`), and they are the interface that the on-chain program publishes.

| Output | Definition in code |
|---|---|
| `max_borrow` | `0` if the breaker is tripped, otherwise `ECV × safetyFactor / targetHealth` (defaults 0.80 / 1.15) |
| `collateral_cap` | `ECV × 3` |
| `liquidation_route` | Route label from the router (default `jupiter:best`; offline fallback labels such as `offline:synthetic-curve`) |
| `risk_premium` | `riskPremiumBase + riskPremiumSlope × (1 − S·M·V)` = `0.02 + 0.35 × riskLevel` |
| `borrow_disabled` | `true` when the breaker is tripped; `breaker_reason` ∈ {`null`, `stale_price`, `depth_floor`, `impact_extreme`} |

### 2.3 Two design decisions

1. **The breaker gates new credit, not the valuation of existing collateral.** If a stale feed marked open positions at zero, every oracle outage would liquidate the whole book, which is the cascade ECV is meant to prevent. `borrow_disabled = true`, but `executableValue` is kept (`src/ecv/model.mjs`, `README.md`).
2. **Health factor is measured against executable value, not ECV.** `healthFactor = executableValue × safetyFactor / debt`. The session and volatility haircuts protect the pool at origination. If they entered the mark, healthy positions would be liquidated every Friday evening. Recovery on liquidation is `executableValue × (1 − 5%)` (liquidator bonus).

### 2.4 Calibration and agents

- **Calibrator** (`src/agents/calibrator.mjs`): coordinate descent over the declared bounds in `PARAM_BOUNDS` (six parameters), scored on all stress scenarios. Objective (`src/agents/objective.mjs`): minimise lost credit subject to bad debt ≤ 5 bps of what the fixed-LTV venue lent. It is parameter fitting, not a neural network. It writes `data/params.fitted.json`.
- **Adversary** (`src/agents/adversary.mjs`): sweeps gap size, depth collapse and liquidation lag for the cheapest combination that produces bad debt.
- **Monitor** (`src/agents/monitor.mjs`): polls depth and price, recomputes ECV and alerts when a term changes a lending decision.
- **Swarm** (`src/agents/swarm.mjs`): runs calibrator → backtest → adversary and writes `data/report.json`.

Stated openly in `README.md`: on the synthetic series the calibrator sets `session.weekend = 1.0` and `volSlope = 0`. In other words, the data does not justify the weekend haircut; protection comes from depth, slippage and the breaker.

### 2.5 Legacy ECV breaker demo (`/`)

`node src/api/server.mjs` serves the three-step keyboard demo (`DEMO_RUNBOOK.md`). It uses a deterministic, labeled offline curve. With fitted parameters (`DEMO_RUNBOOK.md`, `GROK_HANDOFF.md`):

| Screen | Anchors |
|---|---|
| Baseline | $100,000 oracle · $98,800 executable · $77,322 max borrow · gate OPEN |
| Stress (weekend, thin book, $250,000) | 9.05% impact (above the 5% breaker threshold) · $219,375 executable mark · $0 max new borrow · `impact_extreme` · gate CLOSED |

A fresh clone without `data/params.fitted.json` runs on priors and gives different numbers; the Warsaw cue card lists $68,730 max borrow for that case (`STAGE_CUE_CARD-WARSAW-v11.md`).

## 3. Backtest — synthetic, in-sample

`src/backtest/engine.mjs` prices the same loan book two ways: (A) fixed 70% LTV on the oracle price and (B) ECV. Positions are opened on a schedule (every 7 hours, $100,000 each, $400,000 depth), marked hourly and liquidated when the health factor breaks. `src/backtest/scenarios.mjs` defines six scenarios: base, weekend gap −14%, weekend tail (−22% Saturday gap + thin book), depth collapse (−70%), single-stock earnings gap −18%, and a volatility spike.

**Labels that always apply:**

- The price series is **synthetic** (`src/data/prices.mjs`, 24 × 110 hourly points with weekend gaps; `README.md` "110 days of hourly data").
- Calibration is **in-sample**. There is no walk-forward or out-of-sample test yet (`tasks/C-backtest.md`).
- `maturityHours` (96) and the 1h/16h liquidation lags are **declared but not applied** by the engine (`GROK_HANDOFF.md`, `DEMO_RUNBOOK.md`).
- Stress scenarios run through the whole window, so "credit vs fixed" in those rows is an upper bound on cost, not a realistic average (`README.md`).

Results with fitted parameters (`README.md` table; `DEMO_RUNBOOK.md`; deck S5):

| Scenario | Bad debt, fixed 70% LTV | Bad debt, ECV | ECV credit vs fixed |
|---|---|---|---|
| Base market | $0 | $0 | 100% |
| Weekend gap −14% | $0 | $0 | 22% |
| **Tail: −22% weekend gap + thin book** | **$3,982,378** | **$0** | 0% |
| Liquidity collapse −70% | $297,220 | $0 | 0% |
| Single-stock gap −18% (earnings) | $0 | $0 | 20% |

- In the tail scenario ECV refuses all **369** new loans; that is how its bad debt stays at $0 (deck S5, `DEMO_RUNBOOK.md`).
- Trade-off: in the calm base scenario ECV lends ≈ 100% of fixed-LTV credit (the base run shows a 0.4% difference, `README.md`). Pooled across all six synthetic scenarios, base included, it lends ≈ 27% (deck S5; 27.1% in `rwa-competition/SHORT_WARSAW.md`).
- The $3.98M figure depends on fitted parameters. With default priors (no `data/params.fitted.json`) the tail scenario gives $5,336,023 for fixed LTV vs $0 for ECV (`rwa-competition/SHORT_WARSAW.md`, `STAGE_CUE_CARD-WARSAW-v11.md`).
- $3.98M is the result of this persistent-tail scenario and underwriting comparison. It is **not** an expected loss (`DEMO_RUNBOOK.md`).

**Yahoo SPY proxy (PR #1, unmerged).** Branch `kod/task-b-real-data` adds `data/prices.SPYx.json`: about 1,089 hourly points (~92 days) of the **Yahoo Finance SPY ETF**, fetched 22.09.2026. It is a **proxy**, not on-chain SPYx prices (`data/prices.SPYx.SOURCE.txt` on that branch). PR #3's review found 193 non-hourly gaps in it and did not use it as hourly token history (`docs/KAMINO_RISK_LAB.md` on `feat/rwa-shield-kamino-risk-dashboard`). No backtest result from this series is claimed here.

## 4. Kamino × xStocks risk dashboard (`/risk`, PR #3)

Branch `feat/rwa-shield-kamino-risk-dashboard` (PR #3, open, not merged) adds an interactive Risk Lab under `/risk`. It compares Kamino's collateral parameters for an xStock, and the utilization of the USDC reserve in the same market, with the executable recovery of a test position. The legacy demo stays at `/`. `src/ecv/model.mjs` and the five outputs are unchanged.

- **Recorded Kamino snapshot.** `data/kamino.snapshot.json` stores real responses from Kamino's public API, captured 27.09.2026 11:50:33 UTC (13:50 Warsaw). It covers the xStocks Market (SPYx, QQQx, NVDAx, TSLAx, CRCLx) and the Sentora xStocks Market (SPYx, QQQx, NVDAx). LTV, liquidation threshold, caps, rate curve, mint and reserve address carry provenance. Fields that cannot be verified stay `null` with a reason (`docs/KAMINO_DATA_SOURCES.md`).
- **Jupiter quote ladder.** Exact-in USDC sell quotes for the xStock at a ladder of notionals, with mint/unit validation. A confirmed no-route keeps zero or partial measured depth. On timeout or error the last real measurement is kept with its timestamp; the synthetic curve is used only when selected explicitly (`docs/KAMINO_DATA_SOURCES.md`). For the Warsaw demo the ladder was last measured at 16:17 Warsaw and cached after a rate limit (deck S4/S7 notes).
- **Four stress axes.** Utilization, NAV, AMM liquidity and average health factor. The reserve TVL is held fixed. The NAV reference is an explicit **Kamino oracle proxy**, not an independent issuer NAV. Average HF is an abstract book parameter, not a measurement of user accounts.
- **Stress sandbox.** An explicit experiment mode that assumes a fresh price while keeping real provenance. Its SAFE/WARNING/CRITICAL statuses are prefixed MODELED and labeled **NOT A CURRENT LENDING SIGNAL**. Current/replay modes close the borrow gate on stale or unverified data.
- **NAV × AMM map.** 864 sampled scenarios computed by the same engine (`docs/KAMINO_RISK_LAB.md`).
- **Tests (PR #3 body).** `node --test src/**/*.test.mjs`: 59/59 pass; backtest passes with six scenarios.

Warsaw stage example (deck S4, recorded snapshot + stress sandbox): TSLAx, $100k, weekend. Price $372.08 (Kamino Scope proxy) · ECV $84,358 · haircut ~15.6% · safe max borrow $58,684 vs Kamino LTV $55,000 → **WARNING**. These are model outputs in sandbox mode, not a lending signal.

## 5. On-chain: `ecv_oracle` on Solana devnet

The Anchor program **only publishes** the five ECV outputs plus `breaker_reason` into one PDA per mint (`onchain/README.md`). It does not compute ECV, because the inputs (Jupiter impact, NYSE session, volatility) are computed off-chain. It does not enforce the breaker either: there is no `check_borrow`, no vault and no CPI. A consumer reads the PDA and applies `max_staleness_sec` against `posted_at` itself.

| Item | Value (`onchain/README.md`) |
|---|---|
| Program `ecv_oracle` (devnet) | `5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc` |
| `Config` PDA `["config"]` | `Dty68hZxpsTbGySXyNa9uPXCqCoTKwYHMQ4ZANPQskZK` |
| Deploy | investiatech, slot 504332522, 157,008 bytes |
| Explorer | https://explorer.solana.com/address/5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc?cluster=devnet |

- **Accounts.** `Config` holds `authority` (the only signer allowed to call `post_ecv`), `max_staleness_sec` (30, published, not enforced) and `bump`. `EcvRecord`, seeded `["ecv", mint]`, holds `max_borrow` and `collateral_cap` as `u64` USDC ×1e6, `risk_premium_bps` as `u16`, `borrow_disabled`, `breaker_reason` as `u8` (constants `BREAKER_*` in the IDL), `liquidation_route` as `[u8; 32]`, and `posted_at`/`posted_slot`, which the program stamps from `Clock`, not from arguments.
- **Instructions.** `initialize(max_staleness_sec)` and `post_ecv(mint, …outputs)`. The only error is `Unauthorized` (6000).
- **Rust poster** (`onchain/poster`). It calls `GET /api/ecv` on the demo server, encodes the outputs (`poster/src/encode.rs`, round-trip tests with a fixture captured from the API), sends `post_ecv` and verifies the decoded record. `--every-sec N` re-posts on a schedule; N must be shorter than `max_staleness_sec`. `--dry-run` encodes without sending.
- **Trust model (PoC).** A single authority key can write any numbers. There is no multi-sig, no Pyth and no on-chain verification of Jupiter.
- **Last record posted: 26.09.2026, 19:55 (Warsaw)** (deck S6). A devnet RPC read on 27.09.2026 decoded one post at 19:55:12 Warsaw, slot 504492381: `max_borrow` 68,730.43 USDC · `collateral_cap` 296,400 USDC · 242 bps · `borrow_disabled = false` · route `offline:synthetic-curve` (`rwa-competition/notes/devnet_record_decoded.txt`, `rwa-competition/SHORT_WARSAW.md`). The "Stan (2026-09-26)" section of `onchain/README.md`, which says the accounts do not exist yet, was written before that post.
- **Mint mapping bug.** The record above was posted under the mint key `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB`, which the code labelled SPYx but is actually TSLAx (PR #1, PR #4, deck S6 notes).

### PR #4 — SPYx mint fix in the poster

Branch `kod/spyx-mint-poster` (PR #4, open, not merged) changes `MINTS.SPYx` in `onchain/poster/src/main.rs` and `src/data/jupiter.mjs` to **`XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`**. Because the record PDA is seeded by the mint, the SPYx record moves to a new account, `Hv6EyQr8q3K7TdNzehFH8tn1j1JBU8SdY37Npgys1Yf`. It is created on the first `post_ecv` via `init_if_needed`, and `Config`/authority are unchanged. PR #4 notes that the poster's QQQx mint still needs the same fix. Per the deck changelog (verified 27.09.2026 16:32 Warsaw), the new SPYx PDA had no signatures yet.

## 6. Why Solana (deck S7)

xStocks already trade on Solana, and Jupiter routes are the liquidation path ECV quotes. The demo uses a real Jupiter quote ladder and a recorded Kamino snapshot in stress sandbox mode. The aim is composable ECV risk quotes for those venues. Publishing a record pays the Solana base fee of 5,000 lamports per signature (deck S7 notes, citing solana.com/docs/core/fees).

## 7. Monetization — hypothesis, not ARR (deck S8)

| Stream | Deck wording |
|---|---|
| Risk API / SDK | ECV quotes & breakers for lending venues |
| Share of risk premium | When ECV sits in the borrow path |
| Optional vault fees | If we operate a reference vault |

There is no revenue and there are no customers or LOIs (cue card: "Monetization is a hypothesis — no revenue, no LOIs").

## 8. Hackathon track record

| Event | Date | Source |
|---|---|---|
| Blockchain Hack Kraków (pitch) | 20.09.2026 | `GROK_HANDOFF.md`; deck CHANGELOG ("Kraków 20.09") |
| Stocklana (submission) | submitted by the 25.09.2026 deadline | deadline: `rwa-competition/sources.md` (ST1) |
| Warsaw pitch | 27.09.2026 | deck S1 |
| Colosseum (Crypto World's Fair hackathon) | deadline 12.10.2026 23:59 PT (13.10.2026 08:59 Warsaw) | `rwa-competition/sources.md` (CO1, CO2) |

## 9. Team (deck S9)

| Name | Role |
|---|---|
| Dorian Żaczek | CEO, Founder & Product Manager |
| Mieszko Manijak | CTO & DeFi Architect Engineer (Anchor + Rust poster) |
| Julita Szaruta | Legal, Tax & Regulatory Lead |
| Adam Książkiewicz (investiatech) | Rust, devnet deploy, quant |
| Adam Kwak | Advisor |

## 10. Compliance note

> xStocks issuer: Backed Assets (JE) Limited, Jersey; RWA Shield holds no assets, gives no advice, publishes risk data; checked: MiCA, MiFID II, Prospectus Regulation. **(pending legal review)**

Source: `COMPLIANCE_LINE_DRAFT.md`, version A1. It is a draft for review by Julita Szaruta, not legal advice. "Checked" means these frameworks were identified as relevant; it does not mean a legal assessment was done. RWA Shield claims no regulatory status.

## 11. Honest limitations

1. The backtest is synthetic and in-sample. Maturity and liquidation lag are not applied. There is no walk-forward.
2. The legacy demo uses a deterministic offline depth curve. The `/risk` dashboard uses a recorded Kamino snapshot, a cached Jupiter ladder and model assumptions (prior volatility, assumed health factor), not a current lending signal.
3. There is no independent issuer NAV; the reference price is a Kamino oracle proxy.
4. On-chain: a single authority signer on devnet. The program publishes but does not enforce. The only posted record uses an offline route and the wrong (TSLAx) mint key; the fix is in unmerged PR #4.
5. Deck numbers need `data/params.fitted.json`, which is not committed, so a fresh clone gives prior-based numbers.
6. There are no integrations, customers or revenue.

See [ROADMAP.md](ROADMAP.md) for next steps and [MINDMAP.md](MINDMAP.md) for a one-page map.

## Sources

- Repository `Dorianos85/rwa-shield`: `main` (merge of PR #2 `feat/g-onchain`), branches `feat/rwa-shield-kamino-risk-dashboard` (PR #3), `kod/task-b-real-data` (PR #1), `kod/spyx-mint-poster` (PR #4); `README.md`, `DEMO_RUNBOOK.md`, `GROK_HANDOFF.md`, `AGENTS.md`, `onchain/README.md`, `tasks/*.md`, `src/**`.
- Warsaw deck v11 (`RWA-SHIELD-WARSAW-v11.pptx`), `CHANGELOG.md`, `SPEAKER_SCRIPT-3MIN-v11.md`, `STAGE_CUE_CARD-WARSAW-v11.md`.
- `COMPLIANCE_LINE_DRAFT.md`.
- Competition research: `SUMMARY.md`, `SHORT_WARSAW.md`, `COMPETITION.md`, `sources.md`, `notes/devnet_record_decoded.txt`.
