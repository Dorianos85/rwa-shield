use anchor_lang::prelude::*;

/// PDA seed for the single `Config` account: `["config"]`.
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

/// PDA seed prefix for `EcvRecord`: `["ecv", mint]`.
#[constant]
pub const ECV_SEED: &[u8] = b"ecv";
