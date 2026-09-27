# RWA Shield — Executable Collateral Value (ECV)

**Oracle price is not cash.** RWA Shield computes **Executable Collateral Value (ECV)**: the USDC a lending venue can actually recover from a tokenized-stock collateral position under stress, instead of the oracle mark.

- Landing page: https://dorianos85.github.io/rwa-shield/
- Risk Lab (recorded snapshot, static): https://dorianos85.github.io/rwa-shield/risk/
- X: [@RWASHIELDPL](https://x.com/RWASHIELDPL) · Pitch deck: [`docs/deck/RWA-Shield-Pitch-Deck.pdf`](docs/deck/RWA-Shield-Pitch-Deck.pdf)

## Status (honest labels)

| Piece | State |
|---|---|
| ECV engine (`src/ecv/`) | Off-chain, open source, Node 20+, **zero npm dependencies**. Prototype. |
| Anchor program `ecv_oracle` (`onchain/`) | Deployed on **Solana devnet** on 26.09.2026. Program ID [`5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc`](https://explorer.solana.com/address/5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc?cluster=devnet). Publishes ECV outputs; does not enforce them. One record posted so far (26.09.2026, single-authority signer, synthetic route). **Not on mainnet. Not audited.** |
| Kamino × xStocks Risk Lab (`/risk`) | Runs locally against live or offline data; the public copy in `docs/risk/` is a **recorded snapshot** (Kamino API, 27.09.2026 13:50 Warsaw) with a **synthetic** AMM depth curve. Not a lending signal. |
| Backtest (`src/backtest/`) | **Synthetic, in-sample** (generated price series; parameters fitted on the same series). Not historical validation. |
| Business | No customers, no revenue, no partnerships. |

## How ECV works

```
ECV = P_oracle × q × D(q) × S(q) × M(t) × V(σ)          B = breaker (gates new credit)
```

`D` = routable depth for this size, `S` = slippage / price impact, `M` = market-session buffer, `V` = volatility buffer. Every term is a factor in (0, 1].

The engine returns five outputs (a frozen contract, see `AGENTS.md`):

| Output | Meaning |
|---|---|
| `max_borrow` | Maximum new USDC borrow against the position (0 when the breaker is on) |
| `collateral_cap` | Cap on how much of this collateral a venue should accept |
| `liquidation_route` | The execution route the value is based on |
| `risk_premium` | Rate premium rising with slippage, session and volatility risk |
| `borrow_disabled` | Breaker: stale price, depth below floor, or extreme impact |

Two modelling decisions:

1. **The breaker gates new credit, not the value of existing collateral.** Marking open positions to zero on a stale feed would liquidate the whole book — exactly the cascade we want to prevent. `borrow_disabled = true`, but `executableValue` stays.
2. **Health factor is measured against executable value, not ECV.** The session haircut protects the pool when credit is *granted*; applying it to the mark would liquidate healthy positions every Friday evening.

## Quickstart (Node 20+, no `npm install`)

```bash
npm test                      # full unit/integration suite (node --test)
npm run dev                   # = node src/api/server.mjs → http://localhost:8787
                              #   /      legacy ECV demo
                              #   /risk  Kamino × xStocks Risk Lab
npm run backtest              # six synthetic stress scenarios (uses data/params.fitted.json)
PARAMS_MODE=priors npm run backtest   # same, with unfitted default parameters
npm run calibrate             # re-fits parameters, rewrites data/params.fitted.json
node scripts/export-static.mjs        # rebuilds docs/risk/ from data/kamino.snapshot.json
```

Offline Risk Lab (no network): `http://localhost:8787/risk?offline=1&execution=synthetic&mode=sandbox`.
Live Jupiter quotes are rate limited; set `JUP_API_KEY` for a keyed endpoint. See [`docs/KAMINO_RISK_LAB.md`](docs/KAMINO_RISK_LAB.md) and [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md).

On-chain (Rust/Anchor, separate Cargo workspace): see [`onchain/README.md`](onchain/README.md) — `anchor build`, `cargo test --workspace`, and the Rust poster that posts an ECV record (`--every-sec` for scheduled re-posts).

## Backtest — synthetic, in-sample

110 days of **generated** hourly prices (2,640 points) with weekend gaps; positions opened every 7 h; liquidation delay depends on the session (1 h in session, 16 h over a weekend). Benchmark: fixed 70% LTV on the oracle price.

| Scenario | Bad debt, fixed 70% LTV | Bad debt, ECV | ECV credit vs fixed |
|---|---|---|---|
| Calm base market | $0 | $0 | 99.6% |
| Weekend gap −14% | $0 | $0 | 22.3% |
| **Tail: −22% weekend gap + thin book** | **$3,982,378** | **$0** | 0% (369 loans refused) |
| Liquidity crunch (−70% depth) | $297,220 | $0 | 0% |
| Single-stock gap −18% (earnings) | $0 | $0 | 20.0% |
| Volatility spike (earnings) | $0 | $0 | 22.3% |

These numbers come from `npm run backtest` with the committed `data/params.fitted.json` (reproduce it with `npm run calibrate`, then `npm run backtest`). With unfitted defaults (`PARAMS_MODE=priors`) the tail row is **$5,336,023 vs $0**. The fixed-LTV book's liquidation proceeds are priced with the same execution model, so its bad debt also depends on the parameter set.

Reading: in a calm market ECV lends almost as much as fixed LTV; the cost of safety shows up under stress, as refused credit rather than pool losses.

## Known limitations

1. **Backtest data is synthetic** (`src/data/prices.mjs`). A real series can be dropped in as `data/prices.SPYx.json` (`[{t: ms, p: number}]`).
2. **The calibrator removes our favourite term.** On this series the fit sets `session.weekend = 1.0` and `volSlope = 0`: the data does not justify a weekend haircut; depth, slippage and the breaker do the work. We show this rather than hide it.
3. **Stress scenarios apply for the whole window**, so "credit vs fixed" in those rows is an upper bound on cost, not a realistic average.
4. **Risk Lab NAV is a proxy** (Kamino oracle price); no independent issuer NAV feed is configured. Average health factor is a user assumption, not measured account health.
5. **On-chain trust model is a PoC**: one authority key can write any record; no multisig, no on-chain Jupiter verification. The only devnet record so far was posted under the TSLAx mint by mistake (PDA `54jQEa…wMRw`) with a synthetic route.

## Repository map

| Path | Purpose |
|---|---|
| `src/ecv/` | ECV model (pure functions) and parameters with bounds |
| `src/risk/` | Kamino risk-lab model (four independent stress axes) |
| `src/data/` | Adapters: Kamino, Jupiter, liquidity ladder, xStocks, session, volatility, prices — all with offline fallbacks |
| `src/backtest/` | Synthetic backtest harness and scenarios |
| `src/agents/` | Calibrator, adversary, monitor, swarm |
| `src/api/` | Zero-dependency HTTP server + risk routes |
| `web/` | Local UI: legacy demo (`index.html`) and Risk Lab (`risk.*`) |
| `data/` | `kamino.snapshot.json` (recorded 27.09.2026 11:50 UTC), `params.fitted.json` |
| `onchain/` | Anchor workspace: `ecv_oracle` program + Rust poster |
| `scripts/export-static.mjs` | Builds the static snapshot Risk Lab into `docs/risk/` |
| `docs/` | GitHub Pages root: landing (`index.html`), `risk/`, `deck/`, Kamino docs |

## Team

- Dorian Żaczek — CEO, Founder & Product Manager
- Mieszko Manijak — CTO & DeFi Architect Engineer
- Julita Szaruta — Legal, Tax & Regulatory Lead
- Adam Książkiewicz — Rust / Anchor (investiatech)
- Adam Kwak — Advisor

Hackathons: Blockchain Hack Kraków and Blockchain Hack Warsaw (Superteam Poland, September 2026); Colosseum (October 2026).

## License

MIT — see [`LICENSE`](LICENSE).
