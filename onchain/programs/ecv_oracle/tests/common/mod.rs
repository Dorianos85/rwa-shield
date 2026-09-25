//! Shared LiteSVM helpers for the ecv_oracle integration tests.
#![allow(dead_code)]

use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

/// Same value as `maxStalenessSec` in `src/ecv/params.mjs`. Passed in by the
/// caller on purpose: the program has no opinion about it.
pub const MAX_STALENESS_SEC: u32 = 30;

pub struct Env {
    pub svm: LiteSVM,
    pub program_id: Pubkey,
    pub config: Pubkey,
}

pub fn setup() -> Env {
    let program_id = ecv_oracle::id();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/ecv_oracle.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    let config = config_pda(&program_id).0;
    Env { svm, program_id, config }
}

pub fn config_pda(program_id: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ecv_oracle::constants::CONFIG_SEED], program_id)
}

pub fn record_pda(program_id: &Pubkey, mint: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[ecv_oracle::constants::ECV_SEED, mint.as_ref()], program_id)
}

pub fn funded_keypair(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 1_000_000_000).unwrap();
    kp
}

pub fn send(env: &mut Env, ix: Instruction, signer: &Keypair) -> Result<(), String> {
    let blockhash = env.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    env.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{:?}", e.err))
}

pub fn send_initialize(env: &mut Env, authority: &Keypair, max_staleness_sec: u32) -> Result<(), String> {
    let ix = Instruction::new_with_bytes(
        env.program_id,
        &ecv_oracle::instruction::Initialize { max_staleness_sec }.data(),
        ecv_oracle::accounts::Initialize {
            authority: authority.pubkey(),
            config: env.config,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(env, ix, authority)
}

/// Plain-data mirror of the `post_ecv` arguments, so tests can build variants
/// with struct-update syntax.
#[derive(Clone, Debug, PartialEq)]
pub struct Outputs {
    pub max_borrow: u64,
    pub collateral_cap: u64,
    pub risk_premium_bps: u16,
    pub borrow_disabled: bool,
    pub breaker_reason: u8,
    pub liquidation_route: [u8; 32],
}

pub fn route(label: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    let bytes = label.as_bytes();
    let n = bytes.len().min(32);
    out[..n].copy_from_slice(&bytes[..n]);
    out
}

/// Values from the stage baseline in DEMO_RUNBOOK.md: $77,322 max borrow on
/// a $100k position, 2% base premium, gate open.
pub fn baseline_outputs() -> Outputs {
    Outputs {
        max_borrow: 77_322_000_000,
        collateral_cap: 296_400_000_000,
        risk_premium_bps: 200,
        borrow_disabled: false,
        breaker_reason: 0,
        liquidation_route: route("jupiter:best"),
    }
}

pub fn send_post_ecv(env: &mut Env, authority: &Keypair, mint: Pubkey, o: &Outputs) -> Result<(), String> {
    let record = record_pda(&env.program_id, &mint).0;
    let ix = Instruction::new_with_bytes(
        env.program_id,
        &ecv_oracle::instruction::PostEcv {
            mint,
            max_borrow: o.max_borrow,
            collateral_cap: o.collateral_cap,
            risk_premium_bps: o.risk_premium_bps,
            borrow_disabled: o.borrow_disabled,
            breaker_reason: o.breaker_reason,
            liquidation_route: o.liquidation_route,
        }
        .data(),
        ecv_oracle::accounts::PostEcv {
            authority: authority.pubkey(),
            config: env.config,
            record,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(env, ix, authority)
}

pub fn read_config(env: &Env) -> ecv_oracle::state::Config {
    let mut data: &[u8] = &env.svm.get_account(&env.config).expect("config must exist").data;
    ecv_oracle::state::Config::try_deserialize(&mut data).unwrap()
}

pub fn read_record(env: &Env, mint: &Pubkey) -> ecv_oracle::state::EcvRecord {
    let addr = record_pda(&env.program_id, mint).0;
    let mut data: &[u8] = &env.svm.get_account(&addr).expect("record must exist").data;
    ecv_oracle::state::EcvRecord::try_deserialize(&mut data).unwrap()
}
