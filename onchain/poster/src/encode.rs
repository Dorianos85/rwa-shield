//! Float <-> integer encoding between the API `outputs` and `EcvRecord`.
//!
//! The rules are fixed on `EcvRecord` in the program crate
//! (`programs/ecv_oracle/src/state.rs`); this module implements them:
//! - `max_borrow`, `collateral_cap`: USDC with 6 decimals -> `u64`
//! - `risk_premium`: fraction -> basis points `u16` (`0.0242` -> `242`)
//! - `breaker_reason`: `null | "stale_price" | "depth_floor" | "impact_extreme"` -> `u8`
//! - `liquidation_route`: UTF-8 label -> `[u8; 32]`, truncated / zero-padded

use ecv_oracle::state::EcvRecord;
use serde::{Deserialize, Serialize};
use std::fmt;

// Reason codes are owned by the program and exported in its IDL.
pub use ecv_oracle::constants::{
    BREAKER_DEPTH_FLOOR, BREAKER_IMPACT_EXTREME, BREAKER_NONE, BREAKER_STALE_PRICE,
};

/// USDC base units per dollar.
pub const USDC_SCALE: f64 = 1_000_000.0;
/// Basis points per unit.
pub const BPS_SCALE: f64 = 10_000.0;
/// Fixed width of `EcvRecord.liquidation_route`.
pub const ROUTE_LEN: usize = 32;

/// The `outputs` object exactly as `/api/ecv` returns it. Field names are the
/// frozen contract from `src/ecv/model.mjs` - do not rename.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Outputs {
    pub max_borrow: f64,
    pub collateral_cap: f64,
    pub liquidation_route: String,
    pub risk_premium: f64,
    pub borrow_disabled: bool,
    pub breaker_reason: Option<String>,
}

/// Integer form matching the `post_ecv` instruction arguments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Encoded {
    pub max_borrow: u64,
    pub collateral_cap: u64,
    pub risk_premium_bps: u16,
    pub borrow_disabled: bool,
    pub breaker_reason: u8,
    pub liquidation_route: [u8; ROUTE_LEN],
}

#[derive(Clone, Debug, PartialEq)]
pub enum EncodeError {
    NotFinite { field: &'static str },
    Negative { field: &'static str },
    Overflow { field: &'static str, max: f64 },
    UnknownBreakerReason(String),
}

impl fmt::Display for EncodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFinite { field } => write!(f, "{field}: value is NaN or infinite"),
            Self::Negative { field } => write!(f, "{field}: value is negative"),
            Self::Overflow { field, max } => write!(f, "{field}: value exceeds on-chain maximum {max}"),
            Self::UnknownBreakerReason(r) => write!(f, "breaker_reason: unknown value {r:?}"),
        }
    }
}

impl std::error::Error for EncodeError {}

pub fn encode(o: &Outputs) -> Result<Encoded, EncodeError> {
    Ok(Encoded {
        max_borrow: usd_to_units(o.max_borrow, "max_borrow")?,
        collateral_cap: usd_to_units(o.collateral_cap, "collateral_cap")?,
        risk_premium_bps: fraction_to_bps(o.risk_premium, "risk_premium")?,
        borrow_disabled: o.borrow_disabled,
        breaker_reason: breaker_reason_code(o.breaker_reason.as_deref())?,
        liquidation_route: encode_route(&o.liquidation_route),
    })
}

/// Inverse of `encode`, reading the on-chain record. `posted_at`, `posted_slot`,
/// `mint` and `bump` are not part of `outputs` and are ignored here.
pub fn decode(r: &EcvRecord) -> Outputs {
    Outputs {
        max_borrow: units_to_usd(r.max_borrow),
        collateral_cap: units_to_usd(r.collateral_cap),
        liquidation_route: decode_route(&r.liquidation_route),
        risk_premium: bps_to_fraction(r.risk_premium_bps),
        borrow_disabled: r.borrow_disabled,
        breaker_reason: breaker_reason_name(r.breaker_reason),
    }
}

/// Tolerances a round trip must meet: one USDC base unit, one basis point.
pub const USD_TOLERANCE: f64 = 1.0 / USDC_SCALE;
pub const BPS_TOLERANCE: f64 = 1.0 / BPS_SCALE;

/// Field-by-field comparison of what the API said vs. what the chain holds.
/// Empty result = match. Used by the poster to verify its own post.
pub fn diff_outputs(api: &Outputs, chain: &Outputs) -> Vec<String> {
    let mut d = Vec::new();
    let near = |a: f64, b: f64, tol: f64| (a - b).abs() <= tol;
    if !near(api.max_borrow, chain.max_borrow, USD_TOLERANCE) {
        d.push(format!("max_borrow: api {} vs chain {}", api.max_borrow, chain.max_borrow));
    }
    if !near(api.collateral_cap, chain.collateral_cap, USD_TOLERANCE) {
        d.push(format!("collateral_cap: api {} vs chain {}", api.collateral_cap, chain.collateral_cap));
    }
    if !near(api.risk_premium, chain.risk_premium, BPS_TOLERANCE) {
        d.push(format!("risk_premium: api {} vs chain {}", api.risk_premium, chain.risk_premium));
    }
    if api.borrow_disabled != chain.borrow_disabled {
        d.push(format!("borrow_disabled: api {} vs chain {}", api.borrow_disabled, chain.borrow_disabled));
    }
    if api.breaker_reason != chain.breaker_reason {
        d.push(format!("breaker_reason: api {:?} vs chain {:?}", api.breaker_reason, chain.breaker_reason));
    }
    // The chain holds at most ROUTE_LEN bytes; compare against the truncated label.
    let expected_route = decode_route(&encode_route(&api.liquidation_route));
    if expected_route != chain.liquidation_route {
        d.push(format!("liquidation_route: api {:?} vs chain {:?}", expected_route, chain.liquidation_route));
    }
    d
}

pub fn usd_to_units(x: f64, field: &'static str) -> Result<u64, EncodeError> {
    scale_to_int(x, USDC_SCALE, u64::MAX as f64, field).map(|v| v as u64)
}

pub fn units_to_usd(units: u64) -> f64 {
    units as f64 / USDC_SCALE
}

pub fn fraction_to_bps(x: f64, field: &'static str) -> Result<u16, EncodeError> {
    scale_to_int(x, BPS_SCALE, u16::MAX as f64, field).map(|v| v as u16)
}

pub fn bps_to_fraction(bps: u16) -> f64 {
    bps as f64 / BPS_SCALE
}

fn scale_to_int(x: f64, scale: f64, max: f64, field: &'static str) -> Result<f64, EncodeError> {
    if !x.is_finite() {
        return Err(EncodeError::NotFinite { field });
    }
    if x < 0.0 {
        return Err(EncodeError::Negative { field });
    }
    let scaled = (x * scale).round();
    if scaled > max {
        return Err(EncodeError::Overflow { field, max: max / scale });
    }
    Ok(scaled)
}

pub fn breaker_reason_code(reason: Option<&str>) -> Result<u8, EncodeError> {
    match reason {
        None => Ok(BREAKER_NONE),
        Some("stale_price") => Ok(BREAKER_STALE_PRICE),
        Some("depth_floor") => Ok(BREAKER_DEPTH_FLOOR),
        Some("impact_extreme") => Ok(BREAKER_IMPACT_EXTREME),
        Some(other) => Err(EncodeError::UnknownBreakerReason(other.to_string())),
    }
}

/// `None` for code 0. Unknown codes decode to `unknown_<n>` rather than
/// panicking: a reader must be able to display whatever is on chain.
pub fn breaker_reason_name(code: u8) -> Option<String> {
    match code {
        BREAKER_NONE => None,
        BREAKER_STALE_PRICE => Some("stale_price".into()),
        BREAKER_DEPTH_FLOOR => Some("depth_floor".into()),
        BREAKER_IMPACT_EXTREME => Some("impact_extreme".into()),
        other => Some(format!("unknown_{other}")),
    }
}

/// Truncates at a UTF-8 character boundary so the stored bytes always decode
/// cleanly, then zero-pads.
pub fn encode_route(label: &str) -> [u8; ROUTE_LEN] {
    let mut out = [0u8; ROUTE_LEN];
    let mut end = label.len().min(ROUTE_LEN);
    while end > 0 && !label.is_char_boundary(end) {
        end -= 1;
    }
    out[..end].copy_from_slice(&label.as_bytes()[..end]);
    out
}

pub fn decode_route(bytes: &[u8; ROUTE_LEN]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(ROUTE_LEN);
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}
