use anchor_lang::prelude::*;

/// PDA seed for the single `Config` account: `["config"]`.
#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

/// PDA seed prefix for `EcvRecord`: `["ecv", mint]`.
#[constant]
pub const ECV_SEED: &[u8] = b"ecv";

/// Length of `Config.allowed_amm_programs`. Set at `initialize`; never a
/// literal in a handler.
#[constant]
pub const MAX_ALLOWED_AMM_PROGRAMS: u8 = 4;

// `EcvRecord.breaker_reason` codes. Mirror `breakerTerm()` in
// `src/ecv/model.mjs`; exported to the IDL so integrators need no side table.

/// Breaker not tripped (`breaker_reason: null` in the API).
#[constant]
pub const BREAKER_NONE: u8 = 0;
/// Price feed older than `maxStalenessSec`.
#[constant]
pub const BREAKER_STALE_PRICE: u8 = 1;
/// Routable depth below `depthFloorUsd`.
#[constant]
pub const BREAKER_DEPTH_FLOOR: u8 = 2;
/// Route impact above `2 * maxImpactPct`.
#[constant]
pub const BREAKER_IMPACT_EXTREME: u8 = 3;
