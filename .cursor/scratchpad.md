# RWA Shield — on-chain ECV oracle PoC

## Background and Motivation

The repo is 100% off-chain today: `computeEcv()` in `src/ecv/model.mjs` produces five
frozen outputs (`max_borrow`, `collateral_cap`, `liquidation_route`, `risk_premium`,
`borrow_disabled`) plus `breaker_reason`, served by `src/api/server.mjs`. README names the
next step: an Anchor program consuming these outputs.

This plan covers **the oracle only**: a Solana program whose single job is to publish the
ECV outputs per token mint into a deterministic PDA, stamped by the chain's clock.
It has **no consumer logic** — no `check_borrow`, no vault, no token transfers. Lenders
(Kamino, Jupiter Lend, a future toy vault) read the PDA themselves and apply their own
staleness policy. The oracle publishes the intended TTL so they can.

ECV cannot be computed on-chain (inputs: Jupiter route impact, realized vol, NYSE session,
TWAP), so the design is an attestation pattern: off-chain poster → `post_ecv` → PDA.

### Phase 2 (2026-09-27, refined same day) — real route, real quote on chain

Phase 1 publishes `liquidation_route` as a 32-byte label: a claim, not a route. Nothing on
chain can check it, and the two execution terms of the model (`D` depth, `S` slippage) are
numbers the poster asserts. Phase 2 makes the route a first-class on-chain object — the
actual pool(s) a liquidation would trade through — validated at the moment it is written,
and gives the program the ability to compute the execution side itself: quote, slippage,
and the size at which a liquidation stops paying a liquidator.

Two consumer entry points are requested, callable by CPI and by `simulateTransaction` off
chain (Anchor return data, ≤ 1024 B):
- `simulate_buy(mint, loan_amount)` → `usdc_in` plus the execution params
- `simulate_liquidation_profitability_bound(mint, liquidation_incentive_bps)`

Session, volatility, TWAP and price staleness stay off chain — none of them is observable
from a Solana account. Phase 2 therefore splits the model along the only honest line:
execution terms measured on chain, market-state terms attested by the poster.

Scope guard: the five outputs in `src/ecv/model.mjs` are untouched (AGENTS.md rule 1) and
no file outside `onchain/*` changes (agent G row). Phase 1 tasks T8/T9 stay open and
independent.

This pass re-verified two facts that the first draft treated as research:
Kamino's incentive is in bps (with a percent protocol cut — challenge 14), and live SPYx
depth is almost entirely CLMM (challenge 11 / T11). D1–D8 are recommendations, not
answers — T10 is the confirmation gate.

## Key Challenges and Analysis

1. **Zero-deps rule (AGENTS.md rule 2) vs. a Solana client.** Sending a tx needs
   `@solana/web3.js` / `@coral-xyz/anchor`. Proposed resolution: everything on-chain lives
   under a new top-level `onchain/` dir with its own `package.json`; the zero-deps rule
   stays intact for `src/` and `web/` (the demo). Requires a one-line amendment to
   AGENTS.md. **Needs user confirmation.**
2. **Float → integer encoding.** Model emits floats (`round2`, `toFixed(4)`). Mapping:
   `max_borrow`, `collateral_cap` → `u64` USDC base units (×1e6);
   `risk_premium` → `u16` bps (×10 000); `borrow_disabled` → `bool`;
   `breaker_reason` → `u8` enum {0 none, 1 stale_price, 2 depth_floor, 3 impact_extreme};
   `liquidation_route` → free string today (`'jupiter:best'`, `'offline:synthetic-curve'`,
   `'synthetic:raydium>orca'`). Proposed: UTF-8 truncated/zero-padded `[u8; 32]`.
   Alternative: sha256 hash. **Needs user decision** (default: `[u8; 32]` label).
3. **Freshness must be stamped by the program, not the poster.** `Clock::unix_timestamp`
   and `Clock::slot` are written inside `post_ecv`. The poster cannot forge them.
4. **No magic numbers on-chain (mirrors AGENTS.md rule 4).** `max_staleness_sec` (30 in
   `params.mjs`) goes into a `Config` account set at `initialize`, published for consumers.
   The oracle itself does not enforce it.
5. **Trust model for PoC:** single `authority` keypair may post. Stated openly; multi-attester
   is out of scope.
6. **Devnet has no xStocks.** The PDA seed only needs 32 bytes; the mainnet mint pubkey from
   `src/data/jupiter.mjs` is used as the key. The program never touches the token account.
   (README item 4: those mint addresses are still unverified — independent of this plan.)
7. **Toolchain absent on this machine:** `rustc`/`cargo` present (1.96), `solana` CLI and
   `anchor` missing. `investiatech` is the designated Rust/Anchor collaborator per AGENTS.md.
8. **File ownership.** No agent row covers `onchain/*`. Add row G to the AGENTS.md table.
   `src/ecv/*` is never touched by this plan.

### Phase 2 challenges (2026-09-27)

9. **Solana has no read-only view calls.** The only mechanism is an ordinary instruction that
   mutates nothing and writes `set_return_data` (Anchor: a non-`()` return type, which lands in
   the IDL as `returns` and generates `ecv_oracle::cpi::simulate_buy(...) -> Result<Return<T>>`
   for consumers). Limits that follow: return payload ≤ 1024 bytes, the result is only readable
   by the *immediate* caller, and off-chain readers must use `simulateTransaction` (a real tx
   would pay fees for a computation with no effect). The instruction needs no signer.
10. **A quote needs the pool accounts, and the caller must supply them.** The program cannot
    load accounts by pubkey; every account it reads must be in the instruction. So both views
    take the route's pool accounts as `remaining_accounts` in a documented order, and verify
    each one equals the pubkey stored in `RouteRecord`. A CPI consumer (a lender) must
    therefore read `RouteRecord` first to build its account list — which is fine, it already
    reads `EcvRecord`. This is the main ergonomic cost of moving quoting on chain and it is
    unavoidable.
11. **Which AMM math — venue evidence 2026-09-27.** Constant-product (Raydium CP-Swap) is
    ~150 lines of exact u128 math over two vault balances plus a fee. Concentrated liquidity
    (Orca Whirlpool, Raydium CLMM, Meteora DLMM) needs sqrt-price math *and* tick-array
    traversal to be correct; skipping the tick arrays and assuming constant `liquidity`
    **overestimates** depth, which is the wrong direction for a risk system and worse than
    the current honest label. Live SPYx books (DexPaprika / Solana Compass, 2026-09-27) are
    almost entirely CLMM: Raydium CLMM SPYx/USDC pools in the $80k–$2.4M range, Orca
    Whirlpools around $15k–$200k, Meteora DLMM thin, Raydium CPMM SPYx/USDC only ~$6–7k.
    A CPMM-only oracle would therefore quote a pool a real liquidation would not use.
    CPMM-first remains the cheapest way to make route storage, validation, the CPI view and
    the binary search all real — but it is a scaffold, and T11 may kill it if no usable
    CPMM pool exists for the mint we actually key on. See D2.
12. **Devnet has no pools, and we cannot deploy.** Route validation reads live pool accounts,
    so it cannot succeed on devnet. Development and tests therefore run on LiteSVM with real
    mainnet pool accounts committed as fixtures, plus `solana-test-validator --clone <pool>
    --url mainnet-beta` for manual runs. Separately, the devnet program `5nsd…` has upgrade
    authority `DtmWopz…` (investiatech), not our key — Phase 2 cannot be deployed to devnet
    from this machine at all. See D7.
13. **Layout changes.** `EcvRecord` layout is a frozen contract with the encoder and with the
    record already on chain, so the route goes in a **new `RouteRecord` PDA** `["route", mint]`
    rather than into `EcvRecord`; it also has a completely different write cadence (a route
    changes rarely, ECV posts every ~15 s). `Config` is a different story: no `Config` account
    exists on any cluster yet (see T8 notes), so extending it now is free. Both layout tests
    must be updated deliberately, not incidentally. See D4.
14. **Kamino incentive units — verified 2026-09-27, the answer is bps, with a caveat.**
    `klend`'s `ReserveConfig` stores `min_liquidation_bonus_bps: u16`,
    `max_liquidation_bonus_bps: u16`, `bad_debt_liquidation_bonus_bps: u16` — so a bps argument
    is right. But the effective bonus is not one field: `calculate_liquidation_bonus()`
    interpolates between min and max by how far the obligation's LTV exceeds its liquidation
    threshold, capped near insolvency by the bad-debt bonus. And the protocol's cut is in
    **percent**, not bps: `protocol_liquidation_fee_pct: u8`, charged on the bonus portion only
    — `bonus = amount_liquidated - amount_liquidated / (1 + b)`,
    `protocol_fee = ceil(bonus * pct / 100)`, floor of 1 token unit. The liquidator's net
    multiplier is therefore `1 + b * (1 - pct/100)`, i.e. net incentive `b_net = b * (1 - pct/100)`.
    Consequence for the requested API: a single `liquidation_incentive_bps` argument is only
    correct if the caller has already netted the protocol fee. See D3.
    Note the unit clash on our side: `params.mjs` has `liquidationBonusPct: 5` (percent), so the
    poster must convert; the param itself stays off chain.
    Sources: `Kamino-Finance/klend` `programs/klend/src/state/reserve.rs`,
    `state/liquidation_operations.rs` (`calculate_liquidation_bonus`,
    `calculate_protocol_liquidation_fee`).
15. **The profitability bound, derived.** A liquidator repays `repay` USDC of debt and receives
    collateral worth `repay * (1 + b_net)` valued at the lender's oracle price `P_oracle`, i.e.
    `q = repay * (1 + b_net) / P_oracle` tokens. It then sells `q` through the route for
    `usdc_out(q)`. The trade pays iff `usdc_out(q) ≥ repay`, which rearranges to
    `exec_price(q) / P_oracle ≥ 1 / (1 + b_net)`; when `P_oracle` equals the pool mid this is
    exactly `impact(q) ≤ b_net / (1 + b_net)`. `usdc_out` is monotone decreasing in average
    price, so the bound is found by binary search over `repay` (~24 iterations of integer math).
    The bound needs `P_oracle` as an input (pass 0 to mean "use the pool mid", which isolates
    pure slippage). This is the number that makes `max_borrow` falsifiable: if
    `max_borrow > max_profitable_repay_usdc`, the position has a size at which nobody will
    liquidate it.
16. **`simulate_buy(mint, loan_amount)` is ambiguous** and must be pinned before coding. If
    `loan_amount` were USDC, `usdc_in` would just equal it, so `loan_amount` presumably counts
    collateral-token base units and the call is an ExactOut quote: "what does it cost in USDC to
    acquire this much of the token". See D1. Note the model's own `D`/`S` terms need the
    opposite direction (ExactIn, token → USDC), which the bound computes internally anyway; see
    D8 on whether to expose it.
17. **No floats on chain.** All math is `u128` intermediates with explicit rounding direction:
    round *against* the protocol everywhere (quotes round down, costs round up), so a bug biases
    conservative. Prices cannot be `f64`; fixed-point scaling and the token's own `decimals`
    (8 for xStocks, 6 for USDC) must be pinned in the design, not discovered in the code.
18. **Compute budget and rule 4.** A binary search over multi-hop integer math plus account
    reads costs real CU; consumers need a documented number, so every test records
    `compute_units_consumed`. And every new bound (max hops, search iterations, minimum vault
    balance, allowed AMM program ids) is a parameter in `Config` or a `#[constant]`, never a
    literal buried in a handler.
19. **New Cargo deps.** Validating that a pool's vaults hold the right mints means deserializing
    SPL token accounts, i.e. `anchor-spl`. Allowed (AGENTS.md rule 2 scopes zero-deps to `src/`
    and `web/`; `onchain/` is governed by `Cargo.toml`), but it grows the `.so` and must be
    justified in the PR. The alternative is hand-rolled offset parsing — smaller, more brittle.
20. **Two SPYx mints.** The poster keys `EcvRecord` on
    `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` (copied from `src/data/jupiter.mjs`, already
    flagged VERIFY). Market data and DexPaprika list
    `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` as the live SPYx. T11 must quote both and
    record which one Jupiter actually routes; quoting the wrong mint makes every fixture
    and every view number fiction. Out of Phase 2 scope to change `MINTS` (that is
    `src/data/*`, agent B). The oracle itself does not care — it keys on whatever pubkey
    the poster passes.

## On-chain design (frozen for this PoC)

Program: `ecv_oracle`

Accounts:
- `Config` — PDA seeds `["config"]`
  `authority: Pubkey`, `max_staleness_sec: u32`, `bump: u8`
- `EcvRecord` — PDA seeds `["ecv", mint]`
  `mint: Pubkey`, `max_borrow: u64`, `collateral_cap: u64`, `risk_premium_bps: u16`,
  `borrow_disabled: bool`, `breaker_reason: u8`, `liquidation_route: [u8; 32]`,
  `posted_at: i64`, `posted_slot: u64`, `bump: u8`

Instructions:
- `initialize(max_staleness_sec)` — creates `Config`, `authority = signer`. Once.
- `post_ecv(mint, max_borrow, collateral_cap, risk_premium_bps, borrow_disabled,
  breaker_reason, liquidation_route)` — `init_if_needed` the record PDA, require
  `signer == config.authority`, write fields, stamp `posted_at`/`posted_slot` from `Clock`.

Explicitly NOT included: `check_borrow`, any vault, `set_authority`, `close`, CPI to Jupiter,
Pyth, multi-signer attestation, mainnet.

Repo layout (revised 2026-09-25 — `onchain/` is 100% Rust, no Node):
```
onchain/
  Anchor.toml
  Cargo.toml                        # workspace: programs/*, poster
  programs/ecv_oracle/src/lib.rs
  tests/                            # LiteSVM Rust integration tests (template location TBC)
  poster/                           # Rust bin: GET /api/ecv -> encode -> post_ecv (anchor-client)
    src/main.rs
    src/encode.rs                   # f64 -> u64/u16/u8/[u8;32] and back
    tests/fixtures/ecv_outputs.json # captured from /api/ecv (regular + breaker case)
  README.md                         # po polsku: jak uruchomić, co jest w PDA
```
(Outdated original layout had `tests/ecv_oracle.ts`, `client/*.mjs`, `package.json`.)

## On-chain design — Phase 2 (frozen 2026-09-27 by T10 defaults)

`EcvRecord` and the five outputs are unchanged. `post_ecv` gains accounts and checks in T20
(D6) but keeps its arguments and its record layout.

`Config` gains (no `Config` exists on chain yet, so this is a free extension):
`usdc_mint: Pubkey`, `allowed_amm_programs: [Pubkey; 4]`, `allowed_amm_count: u8`,
`max_route_staleness_sec: u32`, `min_vault_balance_usdc: u64`. All set at `initialize`
by the authority; no literals in handlers.

New account `RouteRecord` — PDA seeds `["route", mint]`:
```
mint: Pubkey, mint_decimals: u8, hop_count: u8,
hops: [RouteHop; 2],                 // MAX_HOPS = 2 (D5)
label: [u8; 32],                     // same label as EcvRecord.liquidation_route
updated_at: i64, updated_slot: u64, bump: u8

RouteHop = { pool: Pubkey, kind: u8, input_vault: Pubkey, output_vault: Pubkey,
             input_mint: Pubkey, output_mint: Pubkey, fee_bps: u16, a_to_b: bool }
```
`kind` is a `PoolKind` tag (`#[constant] POOL_KIND_*`); only the constant-product kind is
implemented in this pass (D2), and an unimplemented kind is a hard error, never a silent
fallback. `fee_bps` is read from the pool at validation time, never taken from the caller.

New instructions:
- `update_route(mint, hops, label)` — authority-only. Validation, all of it required:
  hop count in `1..=MAX_HOPS`; `hops[0].input_mint == mint`; `hops[last].output_mint ==
  config.usdc_mint`; `hops[i].output_mint == hops[i+1].input_mint`; for every hop the pool
  account is present, owned by a program in `config.allowed_amm_programs`, its discriminator
  matches `kind`, its vault pubkeys equal the stored ones, each vault's mint equals the hop's
  declared mint, and both vault balances are non-zero (USDC side ≥ `min_vault_balance_usdc`).
  Stamps `updated_at` / `updated_slot` from `Clock`; emits `RouteUpdated`.
- `simulate_buy(mint, loan_amount) -> SimulateBuyResult` — view. Reads `RouteRecord` +
  the route's pool accounts, walks the hops, returns
  `{ usdc_in, token_out, impact_bps, fee_usdc, mid_price_e6, hop_count, capped,
     quoted_at_slot }`. `capped` means the route could not fill the requested size, in which
  case `token_out < loan_amount` and the caller must treat the quote as a floor, not a price.
- `simulate_liquidation_profitability_bound(mint, liquidation_incentive_bps,
  oracle_price_e6) -> LiquidationBoundResult` — view. Binary search per challenge 15,
  returns `{ max_profitable_repay_usdc, max_profitable_qty, impact_bps_at_bound,
  breakeven_impact_bps, net_incentive_bps, bound_is_route_capped, iterations }`.

Pure math lives in `programs/ecv_oracle/src/quote/` (`mod.rs`, `cpmm.rs`) with no Anchor and
no account types, so it is unit-testable on the host and cross-checkable against a captured
Jupiter quote.

Still explicitly NOT included: executing swaps, holding funds, `check_borrow`, any vault,
Pyth/Scope reads, computing session / volatility / TWAP on chain.

## High-level Task Breakdown

Each task is one Executor step. Do not start the next until the user verifies.

- [x] **T0 — Decisions (user)** — done 2026-09-24, see "Decisions".
  (a) `onchain/` own `package.json`, zero-deps scoped to `src/`+`web/`;
  (b) `liquidation_route` as `[u8; 32]` label; (c) localnet first, devnet after.

- [x] **T1 — Toolchain** — done 2026-09-24.
  Install Solana CLI (Agave) and Anchor via `avm`. Create keypair.
  Success: `solana --version`, `anchor --version` print; localnet validator smoke test passes.

- [x] **T2 — Scaffold (REDO, Rust-only)** — done 2026-09-25.
  Remove the mocha/npm scaffold. `anchor init ecv_oracle --no-git --test-template litesvm`,
  rename to `onchain/`, `anchor build`, `anchor keys sync`, rebuild. Root `.gitignore` keeps
  `onchain/target/`, `onchain/.anchor/`, `onchain/test-ledger/` (drop `node_modules`).
  AGENTS.md rule-2 note reworded: `onchain/` is a Cargo workspace; deps via `Cargo.toml`.
  Success: `anchor build` succeeds; no `package.json`/`*.ts` under `onchain/`; `git status`
  shows no build artefacts; `node --test src/ecv/*.test.mjs` still green.
  (Original T2 with mocha template done 2026-09-24, superseded by decision 4.)

- [x] **T3 — Account layouts** — done 2026-09-25.
  Define `Config` and `EcvRecord` structs with `#[account]`, `InitSpace`, bumps.
  Success: `anchor build` passes; layout unit tests pin `INIT_SPACE` (37 / 101 bytes).
  IDL listing deferred: Anchor only emits account types referenced by an instruction, so
  `Config` appears in the IDL at T4 and `EcvRecord` at T5 (added to those criteria).

- [x] **T4 — `initialize`** — done 2026-09-25.
  Instruction + LiteSVM Rust tests: creates `Config`, `authority == payer`,
  `max_staleness_sec == 30`; second call fails (already initialized).
  Success: `anchor test` (LiteSVM) green for these two cases; IDL lists `Config`.

- [x] **T5 — `post_ecv`** — done 2026-09-25.
  Instruction + LiteSVM Rust tests: (1) first post creates record with all fields as passed;
  with the SVM clock warped, `posted_at`/`posted_slot` equal the warped values exactly;
  (2) second post overwrites same PDA, `posted_slot` non-decreasing; (3) signer ≠ authority →
  error `Unauthorized`; (4) different mint → different   PDA address.
  Success: `anchor test` green, 6 cases total; IDL lists `EcvRecord`; template `Counter`
  and `increment` removed.

- [x] **T6 — Encoding module (Rust)** — done 2026-09-25.
  `onchain/poster/src/encode.rs`: `encode(outputs) -> EncodedOutputs` and
  `decode(record) -> Outputs` (f64 ↔ u64 USDC 1e6, u16 bps, u8 reason enum, `[u8;32]` label).
  Fixture `onchain/poster/tests/fixtures/ecv_outputs.json` captured from `/api/ecv` for
  (a) regular session and (b) breaker `impact_extreme`; capture commands documented.
  Tests: round-trip within 1e-6 USDC / 1 bp, all four `breaker_reason` values, route
  truncation at 32 bytes, negative/NaN rejected.
  Success: `cargo test -p poster` green.

- [x] **T7 — Poster (Rust bin)** — done 2026-09-26.
  7a. Move `BREAKER_NONE/STALE_PRICE/DEPTH_FLOOR/IMPACT_EXTREME` from `poster/src/encode.rs`
  into `programs/ecv_oracle/src/constants.rs` as `#[constant] pub const ...: u8` (exported in
  the IDL for integrators); `poster` imports them via `ecv_oracle::constants::*`. Update the
  `EcvRecord.breaker_reason` doc comment to point at the constants. `anchor build` + IDL check
  (`constants` lists the four) + `cargo test --workspace` still 18/18. No layout change.
  7b. `onchain/poster/src/main.rs` using `anchor-client` + `reqwest` + `serde_json`:
  `GET /api/ecv?symbol=SPYx[&live=1]` from the running demo server → `encode` → `post_ecv`
  with mint pubkey matching `src/data/jupiter.mjs` `MINTS` (copied as constants; documented).
  Signs with `~/.config/solana/id.json`. Prints tx signature, PDA address, decoded record.
  Success: on localnet, fetching the PDA after run returns values equal to the API response.

- [ ] **T9 — Periodic poster** — `--every-sec N` loops `post_ecv` so `posted_at` stays inside `max_staleness_sec` (30). Interval shorter than the TTL; API/tx errors retry, wrong authority still exits. Awaiting user check that two posts land ~15s apart on localnet.

- [ ] **T8 — Devnet + docs** — README 2026-09-26; dwa posty na devnet **zablokowane** (0 SOL, faucet 429).
  `anchor deploy --provider.cluster devnet`. Run poster twice for SPYx against the same PDA:
  (1) default params → `borrow_disabled=false`; (2) `session=weekend&depth=60000&notional=250000`
  → breaker `impact_extreme`, `borrow_disabled=true`. This demonstrates PUBLISHING only —
  the oracle carries the breaker flag; nothing on-chain acts on it.
  Write `onchain/README.md` (Polish): how to run, PDA derivation, field encoding, trust
  assumptions, what is out of scope.
  Success: Solana Explorer (devnet) account page of the `EcvRecord` PDA shows the field
  false → true across two tx signatures with `posted_slot` advancing; README committed.

### Phase 2 tasks (2026-09-27). Nothing here starts before D1–D8 are answered.

- [x] **T10 — Decisions (user).** 2026-09-27: user said execute T10–T13; D1–D8 taken as
  the recommended defaults (see Decisions). Design section frozen.

- [x] **T11 — Venue fixtures.** Identify the pool a real SPYx liquidation would actually route
  through (Jupiter `routePlan` for a $10k and a $100k sell is the source of truth) and capture
  the pool account + both vault accounts from mainnet with `solana account --output json` into
  `onchain/programs/ecv_oracle/tests/fixtures/pools/`. Record in the fixture dir: pool address,
  AMM program id, pool kind, fee, vault balances, slot, and the Jupiter quote at both sizes.
  Also quote **both** candidate mints (`XsDoVfq…` from `MINTS` and `XsoCS1T…` from market data)
  and record which one Jupiter routes; the fixtures follow the mint that actually has a book.
  Success: fixtures committed; the recorded Jupiter quote is the reference T12 must reproduce.
  Note: live books are CLMM-dominated (challenge 11). This task may kill D2's CPMM-first
  option if no usable CPMM pool exists for the mint we key on.

- [x] **T12 — Pure quote math (TDD).** `src/quote/{mod,cpmm}.rs`: `quote_exact_in`,
  `quote_exact_out`, `mid_price`, all `u128`, rounding always against the protocol, no Anchor
  imports. Tests first. Cases: known-answer CPMM vectors, fee handling, exact_in/exact_out
  round-trip consistency, zero and saturating inputs, and the T11 Jupiter quote reproduced
  within a stated tolerance (the tolerance is itself a result to report).
  Success: `cargo test -p ecv_oracle quote::` green; the Jupiter cross-check documented.

- [x] **T13 — `Config` extension.** Add the five fields, extend `initialize` args, update
  `config_layout_is_frozen` with a comment saying why the number changed. LiteSVM tests:
  fields land as passed; an empty AMM whitelist is rejected.
  Success: `cargo test` green; IDL shows the new `initialize` args.

- [ ] **T14 — `RouteRecord` + `PoolKind` constants.** State struct, `InitSpace`, layout test
  pinning the byte count, `#[constant] POOL_KIND_*`.
  Success: `anchor build` green; layout test pins the size; no behaviour yet.

- [ ] **T15 — `update_route` + validation.** The handler and every check from the design
  section. LiteSVM tests using T11 fixtures: happy path writes the record and reads `fee_bps`
  from the pool, plus one test per rejection path (wrong owner program, wrong discriminator,
  vault/mint mismatch, broken hop chain, last hop not USDC, empty vault, non-authority signer).
  Success: `cargo test` green with one named test per rejection; IDL lists `RouteRecord`.

- [ ] **T16 — `simulate_buy`.** Handler + `SimulateBuyResult` + `set_return_data`. Mutates
  nothing; verifies each supplied pool account against `RouteRecord`. LiteSVM tests assert the
  decoded return data against T12's expectations, that a wrong/reordered pool account is
  rejected, that an oversized `loan_amount` sets `capped`, and record `compute_units_consumed`.
  Success: `cargo test` green; IDL shows `returns`; CU number written into the scratchpad.

- [ ] **T17 — `simulate_liquidation_profitability_bound`.** Binary search per challenge 15,
  `net_incentive_bps` handled per D3. Tests: the bound satisfies breakeven and one step above
  it does not; monotone in the incentive; `oracle_price_e6 = 0` uses the pool mid;
  `bound_is_route_capped` when the route runs out before breakeven; zero incentive → zero
  bound; CU recorded.
  Success: `cargo test` green; the bound compared against a hand-computed value in the test.

- [ ] **T18 — Prove the CPI path.** Minimal second program `programs/ecv_consumer_test` that
  CPI-calls both views via the generated `ecv_oracle::cpi` module and logs the decoded results.
  LiteSVM test loads both `.so`. This is the only way to prove the "CPI view" claim rather than
  assert it.
  Success: the consumer's logs show the same numbers as the direct calls in T16/T17; combined
  CU recorded.

- [ ] **T19 — Poster + docs.** Poster gains a `route` subcommand that pushes a route from a
  config file (pool addresses committed, not discovered at runtime). `onchain/README.md` (PL)
  documents the `RouteRecord` PDA, the account order a CPI consumer must pass, the CU cost, the
  Kamino bps/percent finding from challenge 14, and what the bound does and does not prove.
  Success: localnet run against cloned mainnet pool accounts writes a route and both views
  return sane numbers; README committed.

- [ ] **T20 — (optional, needs D6) `post_ecv` cross-checks the poster.** `post_ecv` requires
  the `RouteRecord`, rejects a label mismatch, and compares the poster's implied slippage
  against the on-chain quote, failing outside `max_impact_deviation_bps`. This is where the
  oracle stops trusting its own poster. Breaking change: `post_ecv`'s account list and the
  poster both change.
  Success: a test proves a poster lying about impact by more than the tolerance is rejected.

## Decisions

2026-09-24 (user, T0):
1. `onchain/` gets its own `package.json` (`@coral-xyz/anchor`). AGENTS.md rule 2 is amended
   to state that zero-deps applies to `src/` + `web/` (the demo). Done in T2.
2. `liquidation_route` stored as a UTF-8 label, truncated / zero-padded to `[u8; 32]`.
3. Localnet first (T1–T7); devnet only in T8.

2026-09-25 (user):
4. **`onchain/` is 100% Rust.** Supersedes decision 1: no `package.json`, no TypeScript.
   Tests via LiteSVM (Rust), poster as a Rust binary (`anchor-client`). AGENTS.md rule 2 stays
   scoped to the Node demo (`src/*`, `web/*`); `onchain/` deps are governed by `Cargo.toml`.
   Consequence: the encode round-trip test cannot import `computeEcv()`; it uses a committed
   JSON fixture captured from `/api/ecv` instead. Node remains needed only to run the demo
   server the poster reads from.

2026-09-26 (user):
5. `BREAKER_*` reason codes belong to the program (`constants.rs`, `#[constant]`), not to the
   poster. Folded into T7 as step 7a.

Clarifications recorded:
- Poster goes through `GET /api/ecv` (not direct `computeEcv()` import) because input assembly
  (Jupiter probe + fallback, session, vol, params mode) lives inline in `src/api/server.mjs`
  and is not exported. Reuses it without touching Agent E's file. Demo server must be running.
- `borrow_disabled` is PUBLISHED (it is one of the five outputs). It is not ENFORCED — no
  `check_borrow`. T8 shows the published field changing on the `EcvRecord` account page in
  Solana Explorer (devnet), not any enforcement.

2026-09-27 (user, T10) — execute T10–T13; D1–D8 taken as recommended defaults:
6. **D1:** `loan_amount` is collateral-token base units; quote is ExactOut; headline `usdc_in`.
7. **D2:** constant-product math only in this pass; CLMM later behind `PoolKind`. T11 records
   how far the CPMM pool is from the Jupiter route and may force a stop.
8. **D3:** one `liquidation_incentive_bps` argument, **net of the protocol fee**.
   Caller computes `b_net = bonus_bps * (100 - protocol_liquidation_fee_pct) / 100`.
9. **D4:** new `RouteRecord` PDA `["route", mint]`. `EcvRecord` stays byte-identical.
10. **D5:** `MAX_HOPS = 2`.
11. **D6:** T20 after the views are proven; not in this first pass.
12. **D7:** localnet with cloned mainnet pool accounts. Devnet stays Phase 1.
13. **D8:** yes — expose `simulate_sell` as well (folded into T16).

### Decisions needed for Phase 2 — ANSWERED 2026-09-27, kept for the reasoning

- **D1 — `simulate_buy(mint, loan_amount)`: what is `loan_amount`?** Recommended:
  collateral-token base units, and the call is an **ExactOut** quote returning the `usdc_in`
  required to acquire them. If `loan_amount` is USDC instead, then `usdc_in == loan_amount` and
  the interesting return is `token_out`, which is an ExactIn buy — a different instruction.
  Blocks T16.
- **D2 — Which AMM math first?** Recommended: constant-product only (one `PoolKind`), because it
  makes route storage, validation, the CPI view and the binary search all real and testable at a
  fraction of the cost, with CLMM added later behind the existing `kind` tag. The honest cost:
  real xStocks depth is in Orca Whirlpool / Raydium CLMM / Meteora DLMM, so a CPMM-only oracle
  quotes a pool that is not where a liquidation would actually go. T11 may force this decision.
- **D3 — Kamino incentive argument.** Verified: bps is correct for the bonus (challenge 14), but
  klend's protocol cut is `protocol_liquidation_fee_pct` in **percent** and it eats part of the
  bonus. Recommended: keep the requested single `liquidation_incentive_bps` arg, define it
  explicitly as the **net** bonus after the protocol fee, and have the poster/consumer do
  `b_net = bonus_bps * (100 - pct) / 100`. Alternative: add a second `protocol_fee_pct: u8` arg
  and net it on chain (fewer ways for a caller to get it wrong, one more arg).
- **D4 — Route storage.** Recommended: new `RouteRecord` PDA `["route", mint]`, leaving
  `EcvRecord` byte-identical. Alternative (`realloc` `EcvRecord`) breaks the frozen layout, the
  encoder, and the record already on devnet.
- **D5 — `MAX_HOPS`.** Recommended 2 (covers xStock → SOL → USDC; the hop loop is the same code
  as one hop). 1 is smaller; 3+ is speculative.
- **D6 — Does `post_ecv` start requiring the route (T20)?** Recommended: not in the first pass.
  It is the most valuable trust upgrade in this plan, but it changes `post_ecv`'s accounts and
  the poster, and it should land after the views are proven.
- **D7 — Where does this run, and who deploys?** Devnet has no pools, so validation and both
  views cannot work there; and the devnet program's upgrade authority is investiatech's key, not
  ours. Recommended: develop and demo on localnet with mainnet pool accounts cloned
  (`solana-test-validator --clone`), keep devnet on the Phase 1 build, and hand deployment to
  investiatech when Phase 2 is green. Needs confirmation because it changes what the demo shows.
- **D8 — Expose `simulate_sell` too?** The bound computes ExactIn token → USDC internally, so
  exposing it is nearly free, and it is the direction the model's own `D` and `S` terms need.
  Not requested, so not planned — say the word and it becomes part of T17.

## Project Status Board

- [x] T0 Decisions
- [x] T1 Toolchain
- [x] T2 Scaffold — Rust-only redo done 2026-09-25 (awaiting user verification)
- [x] T3 Account layouts — committed by user as `92762e7`
- [x] T4 initialize — committed by user in `1783c30`
- [x] T5 post_ecv — committed by user in `1783c30`
- [x] T6 Encoding module — committed by user in `ebd1f69`
- [x] T7 Poster — committed by user in `cab9da4`
- [ ] T8 Devnet + docs — README written; posts pending faucet
- [ ] T9 Periodic poster — `--every-sec` implemented; awaiting user verification
- [x] T10 Phase 2 decisions D1–D8 — defaults accepted 2026-09-27
- [x] T11 Venue fixtures — done 2026-09-27, awaiting user validation after T13
- [x] T12 Pure quote math — done 2026-09-27
- [x] T13 Config extension — done 2026-09-27
- [ ] T14 RouteRecord
- [ ] T15 update_route + validation
- [ ] T16 simulate_buy
- [ ] T17 simulate_liquidation_profitability_bound
- [ ] T18 CPI proof
- [ ] T19 Poster + docs
- [ ] T20 (optional) post_ecv cross-check

## Current Status / Progress Tracking

2026-09-24 — Plan written. Nothing implemented. No on-chain code exists in the repo.

2026-09-24 — T1 done (Executor). Installed on this machine (nothing in the repo changed):
- Solana CLI (Agave) at `~/.local/share/solana/install/active_release/bin`; PATH line added to
  `~/.zprofile` and `~/.profile`. Active release is **4.1.2** (Anchor 1.2.0 pins it; 4.2.2 was
  installed first, Anchor switched it).
- `avm 1.2.0` and `anchor-cli 1.2.0` (built from source, see Lessons). `anchor` reachable via
  `~/.cargo/bin/anchor` → `~/.avm/bin/avm`.
- SBF platform-tools v1.57 in `~/.cache/solana` (~1.4 GB), pulled by Anchor's bootstrap.
- Keypair `~/.config/solana/id.json`, pubkey `7JdE2aji83yFmsn9QNtbBYJ9RTpiP3FjLmpnuz2SimKR`,
  CLI config URL = `http://localhost:8899`.
- Smoke test: `solana-test-validator` starts, `cluster-version` = 4.1.2, airdrop works.
Devnet airdrop skipped (decision 3: localnet first). Success criteria adjusted accordingly.

2026-09-24 — T2 done (Executor).
- `anchor init ecv_oracle --no-git --no-install --package-manager npm --test-template mocha`,
  dir renamed to `onchain/`. Template is Anchor 1.x counter example (`initialize`/`increment`,
  modular: `instructions/`, `state.rs`, `error.rs`, `constants.rs`) — replaced in T3–T5.
- Program id: `8R3Ju35QZGfocb5x4827e4L6wyJ6Ao5RL9Ygraj8asLM` (localnet throwaway), synced via
  `anchor keys sync` into `lib.rs` + `Anchor.toml`.
- `anchor build` OK → `onchain/target/{deploy,idl,types}`.
- Root `.gitignore`: added `onchain/target/`, `onchain/.anchor/`, `onchain/node_modules/`,
  `onchain/test-ledger/` (nested `onchain/.gitignore` from the template also covers them).
- `AGENTS.md`: rule 2 scoped to `src/*` + `web/*`; new row `G — on-chain | onchain/* | src/*, web/*`.
- `onchain/rust-toolchain.toml` pins host Rust 1.89.0 (template default). Left as is.
- JS deps NOT installed yet (`--no-install`); `npm install` in `onchain/` happens in T4 when
  `anchor test` first needs them.
- Verified: `git status` shows only scaffold sources under `onchain/` (18 files, no artefacts);
  `node --test src/ecv/*.test.mjs` 7/7.

2026-09-25 — T2 REDO done (Executor), `onchain/` is Rust-only.
- `rm -rf onchain` (user-approved), `anchor init ecv_oracle --no-git --test-template litesvm`,
  renamed to `onchain/`. 15 files, no `package.json`/`*.ts`. (`.prettierignore` from the
  template left in place — inert.)
- LiteSVM tests live in `onchain/programs/ecv_oracle/tests/`; `anchor test` = `cargo test`
  (`skip_local_validator = true`). Test loads `target/deploy/ecv_oracle.so` via `include_bytes!`.
- Program id `2t815MdALeVCAKYbkpVFyjNfoF3U7PKLaAirNbNT73LL` (localnet throwaway), synced.
- Template as generated did NOT work; three dev-side fixes (program code untouched):
  `litesvm 0.10.0 → 0.16.0`, `solana-message`/`solana-transaction` dev-deps `3.x → 4`,
  `rust-toolchain.toml` host channel `1.89.0 → 1.96.1`. See Lessons.
- `AGENTS.md` rule-2 note reworded (Cargo workspace, no Node). Root `.gitignore` dropped
  `onchain/node_modules/`.
- Verified: `anchor build` OK; `anchor test` → template `test_initialize` passes (0.05 s);
  `git status` shows only sources + `Cargo.lock`, no artefacts; `node --test src/ecv/*.test.mjs` 7/7.

2026-09-25 — T2 committed as `ac96d20`, moved to branch `feat/g-onchain`; `main` back at `3e947fb`.

2026-09-25 — T3 done (Executor). Only `onchain/programs/ecv_oracle/src/state.rs` changed.
- Added `Config` (authority, max_staleness_sec: u32, bump) and `EcvRecord` (mint, max_borrow,
  collateral_cap, risk_premium_bps: u16, borrow_disabled, breaker_reason: u8,
  liquidation_route: [u8;32], posted_at: i64, posted_slot: u64, bump), both `#[account]` +
  `InitSpace`, with doc comments fixing the field encoding.
- `Counter` kept (template `initialize`/`increment` still reference it); removed in T5.
- Unit tests `config_layout_is_frozen` / `ecv_record_layout_is_frozen` pin `INIT_SPACE` to
  37 / 101 bytes (+8 discriminator on chain).
- Verified: `anchor build` OK; `anchor test` → 2 layout tests + template test pass.
- IDL still lists only `Counter` — expected (see T3 note); criterion moved to T4/T5.

2026-09-25 — T3 committed by user as `92762e7 ecv storage` (also added `.cursor/scratchpad.md`
and `package-lock.json` to the repo — scratchpad is tracked from here on).

2026-09-25 — T4 done (Executor). Files: `constants.rs`, `instructions/initialize.rs`, `lib.rs`,
`tests/test_initialize.rs`.
- `CONFIG_SEED = b"config"` added (`#[constant]`, exported in IDL). `HELLO_WORLD_LAMPORTS`
  removed (only the old initialize used it). `COUNTER_SEED`/`MAX_COUNT` stay until T5.
- `initialize(max_staleness_sec: u32)`: `authority: Signer` (pays rent, becomes
  `config.authority`), `config` = `init` PDA `[CONFIG_SEED]`, `space = 8 + Config::INIT_SPACE`,
  bump stored from `ctx.bumps.config`. Value comes from the caller (params.mjs), no literal.
- Tests (LiteSVM): `initialize_creates_config_with_signer_as_authority` (owner, size,
  authority, staleness, canonical bump) and `initialize_twice_fails` (different signer so the
  tx bytes differ; rejected with System `Custom(0)` = AccountAlreadyInUse; original untouched).
  Template `test_initialize` (counter + increment) replaced.
- Verified: `anchor build` OK; `cargo test` → 2 layout + 2 initialize tests pass; IDL:
  `accounts: [Config, Counter]`, `initialize.args = [max_staleness_sec: u32]`, `config` PDA
  seeds resolvable.

2026-09-25 — T5 done (Executor). Program is now exactly the frozen design; template gone.
- `Cargo.toml`: `anchor-lang` feature `init-if-needed`; dev-dep `solana-clock = "3"` (same
  version litesvm and anchor resolve to, so `Clock` is one type).
- `constants.rs`: `CONFIG_SEED`, `ECV_SEED = b"ecv"`; counter constants removed.
- `error.rs`: only `Unauthorized` (6000). `state.rs`: `Counter` removed.
- `instructions/post_ecv.rs` (new), `increment.rs` deleted, `instructions.rs`/`lib.rs` updated.
  `post_ecv(mint, max_borrow, collateral_cap, risk_premium_bps, borrow_disabled,
  breaker_reason, liquidation_route)`; accounts: `authority: Signer(mut)`, `config`
  (`seeds=[CONFIG_SEED], bump=config.bump, has_one=authority @ Unauthorized`), `record`
  (`init_if_needed, payer=authority, seeds=[ECV_SEED, mint], bump`), `system_program`.
  `mint` is an instruction arg (`#[instruction(mint)]`), not an account — devnet has no
  xStocks mints. `posted_at`/`posted_slot` from `Clock::get()`.
- Tests: shared `tests/common/mod.rs` (setup, PDAs, `send_initialize`, `send_post_ecv`,
  `Outputs` mirror, `baseline_outputs()` from DEMO_RUNBOOK, `route()` label packer).
  `test_initialize.rs` moved onto it. `test_post_ecv.rs`: (1) first post creates record,
  all fields, clock warped → `posted_slot == 12345`, `posted_at == 1790000000` exactly;
  (2) overwrite with breaker outputs, same PDA, slot non-decreasing, no second rent charge;
  (3) intruder → `Custom(6000)`, no record created; (4) two mints → two PDAs, independent.
- Verified: `anchor build` OK, 0 warnings; `cargo test` 8/8 (2 layout + 2 init + 4 post);
  IDL: accounts `[Config, EcvRecord]`, instructions `[initialize, post_ecv]`, record seeds
  `["ecv", arg:mint]`, errors `[6000 Unauthorized]`, constants `[CONFIG_SEED, ECV_SEED]`.

2026-09-25 — T4 + T5 committed by user as `1783c30`.

2026-09-25 — T6 done (Executor). New crate `onchain/poster/` (lib only; bin comes in T7),
added to workspace `members`.
- `poster/Cargo.toml`: deps `ecv_oracle` (path, feature `no-entrypoint`), `serde`, `serde_json`.
- `poster/src/encode.rs`: `Outputs` (serde mirror of API `outputs`, frozen names), `Encoded`
  (post_ecv arg types), `encode()`, `decode(&EcvRecord)`, `EncodeError` {NotFinite, Negative,
  Overflow, UnknownBreakerReason}; helpers `usd_to_units`/`units_to_usd`,
  `fraction_to_bps`/`bps_to_fraction`, `breaker_reason_code`/`_name`, `encode_route`/
  `decode_route`. Constants `USDC_SCALE`, `BPS_SCALE`, `ROUTE_LEN`, `BREAKER_*` (0..3).
  Route truncation respects UTF-8 char boundaries; unknown on-chain codes decode as
  `unknown_<n>` instead of panicking.
- Fixture `poster/tests/fixtures/ecv_outputs.json`: two cases captured from `/api/ecv`
  (priors mode, no `data/params.fitted.json` on this machine): `regular_session_gate_open`
  (max_borrow 68730.43, 242 bps, open) and `weekend_thin_book_breaker`
  (`session=weekend&depth=60000&notional=250000` → impact 81.6%, max_borrow 0,
  `impact_extreme`). Queries recorded in the file for re-capture.
- Tests `poster/tests/encode_roundtrip.rs` (10): fixture round-trip within 1e-6 USD / 1 bp,
  exact integer expectations for both cases, all 4 reasons + unknown, route pad / truncate /
  UTF-8 boundary, negative / NaN / inf rejected, u16-bps and u64-USDC overflow rejected,
  rounding.
- Verified: `cargo test -p poster` 10/10; `cargo test --workspace` 18/18; `anchor build` OK
  (host crate in workspace does not disturb the SBF build); `.so` 157 kB; no warnings.

2026-09-25 — T6 committed by user as `ebd1f69`.

2026-09-26 — `66ac21d` by **investiatech**: program id → `5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc`,
`Anchor.toml` → `[programs.devnet]`, `cluster = "devnet"` (the `[programs.localnet]` entry was
removed, not added alongside). Program is **deployed on devnet** (157 008 bytes, upgrade
authority `DtmWopzAxqkb9xtZFDjaCQ4zmhS3QHL4bJ2HesoqhE6P`, slot 504332522). The program keypair
for `5nsd…` is on their machine only (correct — gitignored). Consequence for local work:
`anchor deploy` on localnet is not possible here; use
`solana-test-validator --bpf-program 5nsd… onchain/target/deploy/ecv_oracle.so` instead, which
loads the `.so` at the declared id without the keypair. Not reverted; flagged to user.

2026-09-26 — T7 done (Executor).
- 7a: `BREAKER_NONE/STALE_PRICE/DEPTH_FLOOR/IMPACT_EXTREME` moved to
  `programs/ecv_oracle/src/constants.rs` as `#[constant]` (now in IDL `constants`);
  `poster::encode` re-exports them from `ecv_oracle::constants`. `EcvRecord.breaker_reason`
  doc points at them. No layout change; 18/18 stayed green.
- 7b: `poster/src/main.rs` (bin `poster`). Deps added: `anchor-client 1.2.0` (blocking),
  `solana-keypair/signer/commitment-config 3`, `anyhow`, `reqwest 0.12` (blocking+json+rustls).
  Flags: `--api` `--symbol` `--query` `--live` `--cluster` `--keypair` `--init`
  `--max-staleness-sec` `--dry-run`. Flow: GET `/api/ecv` → `encode` → (init Config if
  missing and `--init`) → refuse early if signer ≠ `config.authority` → `post_ecv` → read
  record → `decode` → `diff_outputs` → `VERIFY OK` or exit 1 with per-field mismatches.
  `MINTS` copied from `src/data/jupiter.mjs` (SPYx/QQQx/NVDAx) with the same VERIFY caveat.
- `encode.rs`: added `diff_outputs(api, chain) -> Vec<String>`, `USD_TOLERANCE`,
  `BPS_TOLERANCE`; +1 test (11 in poster).
- E2E on localnet (validator with `--bpf-program`, demo API on 8787):
  run 1 `--init --query session=regular` → initialize tx + post tx, record
  `54jQEaQugDtKdXhX6XoBVtb3vYfD4tWGjpsmb6W4wMRw`, slot 7, VERIFY OK;
  run 2 `session=weekend&depth=60000&notional=250000` → same PDA overwritten,
  `borrow_disabled=true`, `impact_extreme`, slot 10, VERIFY OK;
  run 3 intruder keypair → refused client-side before sending.
  `solana account` shows 109 bytes owned by the program, 0.00165 SOL rent.
- Verified: `anchor build` OK; `cargo build -p poster` 0 warnings; `cargo test --workspace`
  19/19. Temp files removed; no stray processes.

2026-09-26 — T8 partial (Executor). `onchain/README.md` (PL): adresy, PDA, encoding, trust,
localnet (`--bpf-program`), devnet, poster. Program już na devnet (`5nsd…`), Config i
EcvRecord SPYx **nie** istnieją. `anchor deploy` pominięty: upgrade authority to
`DtmWopz…`, nie `7JdE2…`. Poster `--init --cluster devnet` nie ruszył: signer ma 0 SOL,
`requestAirdrop` 429.

2026-09-27 — Phase 2 planned (Planner). Nothing implemented. Added: Background §Phase 2,
challenges 9–19, design section "On-chain design — Phase 2 (PROPOSED)", tasks T10–T20,
decisions D1–D8. Only research done: klend's liquidation-bonus units verified against source
(challenge 14). Phase 1 tasks T8/T9 are still open and independent of this.

2026-09-27 — Phase 2 refined (Planner), same request restated by user. Nothing implemented.
Re-verified Kamino units against official docs (`kamino.com/docs/curators/markets/
reserve-parameters` and `liquidations`) plus `klend` `liquidation_operations.rs`: bonus is
bps, protocol cut is percent. Re-verified SPYx venues: depth is Raydium CLMM / Orca, CPMM
is ~$6–7k (challenge 11). Noted two SPYx mint pubkeys (challenge 20). Design section put
back to PROPOSED — D1–D8 were never confirmed by the user. T10 is the gate.

2026-09-27 — T10–T13 done (Executor). Design frozen with recommended defaults.
T11: live SPYx is `XsoCS1T…`; repo `XsDoVfq…` is TSLAx; no CPMM vs USDC.
T12: CPMM math + documented ~3872 bps optimistic gap vs Jupiter.
T13: Config 210 B, initialize args extended, empty whitelist rejected.
Awaiting user validation.

## Executor's Feedback or Assistance Requests

2026-09-26 — T9 in progress. Poster gained `--every-sec N`. One-shot path unchanged.
Interval must be shorter than on-chain `max_staleness_sec` (warning otherwise).
API and tx failures are logged and retried; missing config / wrong authority still exit.
Localnet loop with `--every-sec 15` (half of TTL 30): four posts, VERIFY OK,
`posted_at` 1790445313 → 5329 → 5345 → 5359 (~15s), slots 9141 → 9173 → 9205 → 9235.
Process left running. Awaiting user confirmation before marking T9 done.

2026-09-27 — T9 recheck, not marked done. Reject paths exit 1 (`--every-sec 0`,
`--dry-run` combined with `--every-sec`). Wrong authority exits before the loop.
A dead API logs `post failed` and retries. Two live posts VERIFY OK on the same
PDA, but `posted_at` gap was 29s (1790504419 → 1790504448), not ~15s. This
validator's clock is 1 unix second per slot and ~2 slots per wall second, so a
15s wall sleep ages the record by ~30 chain seconds, equal to `max_staleness_sec`.

T8 docs done (uncommitted `onchain/README.md`). Explorer artefact (false→true na `54jQEa…`)
czeka na ~0.01 SOL devnet na `7JdE2aji83yFmsn9QNtbBYJ9RTpiP3FjLmpnuz2SimKR`. Po doładowaniu
na https://faucet.solana.com powiedz „post T8” — odpalę `--init` + dwa posty i wpiszę
sygnatury do README. Pierwszy `--init` ustawi oracle authority na ten signer.

2026-09-27 (Executor) — T10–T13 done, **awaiting user validation before T14**.

T10: D1–D8 taken as recommended defaults (user: execute through T13).

T11: fixtures in `onchain/programs/ecv_oracle/tests/fixtures/pools/`.
- Repo `MINTS.SPYx` `XsDoVfq…` is **TSLAx**, not SPYx. Live SPYx is `XsoCS1T…`.
- Jupiter live-SPYx $10k sell: out 10000565104 USDC raw, hops Raydium CLMM + Byreal.
  $100k: 99917151970, hops Raydium CLMM + Byreal + Raydium CLMM.
- Raydium `poolType=standard` vs USDC: **0 pools**. No honest CPMM venue. D2 not
  killed as a code path (user asked to continue through T13) but `update_route`
  cannot point at a real SPYx/USDC CPMM. CLMM pool+vault accounts captured.

T12: `quote/{mod,cpmm}.rs`, 15 unit tests green. Jupiter×CPMM-from-vaults gap
asserted: 13_872_302_207 vs 10_000_565_104 (~3872 bps optimistic). Do not "fix".

T13: `Config` INIT_SPACE 37 → 210 (commented). `initialize` takes the five new
args. Empty whitelist → `EmptyAmmWhitelist` (6001). Poster `--init` updated so
the workspace still compiles. IDL lists the new args.

`cargo test --workspace` 35/35; `node --test src/ecv/*.test.mjs` 7/7.
Please confirm T11–T13 before T14 (`RouteRecord`).

2026-09-26 (user): `[programs.localnet]` re-added alongside `[programs.devnet]` in
`Anchor.toml`, same program id `5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc`. Provider
cluster stays `devnet` (investiatech's default).

## Lessons

- `avm install latest` / `avm install <ver>` time out on this network (GitHub releases API
  slow). Working path: find the tag with `git ls-remote --tags https://github.com/coral-xyz/anchor`,
  then `avm install <ver> --from-source`.
- Anchor from source on macOS with Rust 1.96 fails at link time: LTO bitcode is LLVM 22, Apple
  `libLTO` is LLVM 21 ("Unknown attribute kind (105)"). Fix: `CARGO_PROFILE_RELEASE_LTO=false`.
- The first `anchor --version` after install is not instant: Anchor 1.2.0 bootstraps its pinned
  Solana (4.1.2) and downloads platform-tools v1.57. Took ~20 min here. Don't kill it.
- Upstream Anchor is now maintained at `otter-sec/anchor` (avm resolves `coral-xyz` there).
- The Cursor agent shell exports `CARGO_TARGET_DIR` to a sandbox cache, so `anchor build`
  writes `deploy/idl/types` outside `onchain/target/`. Run `env -u CARGO_TARGET_DIR anchor build`
  from the agent; the user's own terminal is unaffected.
- A build with a redirected target dir generates the program keypair there; the next build in
  the real `target/` generates a different one → `declare_id!` mismatch. Fix: `anchor keys sync`
  then rebuild. Program keypairs live only in `target/deploy` (gitignored) — never copy them around.
- Anchor 1.2.0's `litesvm` test template is stale out of the box. Platform-tools v1.57 emits
  sBPF **v3** ELF (e_flags 0x3); `litesvm 0.10` rejects it with `InvalidAccountData` at
  `add_program`. `litesvm 0.16` loads it but pulls Agave 4.x crates that need Rust ≥ 1.9x
  (`maybe_uninit_write_slice`) and `solana-message`/`solana-transaction` **4.x** — the 3.x
  types in the template don't match `send_transaction`. Fix all three together; the on-chain
  crate deps (`anchor-lang`) are unaffected.
- In LiteSVM tests, `INIT_SPACE` needs `use anchor_lang::Space` in scope. A "second call must
  fail" test must use a different signer (or a new blockhash) — an identical tx is rejected by
  the duplicate filter before the program runs, which would make the test pass vacuously.
- LiteSVM `set_sysvar::<Clock>` lets a test pin `slot`/`unix_timestamp` and assert program
  stamps exactly. `Clock` must be the same crate version litesvm uses (`solana-clock ~3.1`);
  add it as an explicit dev-dep rather than relying on the anchor prelude re-export.
- `init_if_needed` needs `anchor-lang = { features = ["init-if-needed"] }`; without it the
  constraint is a compile error. Anchor's re-init warning does not apply here: every field is
  overwritten on each post, which is the intended semantics.
- A host crate depending on the program crate must use `features = ["no-entrypoint"]`, or the
  program's `entrypoint` symbol gets linked into the host binary. An `f64` inside an error enum
  rules out `derive(Eq)` — use `PartialEq` and `matches!` in tests for variants with floats.
- Background processes started with `&` inside an agent shell command are reaped when the
  command returns (`nohup` does not help; `solana-test-validator` only survives because it
  forks). For multi-process E2E runs put validator + server + client in ONE script and `trap`
  the cleanup.
- Without the program keypair, `solana-test-validator --bpf-program <declared id> <so>` loads a
  program at any address at genesis — the way to test locally when the deploy key lives
  elsewhere. `anchor-client` `Client<C>` wants `Arc<Keypair>`; `Cluster::from_str` accepts
  `localnet|devnet|<http url>`.
- `anchor test -- <args>` exits 1 on this setup; run `cargo test -- --nocapture` directly
  from `onchain/` when you need test stdout.
- Host `rust-toolchain.toml` does not affect `anchor build` (cargo-build-sbf uses the
  platform-tools compiler); it only governs `cargo test` and future host bins (poster).
- Kamino `klend` liquidation incentive: the bonus is **bps**
  (`min_liquidation_bonus_bps` / `max_liquidation_bonus_bps` / `bad_debt_liquidation_bonus_bps`,
  all `u16`, interpolated by how far LTV exceeds the liquidation threshold), but
  `protocol_liquidation_fee_pct` is **percent** and is charged on the bonus portion only
  (`bonus = amount_liquidated - amount_liquidated/(1+b)`, `fee = ceil(bonus * pct/100)`, min 1).
  Net liquidator incentive is `b * (1 - pct/100)`. Our `params.mjs` `liquidationBonusPct` is in
  percent — always state the unit when passing an incentive across the Node/Rust boundary.
  Official docs match the source: `minLiquidationBonusBps` / `maxLiquidationBonusBps` /
  `badDebtLiquidationBonusBps` are u16 0–10000; `protocolLiquidationFeePct` is u8 0–100.
  Reference values in the liquidations doc: majors 300–500 / 700–1000 bps, long-tail
  500–800 / 1500–2500 bps. Interpolation is by how far LTV exceeds the liquidation
  threshold (`unhealthy_factor = user_ltv - max_allowed_ltv`), not a single field.
- Two published SPYx mints exist (`XsDoVfq…` in this repo vs `XsoCS1T…` on DexPaprika /
  CoinMarketCap). T11 must quote both before committing pool fixtures. Do not "fix" `MINTS`
  from `onchain/` (agent G must not touch `src/*`).
- T11 finding: `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` is **TSLAx**. Live SPYx is
  `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W`. Jupiter $10k-qty sell is the cheapest
  discriminator (~$4.8k vs ~$10.0k).
- Treating a Raydium CLMM vault pair as CPMM `k` overestimates a $10k SPYx sell by
  ~3872 bps (13.87k vs 10.00k USDC). Assert the gap; never tighten the test toward
  the Jupiter number.
- CPMM `quote_exact_out` must invert both floors (k-curve, then fee) with two
  `ceil_div`s. Uniswap V2's single `floor+1` still under-covers by 1 raw unit.
- `mid_price_e6` / `impact_bps_exact_in` take `decimals_in` / `decimals_out`.
  One side is always USDC 6. Mid is USDC raw per 1 whole of the other mint
  (`reserve_usdc * 10^token_decimals / reserve_token`), not raw-out/raw-in.
  Impact compares those USDC-per-whole prices; the bps ratio still cancels
  decimals, but the mid itself was wrong without the scale.
