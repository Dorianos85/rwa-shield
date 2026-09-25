use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, ECV_SEED},
    error::ErrorCode,
    state::{Config, EcvRecord},
};

/// Publishes the ECV outputs for one mint. First call for a mint creates the
/// record PDA; later calls overwrite it in place. Only `config.authority` may
/// call this.
///
/// `mint` is an instruction argument, not an account: on devnet the xStocks
/// mints do not exist, and the oracle never touches the token itself. The
/// pubkey is only a key.
#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct PostEcv<'info> {
    /// Must equal `config.authority`. Pays rent on first post for a mint.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + EcvRecord::INIT_SPACE,
        seeds = [ECV_SEED, mint.as_ref()],
        bump
    )]
    pub record: Account<'info, EcvRecord>,
    pub system_program: Program<'info, System>,
}

/// Field encoding is documented on `EcvRecord`. `posted_at` / `posted_slot`
/// come from the `Clock` sysvar here; the poster cannot supply them.
#[allow(clippy::too_many_arguments)]
pub fn handle_post_ecv(
    ctx: Context<PostEcv>,
    mint: Pubkey,
    max_borrow: u64,
    collateral_cap: u64,
    risk_premium_bps: u16,
    borrow_disabled: bool,
    breaker_reason: u8,
    liquidation_route: [u8; 32],
) -> Result<()> {
    let clock = Clock::get()?;
    let record = &mut ctx.accounts.record;

    record.mint = mint;
    record.max_borrow = max_borrow;
    record.collateral_cap = collateral_cap;
    record.risk_premium_bps = risk_premium_bps;
    record.borrow_disabled = borrow_disabled;
    record.breaker_reason = breaker_reason;
    record.liquidation_route = liquidation_route;
    record.posted_at = clock.unix_timestamp;
    record.posted_slot = clock.slot;
    record.bump = ctx.bumps.record;

    msg!(
        "ecv_oracle: posted mint={} max_borrow={} borrow_disabled={} reason={} slot={}",
        mint,
        max_borrow,
        borrow_disabled,
        breaker_reason,
        clock.slot
    );
    Ok(())
}
