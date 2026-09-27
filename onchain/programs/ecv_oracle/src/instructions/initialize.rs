use anchor_lang::prelude::*;

use crate::{constants::CONFIG_SEED, state::Config};

/// Creates the single `Config` PDA. Runs once per deployment: `init` makes a
/// second call fail because the account already exists.
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// Pays rent and becomes the posting authority.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

/// `max_staleness_sec` is supplied by the caller (from `src/ecv/params.mjs`
/// `maxStalenessSec`), not hard-coded here. The oracle publishes it; it does
/// not enforce it.
pub fn handle_initialize(ctx: Context<Initialize>, max_staleness_sec: u32) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.max_staleness_sec = max_staleness_sec;
    config.bump = ctx.bumps.config;

    msg!(
        "ecv_oracle: config initialized, authority={}, max_staleness_sec={}",
        config.authority,
        config.max_staleness_sec
    );
    Ok(())
}
