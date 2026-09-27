//! Constant-product (`x * y = k`) quotes with a bps fee charged on the inbound
//! amount. Same shape as Uniswap V2 / Raydium CP-Swap.

/// Fee and impact are in basis points; 10_000 = 100%.
pub const FEE_DENOM_BPS: u128 = 10_000;
/// Quote-currency scale. USDC is 6 decimals, so USDC raw units *are* e6 dollars.
pub const PRICE_SCALE_E6: u128 = 1_000_000;
/// One hop mint is always USDC. The other side passes its own decimals (8 for xStocks).
pub const USDC_DECIMALS: u8 = 6;
const MAX_DECIMALS: u8 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuoteError {
    ZeroAmount,
    ZeroReserve,
    FeeBpsTooHigh,
    InsufficientLiquidity,
    Overflow,
    InvalidDecimals,
}

fn checked_mul(a: u128, b: u128) -> Result<u128, QuoteError> {
    a.checked_mul(b).ok_or(QuoteError::Overflow)
}

fn checked_add(a: u128, b: u128) -> Result<u128, QuoteError> {
    a.checked_add(b).ok_or(QuoteError::Overflow)
}

/// `ceil(numer / denom)` without overflowing the intermediate.
fn ceil_div(numer: u128, denom: u128) -> Result<u128, QuoteError> {
    if denom == 0 {
        return Err(QuoteError::Overflow);
    }
    let q = numer / denom;
    if numer % denom == 0 {
        Ok(q)
    } else {
        q.checked_add(1).ok_or(QuoteError::Overflow)
    }
}

fn pow10(decimals: u8) -> Result<u128, QuoteError> {
    if decimals > MAX_DECIMALS {
        return Err(QuoteError::InvalidDecimals);
    }
    10u128
        .checked_pow(decimals as u32)
        .ok_or(QuoteError::Overflow)
}

fn require_usdc_pair(decimals_in: u8, decimals_out: u8) -> Result<(), QuoteError> {
    if decimals_in > MAX_DECIMALS || decimals_out > MAX_DECIMALS {
        return Err(QuoteError::InvalidDecimals);
    }
    if decimals_in != USDC_DECIMALS && decimals_out != USDC_DECIMALS {
        return Err(QuoteError::InvalidDecimals);
    }
    Ok(())
}

/// USDC raw (e6 dollars) per 1 whole unit of the non-USDC mint.
/// When both sides are 6 decimals, this is whole-out per whole-in × 1e6.
fn price_usdc_e6_per_whole(
    amount_in: u128,
    amount_out: u128,
    decimals_in: u8,
    decimals_out: u8,
) -> Result<u128, QuoteError> {
    require_usdc_pair(decimals_in, decimals_out)?;
    if amount_in == 0 || amount_out == 0 {
        return Err(QuoteError::ZeroAmount);
    }
    if decimals_out == USDC_DECIMALS && decimals_in != USDC_DECIMALS {
        // token → USDC: usdc_raw * 10^token_decimals / token_raw
        Ok(checked_mul(amount_out, pow10(decimals_in)?)? / amount_in)
    } else if decimals_in == USDC_DECIMALS && decimals_out != USDC_DECIMALS {
        // USDC → token: usdc_raw * 10^token_decimals / token_raw
        Ok(checked_mul(amount_in, pow10(decimals_out)?)? / amount_out)
    } else {
        // both 6: outbound raw per 1 whole inbound, already e6
        Ok(checked_mul(amount_out, PRICE_SCALE_E6)? / amount_in)
    }
}

fn check_reserves(reserve_in: u128, reserve_out: u128, fee_bps: u16) -> Result<u128, QuoteError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(QuoteError::ZeroReserve);
    }
    if (fee_bps as u128) >= FEE_DENOM_BPS {
        return Err(QuoteError::FeeBpsTooHigh);
    }
    Ok(FEE_DENOM_BPS - fee_bps as u128)
}

/// Exact-in: sell `amount_in` of the inbound side, receive outbound (floored).
pub fn quote_exact_in(
    amount_in: u128,
    reserve_in: u128,
    reserve_out: u128,
    fee_bps: u16,
) -> Result<u128, QuoteError> {
    if amount_in == 0 {
        return Err(QuoteError::ZeroAmount);
    }
    let fee_num = check_reserves(reserve_in, reserve_out, fee_bps)?;
    let after_fee = checked_mul(amount_in, fee_num)?;

    let numerator = checked_mul(after_fee, reserve_out)?;
    let denominator = checked_add(checked_mul(reserve_in, FEE_DENOM_BPS)?, after_fee)?;
    let amount_out = numerator / denominator;

    Ok(amount_out)
}

/// Exact-out: receive `amount_out` of the outbound side, pay inbound (ceiled).
pub fn quote_exact_out(
    amount_out: u128,
    reserve_in: u128,
    reserve_out: u128,
    fee_bps: u16,
) -> Result<u128, QuoteError> {
    if amount_out == 0 {
        return Err(QuoteError::ZeroAmount);
    }
    let fee_num = check_reserves(reserve_in, reserve_out, fee_bps)?;
    if amount_out >= reserve_out {
        return Err(QuoteError::InsufficientLiquidity);
    }

    // Inverse of the precision-preserving exact_in:
    //   out = (in * fee_num * reserve_out) / (reserve_in * FEE_DENOM + in * fee_num)
    // ⇒ in = ceil(reserve_in * out * FEE_DENOM / ((reserve_out - out) * fee_num))
    let numerator = checked_mul(checked_mul(reserve_in, amount_out)?, FEE_DENOM_BPS)?;
    let denominator = checked_mul(reserve_out - amount_out, fee_num)?;
    ceil_div(numerator, denominator)
}

/// Mid price in USDC e6 (USDC raw) per 1 whole unit of the other mint.
/// One of `decimals_in` / `decimals_out` must be `USDC_DECIMALS` (6).
pub fn mid_price_e6(
    reserve_in: u128,
    reserve_out: u128,
    decimals_in: u8,
    decimals_out: u8,
) -> Result<u128, QuoteError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(QuoteError::ZeroReserve);
    }
    price_usdc_e6_per_whole(reserve_in, reserve_out, decimals_in, decimals_out)
}

/// Price impact of an exact-in fill, in bps, floored.
/// Compares the fill's USDC-per-whole-token price to the pool mid. Adverse
/// deviation (sell below mid, buy above mid) is the impact; a better-than-mid
/// fill reports 0.
pub fn impact_bps_exact_in(
    amount_in: u128,
    amount_out: u128,
    reserve_in: u128,
    reserve_out: u128,
    decimals_in: u8,
    decimals_out: u8,
) -> Result<u16, QuoteError> {
    if reserve_in == 0 || reserve_out == 0 {
        return Err(QuoteError::ZeroReserve);
    }
    let exec = price_usdc_e6_per_whole(amount_in, amount_out, decimals_in, decimals_out)?;
    let mid = mid_price_e6(reserve_in, reserve_out, decimals_in, decimals_out)?;
    let token_is_in = decimals_out == USDC_DECIMALS && decimals_in != USDC_DECIMALS;
    let both_usdc = decimals_in == USDC_DECIMALS && decimals_out == USDC_DECIMALS;
    // Sell (or both-6 treated as out-per-in): worse = exec < mid.
    // Buy token with USDC: worse = exec > mid.
    let adverse = if token_is_in || both_usdc {
        mid.checked_sub(exec)
    } else {
        exec.checked_sub(mid)
    };
    let Some(delta) = adverse else {
        return Ok(0);
    };
    let bps = checked_mul(delta, FEE_DENOM_BPS)? / mid;
    u16::try_from(bps).map_err(|_| QuoteError::Overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Known-answer: Uniswap V2 getAmountOut with 30 bps, x=y=1_000_000, dx=1_000.
    // after_fee = 1000 * 9970 / 10000 = 997
    // out = 1_000_000 * 997 / (1_000_000 + 997) = 996_004_995_... / 1_000_997 = 996
    #[test]
    fn exact_in_known_answer_30bps() {
        assert_eq!(
            quote_exact_in(1_000, 1_000_000, 1_000_000, 30).unwrap(),
            996
        );
    }

    // fee=0, dx=10, x=y=1000 → 1000*10/1010 = 9 (floor)
    #[test]
    fn exact_in_zero_fee() {
        assert_eq!(quote_exact_in(10, 1_000, 1_000, 0).unwrap(), 9);
    }

    // exact_out inverse of the 30 bps vector: to receive 996,
    // in = ceil(1_000_000 * 996 * 10000 / ((1_000_000-996) * 9970))
    #[test]
    fn exact_out_known_answer_30bps() {
        let amount_in = quote_exact_out(996, 1_000_000, 1_000_000, 30).unwrap();
        assert_eq!(amount_in, 1_000);
        // Paying that much must return at least the requested out.
        assert!(quote_exact_in(amount_in, 1_000_000, 1_000_000, 30).unwrap() >= 996);
    }

    #[test]
    fn exact_out_then_exact_in_covers_the_requested_out() {
        let reserve_in = 5_000_000u128;
        let reserve_out = 8_000_000u128;
        let fee = 25u16;
        // Dust sizes (want_out=1 with a 25 bps fee) make after_fee floor to 0;
        // the cover property holds once the fill is above that floor.
        for want_out in [1_000u128, 50_000, 400_000] {
            let cost = quote_exact_out(want_out, reserve_in, reserve_out, fee).unwrap();
            let got = quote_exact_in(cost, reserve_in, reserve_out, fee).unwrap();
            assert!(
                got >= want_out,
                "paid {cost} for {want_out} but exact_in returned {got}"
            );
        }
    }

    #[test]
    fn fee_reduces_output() {
        let free = quote_exact_in(10_000, 1_000_000, 1_000_000, 0).unwrap();
        let taxed = quote_exact_in(10_000, 1_000_000, 1_000_000, 30).unwrap();
        assert!(taxed < free);
    }

    #[test]
    fn zero_amount_rejected() {
        assert_eq!(
            quote_exact_in(0, 1_000, 1_000, 0),
            Err(QuoteError::ZeroAmount)
        );
        assert_eq!(
            quote_exact_out(0, 1_000, 1_000, 0),
            Err(QuoteError::ZeroAmount)
        );
    }

    #[test]
    fn zero_reserve_rejected() {
        assert_eq!(quote_exact_in(1, 0, 1_000, 0), Err(QuoteError::ZeroReserve));
        assert_eq!(
            quote_exact_out(1, 1_000, 0, 0),
            Err(QuoteError::ZeroReserve)
        );
        assert_eq!(
            mid_price_e6(0, 1, USDC_DECIMALS, USDC_DECIMALS),
            Err(QuoteError::ZeroReserve)
        );
    }

    #[test]
    fn fee_at_or_above_100_percent_rejected() {
        assert_eq!(
            quote_exact_in(1, 1_000, 1_000, 10_000),
            Err(QuoteError::FeeBpsTooHigh)
        );
    }

    #[test]
    fn exact_out_cannot_drain_the_pool() {
        assert_eq!(
            quote_exact_out(1_000, 1_000, 1_000, 0),
            Err(QuoteError::InsufficientLiquidity)
        );
        assert_eq!(
            quote_exact_out(1_001, 1_000, 1_000, 0),
            Err(QuoteError::InsufficientLiquidity)
        );
    }

    #[test]
    fn saturating_exact_in_stays_below_reserve_out() {
        let out = quote_exact_in(1_000_000_000_000, 1_000_000, 1_000_000, 0).unwrap();
        assert!(out < 1_000_000);
        assert!(out > 0);
    }

    #[test]
    fn mid_price_e6_one_to_one() {
        assert_eq!(
            mid_price_e6(1_000, 1_000, USDC_DECIMALS, USDC_DECIMALS).unwrap(),
            PRICE_SCALE_E6
        );
    }

    #[test]
    fn mid_price_e6_two_to_one() {
        assert_eq!(
            mid_price_e6(1_000, 2_000, USDC_DECIMALS, USDC_DECIMALS).unwrap(),
            2 * PRICE_SCALE_E6
        );
    }

    #[test]
    fn mid_price_e6_token8_usdc6_is_usdc_per_whole_token() {
        // 2 whole tokens (8 dec) vs 1_546 USDC (6 dec) → $773 per token
        let token = 2 * 100_000_000u128;
        let usdc = 1_546 * 1_000_000u128;
        assert_eq!(
            mid_price_e6(token, usdc, 8, USDC_DECIMALS).unwrap(),
            773 * PRICE_SCALE_E6
        );
        // same price buying the token with USDC
        assert_eq!(
            mid_price_e6(usdc, token, USDC_DECIMALS, 8).unwrap(),
            773 * PRICE_SCALE_E6
        );
    }

    #[test]
    fn mid_price_rejects_pair_without_usdc_decimals() {
        assert_eq!(
            mid_price_e6(1_000, 1_000, 8, 9),
            Err(QuoteError::InvalidDecimals)
        );
    }

    #[test]
    fn impact_is_small_on_tiny_fill_relative_to_book() {
        let rin = 1_000_000_000u128;
        let rout = 1_000_000_000u128;
        let din = 10_000u128;
        let dout = quote_exact_in(din, rin, rout, 0).unwrap();
        assert!(dout > 0);
        // Integer floor on `out` shows up as 1 bp here; still << a 10% fill.
        assert!(impact_bps_exact_in(din, dout, rin, rout, USDC_DECIMALS, USDC_DECIMALS).unwrap() <= 1);
    }

    #[test]
    fn impact_grows_with_size() {
        let rin = 1_000_000u128;
        let rout = 1_000_000u128;
        let small = quote_exact_in(1_000, rin, rout, 0).unwrap();
        let large = quote_exact_in(100_000, rin, rout, 0).unwrap();
        let i_small =
            impact_bps_exact_in(1_000, small, rin, rout, USDC_DECIMALS, USDC_DECIMALS).unwrap();
        let i_large =
            impact_bps_exact_in(100_000, large, rin, rout, USDC_DECIMALS, USDC_DECIMALS).unwrap();
        assert!(i_large > i_small);
    }

    #[test]
    fn impact_token8_usdc6_uses_usdc_per_whole_token() {
        let token = 100 * 100_000_000u128; // 100 tokens, 8 dec
        let usdc = 77_300 * 1_000_000u128; // $77,300, 6 dec  → mid $773
        let din = 10 * 100_000_000u128;
        let dout = quote_exact_in(din, token, usdc, 0).unwrap();
        let impact = impact_bps_exact_in(din, dout, token, usdc, 8, USDC_DECIMALS).unwrap();
        assert!(impact > 0);
        // Same fill measured as raw-unit impact must match: decimals cancel in the ratio.
        let raw = {
            let exec = dout * token;
            let mid = din * usdc;
            ((mid - exec) * FEE_DENOM_BPS / mid) as u16
        };
        assert_eq!(impact, raw);
    }

    /// Vault balances of Raydium CLMM `6truu3rZ…` at slot 451000134, treated as
    /// if they were CPMM reserves. Numbers from
    /// `tests/fixtures/pools/metadata.json`. This is NOT a reproduction of the
    /// Jupiter quote — it documents that the naive CPMM reading overestimates
    /// by ~3872 bps (wrong direction for a risk system).
    #[test]
    fn jupiter_cross_check_cpmm_overestimates_clmm_vaults() {
        // deep_clmm reserves (SPYx 8 dec, USDC 6 dec)
        const RESERVE_SPYX: u128 = 178_887_088_905;
        const RESERVE_USDC: u128 = 1_934_141_178_334;
        const FEE_BPS: u16 = 10;
        // market_XsoC_SPYx_approx_10k
        const AMOUNT_IN: u128 = 1_293_600_000;
        const JUPITER_OUT: u128 = 10_000_565_104;

        assert_eq!(
            mid_price_e6(RESERVE_SPYX, RESERVE_USDC, 8, USDC_DECIMALS).unwrap(),
            1_081_207_811
        );

        let cpmm_out = quote_exact_in(AMOUNT_IN, RESERVE_SPYX, RESERVE_USDC, FEE_BPS).unwrap();
        assert_eq!(cpmm_out, 13_872_302_207);

        // Overestimate: CPMM / Jupiter ≈ 1.387
        assert!(cpmm_out > JUPITER_OUT);
        let gap_bps = (cpmm_out - JUPITER_OUT) * FEE_DENOM_BPS / JUPITER_OUT;
        assert!(
            gap_bps > 3_500 && gap_bps < 4_200,
            "expected ~3872 bps optimistic gap, got {gap_bps}"
        );
    }
}
