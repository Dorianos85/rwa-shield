#!/usr/bin/env node
/**
 * Builds the static, snapshot-only Kamino × xStocks Risk Lab into docs/risk/
 * (served by GitHub Pages from main:/docs). Zero dependencies.
 *
 *   node scripts/export-static.mjs
 *
 * What it does:
 * - Forces offline mode (RISK_OFFLINE=1): Kamino data comes only from
 *   data/kamino.snapshot.json; no network request is made.
 * - Pins the evaluation clock to the snapshot capture time, so source ages,
 *   market session and the output files are deterministic ("as at capture").
 * - Calls the same /api handlers the local server uses (src/api/riskRoutes.mjs)
 *   and writes their JSON responses to docs/risk/data/.
 * - AMM execution uses the explicit synthetic sandbox curve. The Jupiter quote
 *   ladder measured on 27.09.2026 was held only in server memory and is not in
 *   the repo, so it cannot be replayed here. If a recorded ladder is added later,
 *   extend EXECUTION_MODES and the banner below.
 * - Copies the browser UI (web/risk*) and the pure model (src/risk, src/ecv)
 *   and rewrites absolute paths so the page works under /rwa-shield/risk/.
 */
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';

process.env.RISK_OFFLINE = '1';
const ROOT = new URL('../', import.meta.url);
const OUT = new URL('docs/risk/', ROOT);
const snapshot = JSON.parse((await readFile(new URL('data/kamino.snapshot.json', ROOT), 'utf8')).replace(/^\uFEFF/, ''));
const CAPTURED_AT = snapshot.capturedAt;
const captureMs = Date.parse(CAPTURED_AT);
if (!Number.isFinite(captureMs)) throw new Error('Snapshot capturedAt is missing or invalid');
Date.now = () => captureMs; // pin the clock before any adapter reads it

const { handleRiskRequest } = await import('../src/api/riskRoutes.mjs');
const { DEFAULT_PARAMS } = await import('../src/ecv/params.mjs');

const EXECUTION_MODES = ['synthetic'];
const warsaw = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const fmt = ms => { const p = Object.fromEntries(warsaw.formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.day}.${p.month}.${p.year} ${p.hour}:${p.minute}`; };
const CAPTURE_LABEL = fmt(captureMs);

async function call(path) {
  const url = new URL(path, 'http://localhost');
  let status = 0, body = '';
  const res = { writeHead: code => { status = code; }, end: chunk => { body = String(chunk); } };
  const handled = await handleRiskRequest({ method: 'GET' }, res, url, DEFAULT_PARAMS);
  if (!handled) throw new Error(`Route not handled: ${path}`);
  if (status !== 200) throw new Error(`${path} -> ${status} ${body}`);
  return JSON.parse(body);
}

const safe = value => String(value).replace(/[^A-Za-z0-9]/g, '');
await rm(OUT, { recursive: true, force: true });
for (const dir of ['data/baseline/', 'web/assets/', 'src/risk/', 'src/ecv/']) await mkdir(new URL(dir, OUT), { recursive: true });

const write = (rel, data) => writeFile(new URL(rel, OUT), JSON.stringify(data, null, 1) + '\n');
const markets = await call('/api/kamino/markets?offline=1');
if (!markets.markets?.length) throw new Error('No markets in snapshot');
await write('data/markets.json', markets);
let count = 0;
for (const market of markets.markets) {
  for (const reserve of market.reserves || []) {
    for (const execution of EXECUTION_MODES) {
      const q = new URLSearchParams({ market: market.address, symbol: reserve.symbol, offline: '1', execution, notional: '100000' });
      const baseline = await call('/api/risk/baseline?' + q);
      await write(`data/baseline/${safe(market.address)}-${safe(reserve.symbol)}-${safe(execution)}.json`, baseline);
      count++;
    }
  }
}

// Browser code: copied verbatim except for absolute asset paths.
for (const f of ['risk.js', 'risk-chart.js']) await copyFile(new URL(`web/${f}`, ROOT), new URL(`web/${f}`, OUT));
for (const f of ['risk.css', 'risk-brand.css']) {
  const css = await readFile(new URL(`web/${f}`, ROOT), 'utf8');
  await writeFile(new URL(`web/${f}`, OUT), css.replaceAll("url('/web/assets/", "url('assets/"));
}
for (const f of ['rwa-shield-logo.jpg', 'rwa-shield-banner.jpg']) await copyFile(new URL(`web/assets/${f}`, ROOT), new URL(`web/assets/${f}`, OUT));
await copyFile(new URL('src/risk/kaminoRisk.mjs', ROOT), new URL('src/risk/kaminoRisk.mjs', OUT));
for (const f of ['model.mjs', 'params.mjs']) await copyFile(new URL(`src/ecv/${f}`, ROOT), new URL(`src/ecv/${f}`, OUT));

// HTML: same page, snapshot-only controls, fixed provenance banner.
let html = await readFile(new URL('web/risk.html', ROOT), 'utf8');
const replace = (from, to) => {
  if (!html.includes(from)) throw new Error(`export-static: expected markup not found: ${from.slice(0, 80)}`);
  html = html.replaceAll(from, to);
};
const BANNER = `Recorded snapshot · Kamino ${CAPTURE_LABEL} (Warsaw) · AMM depth: synthetic sandbox curve (the 27.09 16:17 Jupiter quote ladder was not saved) · Not a lending signal · ECV program on Solana devnet only`;
replace('<title>RWA Shield · Kamino × xStocks Risk Lab</title>', '<title>RWA Shield · Risk Lab (recorded snapshot)</title>');
replace('href="/web/', 'href="./web/');
replace('src="/web/', 'src="./web/');
replace('<script type="module" src="./web/risk.js"></script>',
  '<script type="importmap">{"imports":{"/src/risk/kaminoRisk.mjs":"./src/risk/kaminoRisk.mjs","/src/ecv/params.mjs":"./src/ecv/params.mjs","/src/ecv/model.mjs":"./src/ecv/model.mjs"}}</script>\n'
  + '  <script>window.RWA_STATIC = true;</script>\n  <script type="module" src="./web/risk.js"></script>');
replace('<a class="brand" href="/">', '<a class="brand" href="../">');
replace('<a href="/">Original ECV demo ↗</a>', '<a href="../">← RWA Shield home</a>');
replace('<a href="/">Open original ECV demo ↗</a>', '<a href="../">← Back to RWA Shield home</a>');
replace('<body>\n', `<body>\n<div class="snapshot-banner" role="note" style="background:#FFB020;color:#060A0C;font:600 13px/1.4 system-ui,sans-serif;padding:8px 16px;text-align:center">${BANNER}</div>\n`);
replace('<option value="live">Best available</option><option value="offline">Offline snapshot</option>', `<option value="offline">Recorded snapshot · ${CAPTURE_LABEL}</option>`);
replace('<option value="jupiter">Jupiter quotes</option><option value="offline">Offline / last measured</option><option value="synthetic">Synthetic sandbox</option>', '<option value="synthetic">Synthetic sandbox ($400k depth assumption)</option>');
replace('<option value="current">Current freshness</option><option value="snapshot-replay">Replay at capture</option><option value="sandbox">Stress sandbox · assume fresh reference</option>',
  '<option value="sandbox">Stress sandbox · assume fresh reference</option><option value="snapshot-replay">Replay at capture</option>');
replace('<button id="refresh" type="button">↻ Refresh</button>', '<button id="refresh" type="button" hidden>↻ Refresh</button>');
replace('<small id="updated">Reading source metadata</small>', '<small id="updated">Recorded snapshot · no live data</small>');
html = html.replace('<!doctype html>', `<!doctype html>\n<!-- Generated by scripts/export-static.mjs from web/risk.html. Do not edit by hand. Snapshot ${CAPTURED_AT}. -->`);
if (/\bvalue="live"|\bvalue="current"|value="jupiter"/.test(html)) throw new Error('Live controls leaked into the static build');
await writeFile(new URL('index.html', OUT), html);
await writeFile(new URL('data/README.md', OUT), `# Static Risk Lab data\n\nGenerated by \`node scripts/export-static.mjs\` from \`data/kamino.snapshot.json\` (captured ${CAPTURED_AT}, ${CAPTURE_LABEL} Warsaw).\nEvaluation clock pinned to capture time. AMM execution: explicit synthetic sandbox curve (not Jupiter data).\nParameters: \`DEFAULT_PARAMS\` (priors) from \`src/ecv/params.mjs\`. Not a lending signal.\n`);
console.log(`docs/risk/: ${markets.markets.length} markets, ${count} baselines, snapshot ${CAPTURED_AT} (${CAPTURE_LABEL} Warsaw)`);
