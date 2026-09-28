# RWA Shield — Roadmap

This roadmap lists only milestones that already appear as planned in the project sources (repo, Warsaw deck v11, stage cue card). Undated items have no date in the sources, and none is invented here. Current status: prototype. The ECV engine and demos run locally, and the `ecv_oracle` program is deployed on Solana devnet.

## Done

| Milestone | Date | Source |
|---|---|---|
| ECV engine, synthetic backtest, agents (calibrator, adversary, monitor, swarm), keyboard demo | 19.09.2026 | git history (`986e749`, `dcc7cb1`), `GROK_HANDOFF.md` |
| Blockchain Hack Kraków pitch | 20.09.2026 | `GROK_HANDOFF.md`, deck CHANGELOG |
| PR #1: xStocks mint corrections, Yahoo SPY **proxy** series, Jupiter price age, depth cache (open, not merged) | 22.09.2026 | PR #1 |
| Stocklana submission | by 25.09.2026 (deadline) | `rwa-competition/sources.md` (ST1) |
| `ecv_oracle` Anchor program (`initialize`, `post_ecv`, LiteSVM tests) + Rust poster | 25–26.09.2026 | git history, `onchain/README.md` |
| Program deployed on Solana devnet (`5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc`) | 26.09.2026 | `onchain/README.md`, deck S6 |
| Last ECV record posted on devnet | 26.09.2026, 19:55 (Warsaw) | deck S6 |
| Periodic poster `--every-sec`; PR #2 merged into `main` | 27.09.2026 | git history |
| PR #3: Kamino × xStocks `/risk` dashboard (recorded snapshot, Jupiter quote ladder, stress sandbox), with @RWASHIELDPL branding added in a later commit; 78/78 tests reported (open, not merged) | 27.09.2026 | PR #3, `docs/KAMINO_QA.md`, `docs/BRAND.md` |
| PR #4: SPYx mint fix in poster, `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` (open, not merged) | 27.09.2026 | PR #4 |
| Warsaw pitch | 27.09.2026 | deck S1 |

## Dated

| Milestone | Date | Source |
|---|---|---|
| **Colosseum submission** | **12.10.2026 23:59 PT** (13.10.2026 08:59 Warsaw) | `rwa-competition/sources.md` (CO1, CO2) |

## Planned, undated

### Product / on-chain (deck S6 "NEXT" and S10)

- Fix the xStocks mint mapping on-chain (PR #4; the QQQx mint in the poster still needs the same fix per PR #4) and re-post the SPYx record to its new PDA.
- A vault plus a borrow gate that reads the devnet ECV record (deck S10 lists it under "next 14 days", with no calendar date).
- Verifiable inputs.
- Multi-signer posting.
- Commit fixtures (`data/params.fitted.json`) so a fresh clone reproduces the deck numbers. The cue card says this is planned "before Colosseum" (`STAGE_CUE_CARD-WARSAW-v11.md`).

### Open engineering items shown in the repo as not done

- **Walk-forward backtest:** calibrate on the first 60% of the series and evaluate on the remaining 40%; report the median and 95th-percentile loss per position; add a USDC depeg scenario; export `data/backtest.json` (`tasks/C-backtest.md`).
- **Apply maturity and liquidation lag** in the backtest engine. `maturityHours` and `LIQ_LAG_HOURS` are declared but not applied (`GROK_HANDOFF.md`).
- **Calibrator upgrade:** random search plus local refine, with a trace in `data/calibration.trace.json` (`tasks/D-agenci.md`).
- **Reporter agent** `src/agents/reporter.mjs`; adversary output to `data/adversary.json`; monitor `--once --json` mode (`tasks/D-agenci.md`).
- **`C(q)` concentration term and `explain(input, params)`** for per-term reasons in the UI; monotonicity tests and the `max_borrow <= executableValue` invariant (`tasks/A-model.md`).
- **Real data:** merge or supersede PR #1 (mints, price age, depth cache). The Yahoo SPY series is a proxy, not SPYx (`tasks/B-dane.md`, PR #1).
- **Named fields in the explorer:** `anchor idl init`, which needs the program upgrade authority (`onchain/README.md`).

### Team (deck S10)

- Hire Rust/Anchor and frontend engineers.
- Get intros to lending venues that hold xStocks collateral.

## Long-term goal (undated)

- **Mainnet deployment, only after an external audit.** No date is set in any source.

---

See [WHITEPAPER.md](WHITEPAPER.md) for details and [MINDMAP.md](MINDMAP.md) for a one-page map.
