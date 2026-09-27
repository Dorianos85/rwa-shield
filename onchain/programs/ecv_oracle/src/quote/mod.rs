//! Pure execution math. No Anchor, no account types.
//!
//! Callers (handlers, tests, the poster) pass reserve balances and sizes in
//! token base units. Rounding is always against the protocol: outputs floor,
//! costs ceil.

pub mod cpmm;

pub use cpmm::{
    impact_bps_exact_in, mid_price_e6, quote_exact_in, quote_exact_out, QuoteError, FEE_DENOM_BPS,
    PRICE_SCALE_E6, USDC_DECIMALS,
};
