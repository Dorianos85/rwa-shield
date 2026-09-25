pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2t815MdALeVCAKYbkpVFyjNfoF3U7PKLaAirNbNT73LL");

#[program]
pub mod ecv_oracle {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, max_staleness_sec: u32) -> Result<()> {
        crate::instructions::initialize::handle_initialize(ctx, max_staleness_sec)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn post_ecv(
        ctx: Context<PostEcv>,
        mint: Pubkey,
        max_borrow: u64,
        collateral_cap: u64,
        risk_premium_bps: u16,
        borrow_disabled: bool,
        breaker_reason: u8,
        liquidation_route: [u8; 32],
    ) -> Result<()> {
        crate::instructions::post_ecv::handle_post_ecv(
            ctx,
            mint,
            max_borrow,
            collateral_cap,
            risk_premium_bps,
            borrow_disabled,
            breaker_reason,
            liquidation_route,
        )
    }
}
