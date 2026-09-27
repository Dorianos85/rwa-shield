//! ECV oracle poster.
//!
//! GET /api/ecv from the running demo server -> encode -> `post_ecv` -> read
//! the record back and verify it matches what the API said.
//!
//! Usage (defaults in brackets):
//!   poster [--api http://localhost:8787] [--symbol SPYx] [--query k=v&k=v] [--live]
//!          [--cluster localnet|devnet|<http url>] [--keypair ~/.config/solana/id.json]
//!          [--init] [--max-staleness-sec 30] [--every-sec N] [--dry-run]
//!
//! `--every-sec N` repeats the post every N seconds (Ctrl-C to stop) so
//! `posted_at` stays inside `max_staleness_sec`. N must be shorter than that
//! TTL. `--init` creates the Config PDA if it does not exist yet (signer
//! becomes the authority). `--dry-run` fetches and encodes but sends nothing.

use anchor_client::{
    anchor_lang::{prelude::Pubkey, solana_program::system_program},
    Client, Cluster,
};
use anyhow::{anyhow, bail, Context, Result};
use poster::encode::{decode, diff_outputs, encode, Encoded, Outputs};
use solana_commitment_config::CommitmentConfig;
use solana_keypair::{read_keypair_file, Keypair};
use solana_signer::Signer;
use std::{str::FromStr, sync::Arc, time::Duration};

/// xStocks mints, copied verbatim from `src/data/jupiter.mjs` `MINTS`.
/// Same caveat as there: VERIFY before a live demo. On devnet these are keys
/// only - the oracle never touches the token.
const MINTS: &[(&str, &str)] = &[
    ("SPYx", "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W"),
    ("QQQx", "XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1"),
    ("NVDAx", "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh"),
];

struct Args {
    api: String,
    symbol: String,
    query: String,
    live: bool,
    cluster: String,
    keypair: String,
    init: bool,
    max_staleness_sec: u32,
    every_sec: Option<u64>,
    dry_run: bool,
}

fn parse_args() -> Result<Args> {
    let mut a = Args {
        api: "http://localhost:8787".into(),
        symbol: "SPYx".into(),
        query: String::new(),
        live: false,
        cluster: "localnet".into(),
        keypair: shellexpand_home("~/.config/solana/id.json"),
        init: false,
        // Same default as `maxStalenessSec` in src/ecv/params.mjs; override with the flag.
        max_staleness_sec: 30,
        every_sec: None,
        dry_run: false,
    };
    let mut it = std::env::args().skip(1);
    while let Some(flag) = it.next() {
        let mut val = |name: &str| it.next().ok_or_else(|| anyhow!("{name} needs a value"));
        match flag.as_str() {
            "--api" => a.api = val("--api")?,
            "--symbol" => a.symbol = val("--symbol")?,
            "--query" => a.query = val("--query")?,
            "--live" => a.live = true,
            "--cluster" => a.cluster = val("--cluster")?,
            "--keypair" => a.keypair = shellexpand_home(&val("--keypair")?),
            "--init" => a.init = true,
            "--max-staleness-sec" => a.max_staleness_sec = val("--max-staleness-sec")?.parse()?,
            "--every-sec" => {
                let n: u64 = val("--every-sec")?.parse()?;
                if n == 0 {
                    bail!("--every-sec must be greater than 0");
                }
                a.every_sec = Some(n);
            }
            "--dry-run" => a.dry_run = true,
            "-h" | "--help" => {
                println!("{}", include_str!("main.rs").lines().take(14).map(|l| l.trim_start_matches("//! ").trim_start_matches("//!")).collect::<Vec<_>>().join("\n"));
                std::process::exit(0);
            }
            other => bail!("unknown flag {other}"),
        }
    }
    Ok(a)
}

fn shellexpand_home(p: &str) -> String {
    match (p.strip_prefix("~/"), std::env::var("HOME")) {
        (Some(rest), Ok(home)) => format!("{home}/{rest}"),
        _ => p.to_string(),
    }
}

/// The subset of the `/api/ecv` response the poster needs. Extra fields are ignored.
#[derive(serde::Deserialize, Debug)]
struct EcvResponse {
    outputs: Outputs,
    #[serde(default)]
    session: Option<String>,
    #[serde(rename = "impactPct", default)]
    impact_pct: Option<f64>,
    #[serde(rename = "paramsMode", default)]
    params_mode: Option<String>,
    #[serde(rename = "quoteSource", default)]
    quote_source: Option<String>,
}

fn fetch_ecv(args: &Args) -> Result<EcvResponse> {
    let mut url = format!("{}/api/ecv?symbol={}", args.api.trim_end_matches('/'), args.symbol);
    if !args.query.is_empty() {
        url.push('&');
        url.push_str(&args.query);
    }
    if args.live {
        url.push_str("&live=1");
    }
    println!("GET {url}");
    let resp = reqwest::blocking::get(&url).with_context(|| format!("GET {url} failed - is `node src/api/server.mjs` running?"))?;
    if !resp.status().is_success() {
        bail!("API returned HTTP {}", resp.status());
    }
    Ok(resp.json::<EcvResponse>().context("API response did not match the expected shape")?)
}

fn print_encoded(e: &Encoded) {
    println!(
        "encoded: max_borrow={} collateral_cap={} risk_premium_bps={} borrow_disabled={} breaker_reason={} route={:?}",
        e.max_borrow,
        e.collateral_cap,
        e.risk_premium_bps,
        e.borrow_disabled,
        e.breaker_reason,
        poster::encode::decode_route(&e.liquidation_route)
    );
}

fn main() -> Result<()> {
    let args = parse_args()?;
    if args.dry_run && args.every_sec.is_some() {
        bail!("--dry-run sends nothing, so --every-sec does not apply");
    }

    let mint_str = MINTS
        .iter()
        .find(|(s, _)| *s == args.symbol)
        .map(|(_, m)| *m)
        .ok_or_else(|| anyhow!("unknown symbol {}; known: {:?}", args.symbol, MINTS.iter().map(|m| m.0).collect::<Vec<_>>()))?;
    let mint = Pubkey::from_str(mint_str)?;

    if args.dry_run {
        fetch_and_encode(&args)?;
        println!("dry run - nothing sent");
        return Ok(());
    }

    let payer: Arc<Keypair> = Arc::new(
        read_keypair_file(&args.keypair).map_err(|e| anyhow!("reading keypair {}: {e}", args.keypair))?,
    );
    let cluster = Cluster::from_str(&args.cluster).map_err(|e| anyhow!("{e}"))?;
    println!("cluster: {} ({}) signer: {}", args.cluster, cluster.url(), payer.pubkey());
    let client = Client::new_with_options(cluster, payer.clone(), CommitmentConfig::confirmed());
    let program_id = ecv_oracle::id();
    let program = client.program(program_id)?;
    println!("program: {program_id}");

    let (config_pda, _) = Pubkey::find_program_address(&[ecv_oracle::constants::CONFIG_SEED], &program_id);
    let (record_pda, _) = Pubkey::find_program_address(&[ecv_oracle::constants::ECV_SEED, mint.as_ref()], &program_id);

    let staleness = ensure_config(&program, payer.as_ref(), &args, config_pda)?;

    let once = || publish(&program, payer.as_ref(), &args, mint, config_pda, record_pda);

    match args.every_sec {
        None => once(),
        Some(every) => {
            if every >= u64::from(staleness) {
                eprintln!(
                    "warning: --every-sec {every} is not shorter than max_staleness_sec {staleness}; consumers will treat the record as stale between posts"
                );
            }
            println!("periodic update every {every}s (max_staleness_sec={staleness}); Ctrl-C to stop");
            loop {
                if let Err(e) = once() {
                    eprintln!("post failed: {e:#}");
                }
                println!("sleeping {every}s");
                std::thread::sleep(Duration::from_secs(every));
            }
        }
    }
}

fn fetch_and_encode(args: &Args) -> Result<(EcvResponse, Encoded)> {
    let resp = fetch_ecv(args)?;
    println!(
        "api: params={} session={} impactPct={:.4} quoteSource={}",
        resp.params_mode.as_deref().unwrap_or("?"),
        resp.session.as_deref().unwrap_or("?"),
        resp.impact_pct.unwrap_or(f64::NAN),
        resp.quote_source.as_deref().unwrap_or("?")
    );
    println!("api outputs: {}", serde_json::to_string(&resp.outputs)?);
    let enc = encode(&resp.outputs).context("encoding API outputs for the chain")?;
    print_encoded(&enc);
    Ok((resp, enc))
}

fn ensure_config(program: &anchor_client::Program<Arc<Keypair>>, payer: &Keypair, args: &Args, config_pda: Pubkey) -> Result<u32> {
    match program.account::<ecv_oracle::state::Config>(config_pda) {
        Ok(cfg) => {
            println!("config {config_pda}: authority={} max_staleness_sec={}", cfg.authority, cfg.max_staleness_sec);
            if cfg.authority != payer.pubkey() {
                bail!("signer {} is not the oracle authority {}; post_ecv would fail with Unauthorized", payer.pubkey(), cfg.authority);
            }
            Ok(cfg.max_staleness_sec)
        }
        Err(_) if args.init => {
            println!("config {config_pda} missing - initializing with max_staleness_sec={}", args.max_staleness_sec);
            let sig = program
                .request()
                .accounts(ecv_oracle::accounts::Initialize {
                    authority: payer.pubkey(),
                    config: config_pda,
                    system_program: system_program::ID,
                })
                .args(ecv_oracle::instruction::Initialize { max_staleness_sec: args.max_staleness_sec })
                .send()
                .context("initialize failed")?;
            println!("initialize tx: {sig}");
            Ok(args.max_staleness_sec)
        }
        Err(e) => bail!("config {config_pda} not found ({e}); run with --init to create it"),
    }
}

fn publish(
    program: &anchor_client::Program<Arc<Keypair>>,
    payer: &Keypair,
    args: &Args,
    mint: Pubkey,
    config_pda: Pubkey,
    record_pda: Pubkey,
) -> Result<()> {
    let (resp, enc) = fetch_and_encode(args)?;

    let sig = program
        .request()
        .accounts(ecv_oracle::accounts::PostEcv {
            authority: payer.pubkey(),
            config: config_pda,
            record: record_pda,
            system_program: system_program::ID,
        })
        .args(ecv_oracle::instruction::PostEcv {
            mint,
            max_borrow: enc.max_borrow,
            collateral_cap: enc.collateral_cap,
            risk_premium_bps: enc.risk_premium_bps,
            borrow_disabled: enc.borrow_disabled,
            breaker_reason: enc.breaker_reason,
            liquidation_route: enc.liquidation_route,
        })
        .send()
        .context("post_ecv failed")?;
    println!("post_ecv tx: {sig}");

    let record = program.account::<ecv_oracle::state::EcvRecord>(record_pda).context("reading record back")?;
    let chain = decode(&record);
    println!("record {record_pda}: mint={} posted_slot={} posted_at={}", record.mint, record.posted_slot, record.posted_at);
    println!("chain outputs: {}", serde_json::to_string(&chain)?);

    if record.mint != mint {
        bail!("record.mint {} != {}", record.mint, mint);
    }
    let diff = diff_outputs(&resp.outputs, &chain);
    if diff.is_empty() {
        println!("VERIFY OK: on-chain record matches API outputs");
        Ok(())
    } else {
        for d in &diff {
            eprintln!("MISMATCH {d}");
        }
        bail!("{} field(s) differ", diff.len())
    }
}
