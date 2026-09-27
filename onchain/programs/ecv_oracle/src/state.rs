use anchor_lang::prelude::*;

use crate::constants::MAX_ALLOWED_AMM_PROGRAMS;

/// Oracle configuration. One per deployment, PDA seeds `["config"]`.
///
/// The oracle only PUBLISHES; it never enforces. `max_staleness_sec` is the
/// TTL the poster commits to, exported so consumers can apply their own
/// staleness check against `EcvRecord.posted_at`. Mirrors
/// `maxStalenessSec` in `src/ecv/params.mjs` - not a literal in program code.
///
/// Phase 2 fields (`usdc_mint`, the AMM whitelist, `max_route_staleness_sec`,
/// `min_vault_balance_usdc`) are also set at `initialize`. No `Config`
/// existed on any cluster when they were added, so this is not a migration.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Only this key may call `post_ecv` / `update_route`. Single attester in the PoC.
    pub authority: Pubkey,
    /// Intended freshness window for ECV records, in seconds.
    pub max_staleness_sec: u32,
    /// Quote currency for every stored route. Last hop must end here.
    pub usdc_mint: Pubkey,
    /// Programs allowed to own a hop's pool account. First `allowed_amm_count` slots are live.
    pub allowed_amm_programs: [Pubkey; MAX_ALLOWED_AMM_PROGRAMS as usize],
    pub allowed_amm_count: u8,
    /// Intended freshness window for `RouteRecord`, in seconds. Published, not enforced.
    pub max_route_staleness_sec: u32,
    /// USDC-side vault balance below this is rejected at `update_route`.
    pub min_vault_balance_usdc: u64,
    pub bump: u8,
}

/// Published ECV outputs for one token mint. PDA seeds `["ecv", mint]`,
/// overwritten in place on every `post_ecv`.
///
/// Field encoding (fixed here; the off-chain encoder must match):
/// - `max_borrow`, `collateral_cap`: USDC base units, 6 decimals (`u64`)
/// - `risk_premium_bps`: basis points, `0.02` -> `200`
/// - `breaker_reason`: `BREAKER_*` in `constants.rs` (`0` none, `1` stale_price,
///   `2` depth_floor, `3` impact_extreme)
/// - `liquidation_route`: UTF-8 label, truncated / zero-padded to 32 bytes
///
/// `posted_at` / `posted_slot` are written by the program from `Clock`,
/// never taken from instruction data.
#[account]
#[derive(InitSpace)]
pub struct EcvRecord {
    pub mint: Pubkey,
    pub max_borrow: u64,
    pub collateral_cap: u64,
    pub risk_premium_bps: u16,
    pub borrow_disabled: bool,
    pub breaker_reason: u8,
    pub liquidation_route: [u8; 32],
    pub posted_at: i64,
    pub posted_slot: u64,
    pub bump: u8,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Layout is a contract with the off-chain encoder and with every existing
    // account on chain. If one of these fails, you changed the layout.
    #[test]
    fn config_layout_is_frozen() {
        // Phase 2 (T13): no Config existed on any cluster, so extending here
        // was free. Was 37 (authority 32 + max_staleness_sec 4 + bump 1).
        // Now: authority 32 + max_staleness_sec 4 + usdc_mint 32
        // + allowed_amm_programs 128 + allowed_amm_count 1
        // + max_route_staleness_sec 4 + min_vault_balance_usdc 8 + bump 1
        assert_eq!(Config::INIT_SPACE, 210);
    }

    #[test]
    fn ecv_record_layout_is_frozen() {
        // mint 32 + max_borrow 8 + collateral_cap 8 + risk_premium_bps 2
        // + borrow_disabled 1 + breaker_reason 1 + liquidation_route 32
        // + posted_at 8 + posted_slot 8 + bump 1
        assert_eq!(EcvRecord::INIT_SPACE, 101);
    }
}
