mod common;

use {
    anchor_lang::{prelude::Pubkey, Space},
    common::*,
    solana_clock::Clock,
};

/// Anchor custom errors start at 6000; `Unauthorized` is the first variant.
const UNAUTHORIZED_CODE: &str = "Custom(6000)";

fn warp(env: &mut Env, slot: u64, unix_timestamp: i64) {
    let mut clock = env.svm.get_sysvar::<Clock>();
    clock.slot = slot;
    clock.unix_timestamp = unix_timestamp;
    env.svm.set_sysvar::<Clock>(&clock);
}

fn init_env() -> (Env, solana_keypair::Keypair) {
    let mut env = setup();
    let authority = funded_keypair(&mut env.svm);
    send_initialize(&mut env, &authority, MAX_STALENESS_SEC).unwrap();
    (env, authority)
}

#[test]
fn first_post_creates_record_stamped_by_clock() {
    let (mut env, authority) = init_env();
    let mint = Pubkey::new_unique();
    let outputs = baseline_outputs();

    // Warp the SVM clock so the program-written stamps are exactly checkable.
    warp(&mut env, 12_345, 1_790_000_000);

    send_post_ecv(&mut env, &authority, mint, &outputs).expect("first post should succeed");

    let addr = record_pda(&env.program_id, &mint).0;
    let account = env.svm.get_account(&addr).unwrap();
    assert_eq!(account.owner, env.program_id);
    assert_eq!(account.data.len(), 8 + ecv_oracle::state::EcvRecord::INIT_SPACE as usize);

    let r = read_record(&env, &mint);
    assert_eq!(r.mint, mint);
    assert_eq!(r.max_borrow, outputs.max_borrow);
    assert_eq!(r.collateral_cap, outputs.collateral_cap);
    assert_eq!(r.risk_premium_bps, outputs.risk_premium_bps);
    assert_eq!(r.borrow_disabled, outputs.borrow_disabled);
    assert_eq!(r.breaker_reason, outputs.breaker_reason);
    assert_eq!(r.liquidation_route, outputs.liquidation_route);
    assert_eq!(r.posted_slot, 12_345, "posted_slot must come from Clock");
    assert_eq!(r.posted_at, 1_790_000_000, "posted_at must come from Clock");
    assert_eq!(r.bump, record_pda(&env.program_id, &mint).1);
}

#[test]
fn second_post_overwrites_same_pda() {
    let (mut env, authority) = init_env();
    let mint = Pubkey::new_unique();

    warp(&mut env, 100, 1_000);
    send_post_ecv(&mut env, &authority, mint, &baseline_outputs()).unwrap();
    let first = read_record(&env, &mint);
    let lamports_after_first = env.svm.get_account(&record_pda(&env.program_id, &mint).0).unwrap().lamports;

    // The stage step-2 scenario: weekend + thin book trips the breaker.
    let breaker = Outputs {
        max_borrow: 0,
        borrow_disabled: true,
        breaker_reason: 3, // impact_extreme
        liquidation_route: route("offline:synthetic-curve"),
        ..baseline_outputs()
    };
    warp(&mut env, 250, 1_060);
    send_post_ecv(&mut env, &authority, mint, &breaker).unwrap();

    let second = read_record(&env, &mint);
    assert_eq!(second.mint, mint);
    assert_eq!(second.max_borrow, 0);
    assert!(second.borrow_disabled);
    assert_eq!(second.breaker_reason, 3);
    assert_eq!(second.liquidation_route, route("offline:synthetic-curve"));
    assert_eq!(second.collateral_cap, first.collateral_cap, "unchanged fields carry over");
    assert!(second.posted_slot >= first.posted_slot, "posted_slot must not go backwards");
    assert_eq!(second.posted_slot, 250);
    assert_eq!(second.posted_at, 1_060);

    // Same account, no second rent payment: init_if_needed did not re-create it.
    let lamports_after_second = env.svm.get_account(&record_pda(&env.program_id, &mint).0).unwrap().lamports;
    assert_eq!(lamports_after_first, lamports_after_second);
}

#[test]
fn post_from_non_authority_is_rejected() {
    let (mut env, _authority) = init_env();
    let intruder = funded_keypair(&mut env.svm);
    let mint = Pubkey::new_unique();

    let err = send_post_ecv(&mut env, &intruder, mint, &baseline_outputs())
        .expect_err("non-authority must not be able to post");
    println!("intruder rejected with: {err}");
    assert!(err.contains(UNAUTHORIZED_CODE), "expected Unauthorized (6000), got {err}");

    assert!(
        env.svm.get_account(&record_pda(&env.program_id, &mint).0).is_none(),
        "no record must be created on a rejected post"
    );
}

#[test]
fn different_mints_get_different_records() {
    let (mut env, authority) = init_env();
    let spyx = Pubkey::new_unique();
    let qqqx = Pubkey::new_unique();

    let spyx_pda = record_pda(&env.program_id, &spyx).0;
    let qqqx_pda = record_pda(&env.program_id, &qqqx).0;
    assert_ne!(spyx_pda, qqqx_pda);

    send_post_ecv(&mut env, &authority, spyx, &baseline_outputs()).unwrap();
    let qqqx_outputs = Outputs { max_borrow: 50_000_000_000, ..baseline_outputs() };
    send_post_ecv(&mut env, &authority, qqqx, &qqqx_outputs).unwrap();

    let a = read_record(&env, &spyx);
    let b = read_record(&env, &qqqx);
    assert_eq!(a.mint, spyx);
    assert_eq!(b.mint, qqqx);
    assert_eq!(a.max_borrow, 77_322_000_000);
    assert_eq!(b.max_borrow, 50_000_000_000, "records are independent");
}
