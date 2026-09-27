use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Signer is not the configured oracle authority")]
    Unauthorized,
    #[msg("allowed_amm_count must be in 1..=MAX_ALLOWED_AMM_PROGRAMS")]
    EmptyAmmWhitelist,
}
