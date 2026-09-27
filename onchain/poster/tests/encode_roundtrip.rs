use ecv_oracle::state::EcvRecord;
use poster::encode::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
struct Case {
    name: String,
    outputs: Outputs,
}

fn fixture() -> Fixture {
    let raw = include_str!("fixtures/ecv_outputs.json");
    serde_json::from_str(raw).expect("fixture must parse")
}

/// Builds the on-chain record the program would write for these encoded
/// values, so `decode` is exercised on the real type.
fn as_record(e: &Encoded) -> EcvRecord {
    EcvRecord {
        mint: Default::default(),
        max_borrow: e.max_borrow,
        collateral_cap: e.collateral_cap,
        risk_premium_bps: e.risk_premium_bps,
        borrow_disabled: e.borrow_disabled,
        breaker_reason: e.breaker_reason,
        liquidation_route: e.liquidation_route,
        posted_at: 0,
        posted_slot: 0,
        bump: 0,
    }
}

#[test]
fn diff_outputs_is_empty_on_round_trip_and_names_changed_fields() {
    let fx = fixture();
    for case in &fx.cases {
        let back = decode(&as_record(&encode(&case.outputs).unwrap()));
        assert!(diff_outputs(&case.outputs, &back).is_empty(), "{}", case.name);
    }
    let api = &fx.cases[0].outputs;
    let mut tampered = api.clone();
    tampered.max_borrow += 1.0;
    tampered.borrow_disabled = !tampered.borrow_disabled;
    let d = diff_outputs(api, &tampered);
    assert_eq!(d.len(), 2, "{d:?}");
    assert!(d[0].starts_with("max_borrow"));
    assert!(d[1].starts_with("borrow_disabled"));
}

#[test]
fn fixtures_round_trip_within_tolerance() {
    let fx = fixture();
    assert!(fx.cases.len() >= 2, "need at least the regular and breaker cases");

    for case in &fx.cases {
        let enc = encode(&case.outputs).unwrap_or_else(|e| panic!("{}: encode failed: {e}", case.name));
        let back = decode(&as_record(&enc));
        println!("{}: {:?} -> {:?}", case.name, case.outputs, enc);

        assert!(
            (back.max_borrow - case.outputs.max_borrow).abs() < USD_TOLERANCE,
            "{}: max_borrow {} != {}", case.name, back.max_borrow, case.outputs.max_borrow
        );
        assert!(
            (back.collateral_cap - case.outputs.collateral_cap).abs() < USD_TOLERANCE,
            "{}: collateral_cap", case.name
        );
        assert!(
            (back.risk_premium - case.outputs.risk_premium).abs() < BPS_TOLERANCE,
            "{}: risk_premium {} != {}", case.name, back.risk_premium, case.outputs.risk_premium
        );
        assert_eq!(back.borrow_disabled, case.outputs.borrow_disabled, "{}", case.name);
        assert_eq!(back.breaker_reason, case.outputs.breaker_reason, "{}", case.name);
        assert_eq!(back.liquidation_route, case.outputs.liquidation_route, "{}", case.name);
    }
}

#[test]
fn fixture_regular_case_encodes_to_expected_integers() {
    let fx = fixture();
    let case = fx.cases.iter().find(|c| c.name == "regular_session_gate_open").unwrap();
    let enc = encode(&case.outputs).unwrap();
    assert_eq!(enc.max_borrow, 68_730_430_000, "68730.43 USD in 1e-6 units");
    assert_eq!(enc.collateral_cap, 296_400_000_000);
    assert_eq!(enc.risk_premium_bps, 242, "0.0242 -> 242 bps");
    assert!(!enc.borrow_disabled);
    assert_eq!(enc.breaker_reason, BREAKER_NONE);
}

#[test]
fn fixture_breaker_case_encodes_to_expected_integers() {
    let fx = fixture();
    let case = fx.cases.iter().find(|c| c.name == "weekend_thin_book_breaker").unwrap();
    let enc = encode(&case.outputs).unwrap();
    assert_eq!(enc.max_borrow, 0);
    assert_eq!(enc.collateral_cap, 134_257_500_000);
    assert_eq!(enc.risk_premium_bps, 1089);
    assert!(enc.borrow_disabled);
    assert_eq!(enc.breaker_reason, BREAKER_IMPACT_EXTREME);
}

#[test]
fn all_breaker_reasons_round_trip() {
    let names = [None, Some("stale_price"), Some("depth_floor"), Some("impact_extreme")];
    let codes = [BREAKER_NONE, BREAKER_STALE_PRICE, BREAKER_DEPTH_FLOOR, BREAKER_IMPACT_EXTREME];
    for (name, code) in names.iter().zip(codes) {
        assert_eq!(breaker_reason_code(*name).unwrap(), code);
        assert_eq!(breaker_reason_name(code), name.map(str::to_string));
    }
    assert_eq!(
        breaker_reason_code(Some("solar_flare")),
        Err(EncodeError::UnknownBreakerReason("solar_flare".into()))
    );
    assert_eq!(breaker_reason_name(200), Some("unknown_200".into()));
}

#[test]
fn route_shorter_than_32_is_zero_padded_and_round_trips() {
    let enc = encode_route("jupiter:best");
    assert_eq!(&enc[..12], b"jupiter:best");
    assert!(enc[12..].iter().all(|&b| b == 0));
    assert_eq!(decode_route(&enc), "jupiter:best");
}

#[test]
fn route_longer_than_32_is_truncated() {
    let long = "jupiter:raydium>orca>meteora>phoenix>lifinity";
    assert!(long.len() > ROUTE_LEN);
    let enc = encode_route(long);
    assert_eq!(decode_route(&enc), &long[..ROUTE_LEN]);
}

#[test]
fn route_truncation_respects_utf8_boundaries() {
    // 30 ASCII bytes + 'ł' (2 bytes) would split the character at byte 32.
    let label = format!("{}ł", "a".repeat(31));
    let enc = encode_route(&label);
    assert_eq!(decode_route(&enc), "a".repeat(31), "partial multibyte char must be dropped");
}

#[test]
fn negative_nan_and_infinite_are_rejected() {
    let base = Outputs {
        max_borrow: 1.0,
        collateral_cap: 1.0,
        liquidation_route: "x".into(),
        risk_premium: 0.01,
        borrow_disabled: false,
        breaker_reason: None,
    };
    let neg = Outputs { max_borrow: -0.01, ..base.clone() };
    assert_eq!(encode(&neg), Err(EncodeError::Negative { field: "max_borrow" }));

    let nan = Outputs { collateral_cap: f64::NAN, ..base.clone() };
    assert_eq!(encode(&nan), Err(EncodeError::NotFinite { field: "collateral_cap" }));

    let inf = Outputs { risk_premium: f64::INFINITY, ..base.clone() };
    assert_eq!(encode(&inf), Err(EncodeError::NotFinite { field: "risk_premium" }));
}

#[test]
fn values_beyond_on_chain_width_are_rejected() {
    let base = Outputs {
        max_borrow: 1.0,
        collateral_cap: 1.0,
        liquidation_route: "x".into(),
        risk_premium: 0.01,
        borrow_disabled: false,
        breaker_reason: None,
    };
    // u16 bps caps risk_premium at 655.35%.
    let big_premium = Outputs { risk_premium: 7.0, ..base.clone() };
    assert!(matches!(encode(&big_premium), Err(EncodeError::Overflow { field: "risk_premium", .. })));
    assert!(encode(&Outputs { risk_premium: 6.5535, ..base.clone() }).is_ok());

    // u64 USDC units cap at ~1.8e13 USD.
    let big_usd = Outputs { max_borrow: 1e14, ..base.clone() };
    assert!(matches!(encode(&big_usd), Err(EncodeError::Overflow { field: "max_borrow", .. })));
}

#[test]
fn rounding_is_to_nearest_unit() {
    // 0.0000005 USD is exactly half a unit; either way it must not drift by more than one unit.
    assert_eq!(usd_to_units(0.000001, "x").unwrap(), 1);
    assert_eq!(usd_to_units(68730.43, "x").unwrap(), 68_730_430_000);
    assert_eq!(fraction_to_bps(0.0242, "x").unwrap(), 242);
    assert_eq!(fraction_to_bps(0.10894, "x").unwrap(), 1089);
}
