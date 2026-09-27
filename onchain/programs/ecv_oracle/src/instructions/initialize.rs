use anchor_lang::prelude::*;

use crate::{
    constants::{CONFIG_SEED, MAX_ALLOWED_AMM_PROGRAMS},
    error::ErrorCode,
    state::Config,
};

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

/// Every bound is supplied by the caller. The program stores them; it does
/// not invent them.
#[allow(clippy::too_many_arguments)]
pub fn handle_initialize(
    ctx: Context<Initialize>,
    max_staleness_sec: u32,
    usdc_mint: Pubkey,
    allowed_amm_programs: [Pubkey; MAX_ALLOWED_AMM_PROGRAMS as usize],
    allowed_amm_count: u8,
    max_route_staleness_sec: u32,
    min_vault_balance_usdc: u64,
) -> Result<()> {
    require!(
        allowed_amm_count >= 1 && allowed_amm_count <= MAX_ALLOWED_AMM_PROGRAMS,
        ErrorCode::EmptyAmmWhitelist
    );
    for i in 0..allowed_amm_count as usize {
        require!(
            allowed_amm_programs[i] != Pubkey::default(),
            ErrorCode::EmptyAmmWhitelist
        );
    }

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.max_staleness_sec = max_staleness_sec;
    config.usdc_mint = usdc_mint;
    config.allowed_amm_programs = allowed_amm_programs;
    config.allowed_amm_count = allowed_amm_count;
    config.max_route_staleness_sec = max_route_staleness_sec;
    config.min_vault_balance_usdc = min_vault_balance_usdc;
    config.bump = ctx.bumps.config;

    msg!(
        "ecv_oracle: config initialized, authority={}, max_staleness_sec={}, usdc={}, amm_count={}",
        config.authority,
        config.max_staleness_sec,
        config.usdc_mint,
        config.allowed_amm_count
    );
    Ok(())
}
