mod common;

use {
    anchor_lang::Space,
    common::*,
    solana_signer::Signer,
};

#[test]
fn initialize_creates_config_with_signer_as_authority() {
    let mut env = setup();
    let authority = funded_keypair(&mut env.svm);

    send_initialize(&mut env, &authority, MAX_STALENESS_SEC).expect("initialize should succeed");

    let account = env.svm.get_account(&env.config).expect("config account must exist");
    assert_eq!(account.owner, env.program_id, "config must be owned by the program");
    assert_eq!(
        account.data.len(),
        8 + ecv_oracle::state::Config::INIT_SPACE as usize,
        "account size = discriminator + INIT_SPACE"
    );

    let state = read_config(&env);
    assert_eq!(state.authority, authority.pubkey());
    assert_eq!(state.max_staleness_sec, MAX_STALENESS_SEC);
    assert_eq!(
        state.bump,
        config_pda(&env.program_id).1,
        "stored bump must be the canonical one"
    );
}

#[test]
fn initialize_twice_fails() {
    let mut env = setup();
    let first = funded_keypair(&mut env.svm);
    let second = funded_keypair(&mut env.svm);

    send_initialize(&mut env, &first, MAX_STALENESS_SEC).unwrap();

    // Different signer => different tx bytes, so this is rejected by the
    // program's `init` constraint, not by the duplicate-transaction filter.
    let err = send_initialize(&mut env, &second, 60).expect_err("second initialize must fail");
    println!("second initialize rejected with: {err}");

    // Original config is untouched.
    let state = read_config(&env);
    assert_eq!(state.authority, first.pubkey());
    assert_eq!(state.max_staleness_sec, MAX_STALENESS_SEC);
}
