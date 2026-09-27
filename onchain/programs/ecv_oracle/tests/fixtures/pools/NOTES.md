# T11 venue fixtures (captured 2026-09-27, mainnet slot ~451000134)

Source of truth for a real SPYx liquidation: Jupiter `lite-api.jup.ag` ExactIn
token → USDC at two sizes (~12.936 and ~129.36 tokens, 8 decimals).

## Mint VERIFY

| Label in this repo | Pubkey | What it actually is |
|---|---|---|
| `MINTS.SPYx` in `src/data/jupiter.mjs` / poster | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | **TSLAx**, not SPYx. Jupiter $10k-qty sell returned ~$4,825 (TSLA ~$373). |
| Market / DexScreener / CoinMarketCap SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | Live SPYx. Jupiter $10k-qty sell returned ~$10,000.56 (SPY ~$773). |

Fixtures and the Jupiter reference follow **`XsoCS1T…`**. Changing `MINTS` is out of
scope for agent G (`src/data/*`).

Raydium `poolType=standard` (CPMM) vs USDC: **0 pools** for both mints.
DexScreener CPMM hits on SPYx are meme pairs (CAT/SPYx, BUNNY/SPYx), not a
liquidation venue. D2 (CPMM-first) therefore has **no honest mainnet pool** to
point `update_route` at. T12 implements CPMM math against known-answer vectors;
the Jupiter cross-check documents the gap, it does not claim reproduction.

## Jupiter routes (`jupiter_quotes.json`)

Live SPYx (`XsoCS1T…`), ExactIn:

- ~$10k: out `10000565104` USDC raw, impact ~0.036%. Hops: Raydium CLMM + Byreal.
- ~$100k: out `99917151970` USDC raw, impact ~0.13%. Hops: Raydium CLMM + Byreal + Raydium CLMM.

Repo mint (`XsDoVfq…` = TSLAx): routes through Riptide / Raydium CLMM. Not used
as the T12 reference.

## Pools captured (`accounts/`)

All three are concentrated liquidity. Account JSON from
`solana account --url https://api.mainnet-beta.solana.com --output json`.

### Raydium CLMM deep — `6truu3rZuiB9rKQg4VYC3Dt3QwV7DgwGqXrYUcrvnDDE`

- program: `CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK`
- kind: Raydium CLMM, fee 10 bps (0.001)
- mintA SPYx `XsoCS1T…` vault `CiQuPAfYp5v82vijk6u7wqFnaZqtGdJfUUSjDKAtT9ML`
  balance 178887088905 raw (1799.09349958, 8 dec)
- mintB USDC `EPjFWdd5…` vault `3EmW8zJDHrfgwpQJAt1oD6nxgQZLUwrCRSKk8Gr3iKRF`
  balance 1934141178334 raw (1934141.178334, 6 dec)
- TVL ~$3.32M. Present on the $100k Jupiter route.

### Raydium CLMM hot — `4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw`

- same program, fee 1 bp (0.0001)
- vault SPYx `AUhtN1KPdVEQ1mh7gy3oHzjWyqHo5RQx1KEiFJdyqAeN` 35155722402 raw
- vault USDC `92aTAYGnUCH28J96EFzD8ELa6ZpdzXw4zqEuX1nD6oD7` 250192288628 raw
- TVL ~$0.52M, highest 24h volume. On both $10k and $100k Jupiter routes.

### Orca Whirlpool — `Fae5dWVntUt6zbWu2voXxioDpMii7SqQwtsxBmoVCsHR`

- program: `whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc`
- vault SPYx `EfmaMxuPJaU914gV9N8Z2sDTp249AtEASTLDZdhRsN37`
- vault USDC `5NbsTM8qKWA65oRjZpMARnnxpeR4rGiGdG9vPdCD3sem`
- On the first Jupiter snapshot ($10k / $100k); a later snapshot used Byreal instead.

## T12 Jupiter × CPMM gap (do not "fix")

Treating the deep CLMM vault balances as constant-product reserves and selling
the $10k size (1_293_600_000 raw SPYx) at 10 bps:

- CPMM `quote_exact_in` → 13_872_302_207 USDC raw (~$13,872)
- Jupiter → 10_000_565_104 USDC raw (~$10,000.56)
- CPMM / Jupiter ≈ 1.387 (overestimates by ~3872 bps)

CLMM vault balances are not a CPMM `k`. Using them as if they were overestimates
depth — the wrong direction for a risk system. T12 asserts this gap rather than
a tight tolerance.
