# ECV oracle (on-chain)

Program Anchor **tylko publikuje** pięć wyjść ECV (`max_borrow`, `collateral_cap`,
`liquidation_route`, `risk_premium`, `borrow_disabled`) plus `breaker_reason` do PDA
per mint. **Nie liczy ECV** (wejścia: Jupiter, sesja NYSE, vol — poza SVM) i **nie
egzekwuje** breakera: brak `check_borrow`, vaultu, CPI. Konsument (Kamino, Jupiter Lend,
przyszły vault) czyta PDA i sam stosuje `max_staleness_sec` względem `posted_at`.

Kod: angielski. Ten README: polski (AGENTS.md, zasada 6).

## Adresy (devnet = localnet, ten sam `declare_id!`)

| Co | Adres |
|---|---|
| Program `ecv_oracle` | `5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc` |
| `Config` PDA `["config"]` | `Dty68hZxpsTbGySXyNa9uPXCqCoTKwYHMQ4ZANPQskZK` |
| `EcvRecord` SPYx `["ecv", mint]` | `54jQEaQugDtKdXhX6XoBVtb3vYfD4tWGjpsmb6W4wMRw` |
| Mint SPYx (klucz, nie konto tokena) | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` |

Explorer (cluster `devnet`):

- [program](https://explorer.solana.com/address/5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc?cluster=devnet)
- [Config](https://explorer.solana.com/address/Dty68hZxpsTbGySXyNa9uPXCqCoTKwYHMQ4ZANPQskZK?cluster=devnet)
- [EcvRecord SPYx](https://explorer.solana.com/address/54jQEaQugDtKdXhX6XoBVtb3vYfD4tWGjpsmb6W4wMRw?cluster=devnet)

Program jest już na **devnet** (deploy: investiatech, slot 504332522, 157 008 bajtów).
Upgrade authority: `DtmWopzAxqkb9xtZFDjaCQ4zmhS3QHL4bJ2HesoqhE6P`. Keypair programu nie
jest w repo (gitignored) — `anchor deploy` z tej maszyny **nie** nadpisze programu.

## Konta

**`Config`** (jedno na deployment, `init` raz):

- `authority` — jedyny signer `post_ecv` (PoC: jeden attester)
- `max_staleness_sec` — TTL z `src/ecv/params.mjs` (`maxStalenessSec`, default 30),
  **publikowany, nie egzekwowany** przez oracle
- `bump` — kanoniczny bump PDA

**`EcvRecord`** (jedno na mint, `init_if_needed`, overwrite w miejscu):

- `mint`, `max_borrow` (`u64` USDC 1e6), `collateral_cap` (`u64` USDC 1e6)
- `risk_premium_bps` (`u16`, `0.0242` → `242`)
- `borrow_disabled` (`bool`), `breaker_reason` (`u8`, stałe `BREAKER_*` w IDL)
- `liquidation_route` (`[u8; 32]`, UTF-8, obcięte / zero-padded)
- `posted_at` / `posted_slot` — z `Clock` **w programie**, nie z argumentów
- `bump`

Rozmiar na łańcuchu: `8 + INIT_SPACE` (discriminator + dane) → Config 45 B, record 109 B.

## Instrukcje

1. `initialize(max_staleness_sec)` — tworzy `Config`, `authority = signer`. Druga próba pada
   (`AccountAlreadyInUse`).
2. `post_ecv(mint, …outputs)` — wymaga `signer == config.authority` (`Unauthorized` = 6000).
   `mint` jest **argumentem**, nie kontem: na devnecie xStocks nie istnieją; oracle nie
   rusza tokena.

Błędy: tylko `Unauthorized`.

## Kodowanie (`poster::encode`)

Źródło prawdy layoutu: `programs/ecv_oracle/src/state.rs`. Enkoder: `poster/src/encode.rs`.

| Pole API (`outputs`) | On-chain |
|---|---|
| `max_borrow`, `collateral_cap` | `u64`, × 1 000 000 |
| `risk_premium` | `u16` bps, × 10 000 |
| `borrow_disabled` | `bool` |
| `breaker_reason` `null` / `stale_price` / `depth_floor` / `impact_extreme` | `0` / `1` / `2` / `3` (`BREAKER_*` w `constants.rs`, w IDL) |
| `liquidation_route` | `[u8; 32]` |

Fixture z `/api/ecv` (re-capture): `poster/tests/fixtures/ecv_outputs.json`.

Minty w posterze skopiowane z `src/data/jupiter.mjs` (`MINTS`) — **zweryfikować** przed
live demo (README repo, punkt 4).

## Zaufanie (PoC)

Jedna para kluczy `Config.authority` może pisać dowolne liczby do rekordu. Brak multi-sig,
brak Pyth, brak weryfikacji Jupitera on-chain. Freshness: konsument porównuje
`Clock.unix_timestamp - posted_at` z `config.max_staleness_sec`.

## Poza zakresem

`check_borrow`, vault, likwidacja / Jupiter CPI, wielu attesterów, mainnet, zmiana pięciu
pól w `src/ecv/model.mjs`.

## Wymagania

- Solana CLI (Agave) + Anchor 1.2.0 (`avm`) + Rust (host: pin w `rust-toolchain.toml`)
- Node 20+ **tylko** do demo API (`node src/api/server.mjs`); `onchain/` to workspace Cargo
- Wallet: `~/.config/solana/id.json` ( Anchor.toml )

Z katalogu `onchain/`:

```bash
anchor build
cargo test --workspace   # po `anchor build` (LiteSVM ładuje target/deploy/*.so)
```

`CARGO_TARGET_DIR` w środowisku agenta Cursor przekierowuje artefakty — wtedy:
`env -u CARGO_TARGET_DIR anchor build`.

## Localnet

Keypair programu `5nsd…` nie jest na tej maszynie. Ładuj `.so` pod zadeklarowanym id:

```bash
solana-test-validator --reset --ledger /tmp/ecv-ledger \
  --bpf-program 5nsdYoeBK9TU3fqeutenakSiiyP5w2y8T6MzBRY5cEuc \
  target/deploy/ecv_oracle.so
```

W drugim terminalu, z korzenia repo:

```bash
node src/api/server.mjs
cd onchain
cargo run -p poster -- --cluster localnet --init --symbol SPYx --query 'session=regular'
cargo run -p poster -- --cluster localnet --symbol SPYx \
  --query 'session=weekend&depth=60000&notional=250000'
```

`--init` tworzy `Config` (signer = authority). Drugi post nadpisuje **ten sam** PDA SPYx:
`borrow_disabled` false → true (`breaker_reason = 3` = `impact_extreme`). Oracle tylko
**publikuje** flagę.

`--dry-run` — GET + encode, bez tx. `--live` — `?live=1` (Jupiter; API ma fallback offline).

## Stan (2026-09-26)

Program na devnecie jest. Konta `Config` i `EcvRecord` SPYx **jeszcze nie istnieją**
(pierwszy `--init` + dwa `post_ecv` wymagają ~0.01 SOL na signerze). Faucet
`api.devnet.solana.com` zwraca 429 dla `7JdE2aji83yFmsn9QNtbBYJ9RTpiP3FjLmpnuz2SimKR`
— doładować na https://faucet.solana.com i odpalić komendy z sekcji Devnet.

## Devnet

`Anchor.toml`: `[programs.localnet]` i `[programs.devnet]` z tym samym id; `provider.cluster`
= `devnet`.

Upgrade: tylko `DtmWopz…`. Ponowny `anchor deploy` z keypaira `7JdE2…` **nie zadziała**.

Pierwszy `poster --cluster devnet --init` ustawia **oracle authority** na signer tej maszyny
(osobno od upgrade authority programu).

```bash
# z korzenia repo, API na :8787, SOL na signerze (faucet: https://faucet.solana.com)
node src/api/server.mjs
cd onchain
cargo run -p poster -- --cluster devnet --init --symbol SPYx --query 'session=regular'
cargo run -p poster -- --cluster devnet --symbol SPYx \
  --query 'session=weekend&depth=60000&notional=250000'
```

Po sukcesie: ta sama strona konta `54jQEa…` w explorerze, dwa podpisy tx, `posted_slot`
rośnie, `borrow_disabled` się odwraca. Nazwane pola w explorerze: po `anchor idl init`
(wymaga upgrade authority programu).

## Flagi postera

```
poster [--api http://localhost:8787] [--symbol SPYx] [--query k=v] [--live]
       [--cluster localnet|devnet|<http url>] [--keypair ~/.config/solana/id.json]
       [--init] [--max-staleness-sec 30] [--dry-run]
```
