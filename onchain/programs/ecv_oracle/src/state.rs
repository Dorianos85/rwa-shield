use anchor_lang::prelude::*;

/// Oracle configuration. One per deployment, PDA seeds `["config"]`.
///
/// The oracle only PUBLISHES; it never enforces. `max_staleness_sec` is the
/// TTL the poster commits to, exported so consumers can apply their own
/// staleness check against `EcvRecord.posted_at`. Mirrors
/// `maxStalenessSec` in `src/ecv/params.mjs` - not a literal in program code.
#[account]
#[derive(InitSpace)]
pub struct Config {
    /// Only this key may call `post_ecv`. Single attester in the PoC.
    pub authority: Pubkey,
    /// Intended freshness window for records, in seconds.
    pub max_staleness_sec: u32,
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
        // authority 32 + max_staleness_sec 4 + bump 1
        assert_eq!(Config::INIT_SPACE, 37);
    }

    #[test]
    fn ecv_record_layout_is_frozen() {
        // mint 32 + max_borrow 8 + collateral_cap 8 + risk_premium_bps 2
        // + borrow_disabled 1 + breaker_reason 1 + liquidation_route 32
        // + posted_at 8 + posted_slot 8 + bump 1
        assert_eq!(EcvRecord::INIT_SPACE, 101);
    }
}
