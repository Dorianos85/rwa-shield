//! ECV oracle poster.
//!
//! GET /api/ecv from the running demo server -> encode -> `post_ecv` -> read
//! the record back and verify it matches what the API said.
//!
//! Usage (defaults in brackets):
//!   poster [--api http://localhost:8787] [--symbol SPYx] [--query k=v&k=v] [--live]
//!          [--cluster localnet|devnet|<http url>] [--keypair ~/.config/solana/id.json]
//!          [--init] [--max-staleness-sec 30] [--dry-run]
//!
//! `--init` creates the Config PDA if it does not exist yet (signer becomes
//! the authority). `--dry-run` fetches and encodes but sends nothing.

use anchor_client::{
    anchor_lang::{prelude::Pubkey, solana_program::system_program},
    Client, Cluster,
};
use anyhow::{anyhow, bail, Context, Result};
use poster::encode::{decode, diff_outputs, encode, Encoded, Outputs};
use solana_commitment_config::CommitmentConfig;
use solana_keypair::{read_keypair_file, Keypair};
use solana_signer::Signer;
use std::{str::FromStr, sync::Arc};

/// xStocks mints, copied verbatim from `src/data/jupiter.mjs` `MINTS`.
/// Same caveat as there: VERIFY before a live demo. On devnet these are keys
/// only - the oracle never touches the token.
const MINTS: &[(&str, &str)] = &[
    ("SPYx", "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB"),
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
            "--dry-run" => a.dry_run = true,
            "-h" | "--help" => {
                println!("{}", include_str!("main.rs").lines().take(12).map(|l| l.trim_start_matches("//! ").trim_start_matches("//!")).collect::<Vec<_>>().join("\n"));
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

    let mint_str = MINTS
        .iter()
        .find(|(s, _)| *s == args.symbol)
        .map(|(_, m)| *m)
        .ok_or_else(|| anyhow!("unknown symbol {}; known: {:?}", args.symbol, MINTS.iter().map(|m| m.0).collect::<Vec<_>>()))?;
    let mint = Pubkey::from_str(mint_str)?;

    // 1. API
    let resp = fetch_ecv(&args)?;
    println!(
        "api: params={} session={} impactPct={:.4} quoteSource={}",
        resp.params_mode.as_deref().unwrap_or("?"),
        resp.session.as_deref().unwrap_or("?"),
        resp.impact_pct.unwrap_or(f64::NAN),
        resp.quote_source.as_deref().unwrap_or("?")
    );
    println!("api outputs: {}", serde_json::to_string(&resp.outputs)?);

    // 2. Encode
    let enc = encode(&resp.outputs).context("encoding API outputs for the chain")?;
    print_encoded(&enc);

    if args.dry_run {
        println!("dry run - nothing sent");
        return Ok(());
    }

    // 3. Client
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

    // 4. Config (initialize on demand)
    match program.account::<ecv_oracle::state::Config>(config_pda) {
        Ok(cfg) => {
            println!("config {config_pda}: authority={} max_staleness_sec={}", cfg.authority, cfg.max_staleness_sec);
            if cfg.authority != payer.pubkey() {
                bail!("signer {} is not the oracle authority {}; post_ecv would fail with Unauthorized", payer.pubkey(), cfg.authority);
            }
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
        }
        Err(e) => bail!("config {config_pda} not found ({e}); run with --init to create it"),
    }

    // 5. Post
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

    // 6. Read back and verify
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
