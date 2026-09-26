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

- [ ] **T8 — Devnet + docs** — README 2026-09-26; dwa posty na devnet **zablokowane** (0 SOL, faucet 429).
  `anchor deploy --provider.cluster devnet`. Run poster twice for SPYx against the same PDA:
  (1) default params → `borrow_disabled=false`; (2) `session=weekend&depth=60000&notional=250000`
  → breaker `impact_extreme`, `borrow_disabled=true`. This demonstrates PUBLISHING only —
  the oracle carries the breaker flag; nothing on-chain acts on it.
  Write `onchain/README.md` (Polish): how to run, PDA derivation, field encoding, trust
  assumptions, what is out of scope.
  Success: Solana Explorer (devnet) account page of the `EcvRecord` PDA shows the field
  false → true across two tx signatures with `posted_slot` advancing; README committed.

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

## Executor's Feedback or Assistance Requests

T8 docs done (uncommitted `onchain/README.md`). Explorer artefact (false→true na `54jQEa…`)
czeka na ~0.01 SOL devnet na `7JdE2aji83yFmsn9QNtbBYJ9RTpiP3FjLmpnuz2SimKR`. Po doładowaniu
na https://faucet.solana.com powiedz „post T8” — odpalę `--init` + dwa posty i wpiszę
sygnatury do README. Pierwszy `--init` ustawi oracle authority na ten signer.

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
