/** Generate the static edition of the repository dashboard without network I/O. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { DEFAULT_PARAMS } from '../src/ecv/params.mjs';
import { generateSeries } from '../src/data/prices.mjs';
import { runBacktest } from '../src/backtest/engine.mjs';
import { SCENARIOS } from '../src/backtest/scenarios.mjs';
import { syntheticQuote, MINTS } from '../src/data/jupiter.mjs';
import { realizedVolAnnual } from '../src/data/volatility.mjs';

const series = generateSeries();
const validation = SCENARIOS.map(scenario => ({
  id: scenario.id,
  ...runBacktest(scenario.transform(series), {
    params: DEFAULT_PARAMS, depthStressFactor: scenario.depthStressFactor,
    label: scenario.label
  })
}));
console.log(JSON.stringify(validation.map(v => ({ id: v.id, fixedBadDebt: v.fixed.badDebt, ecvBadDebt: v.ecv.badDebt, refusals: v.ecv.refusals, creditRatio: v.delta.lentRatio })), null, 2));

// Publish the actual repository dashboard with a browser-only API adapter.
// Pure model modules are copied byte-for-byte; model logic is never rewritten.
const root = new URL('../', import.meta.url);
const dashboard = new URL('docs/demo/', root);
await mkdir(new URL('core/', dashboard), { recursive: true });
for (const name of ['model', 'params']) {
  await writeFile(new URL(`core/${name}.mjs`, dashboard), await readFile(new URL(`src/ecv/${name}.mjs`, root)));
}
await writeFile(new URL('core/session.mjs', dashboard), await readFile(new URL('src/data/session.mjs', root)));
await writeFile(new URL('core/quote.mjs', dashboard), `// Generated from the canonical offline adapter.\nexport ${syntheticQuote.toString()}\n`);
const server = await readFile(new URL('src/api/server.mjs', root), 'utf8');
const prices = server.match(/^const PRICES = (.+);$/m)?.[1];
const helpers = server.slice(server.indexOf('function syntheticCurve('), server.indexOf('async function withTimeout('));
if (!prices || !helpers.includes('function boundedNumber(')) throw new Error('API source changed: review static dashboard adapter.');
await writeFile(new URL('core/api-helpers.mjs', dashboard),
  "// Generated from src/api/server.mjs.\nimport { syntheticQuote } from './quote.mjs';\n" +
  helpers.replace('function syntheticCurve(', 'export function syntheticCurve(').replace('function boundedNumber(', 'export function boundedNumber('));
const backtest = validation.map(row => ({
  id: row.id, label: row.label, fixedBadDebt: Math.round(row.fixed.badDebt),
  ecvBadDebt: Math.round(row.ecv.badDebt), avoided: Math.round(row.delta.badDebtAvoided),
  lentRatio: row.delta.lentRatio, offHours: row.ecv.offHoursLiquidations, refusals: row.ecv.refusals
}));
await writeFile(new URL('core/data.mjs', dashboard),
  `// Generated from the API constants and synthetic backtest. No market quotes.\nexport const PRICES = ${prices};\n` +
  `export const MINTS = ${JSON.stringify(MINTS)};\nexport const VOL = ${realizedVolAnnual(series.map(point => point.p))};\n` +
  `export const BACKTEST = ${JSON.stringify(backtest, null, 2)};\n`);
let html = (await readFile(new URL('web/index.html', root), 'utf8')).replace(/\r\n/g, '\n');
const replace = (before, after) => {
  if (!html.includes(before)) throw new Error(`Dashboard source changed: missing ${before.slice(0, 70)}`);
  html = html.replace(before, after);
};
replace('<title>RWA Shield — Executable Collateral Value</title>', '<title>RWA Shield — Repository dashboard demo</title>');
replace('</head>', '<link rel="icon" href="../assets/rwa-shield-logo.png">\n<link rel="stylesheet" href="static.css">\n</head>');
replace('<body data-step="0">', `<body data-step="0">
<div class="static-banner"><a href="../" target="_top">← RWA Shield</a><span>REPOSITORY DASHBOARD · SYNTHETIC / OFFLINE · DEFAULT MODEL PRIORS</span><a href="https://github.com/Dorianos85/rwa-shield/blob/main/DEMO_RUNBOOK.md" target="_top">Local server runbook ↗</a></div>
<noscript><p class="static-noscript">This interactive dashboard requires JavaScript. <a href="../" target="_top">Read the evidence and model explanation on the website.</a></p></noscript>`);
replace('<span class="shield">RS</span>', '<img src="../assets/rwa-shield-logo.png" alt="" width="32" height="32">');
replace('<button id="live" type="button">Probe Jupiter route</button>', '<button id="live" type="button" disabled title="Live Jupiter quoting requires the local API server">Live probe: local server only</button>');
replace('Presentation mode stays on the deterministic offline path. A failed live probe falls back safely.', 'This static edition uses the repository’s deterministic synthetic curve. Prices are illustrative constants. Live quotes require the local API server.');
replace('<script>', '<script type="module">\n  import { demoApi } from "./static-api.mjs";');
replace("paramsMode: query.get('params') === 'priors' ? 'priors' : 'fitted',", "paramsMode: 'priors',");
replace('fittedAvailable: true,', 'fittedAvailable: false,');
replace('The fitted weekend modifier is 1.00; liquidity and the breaker do the work.', 'This static edition uses default model priors; the liquidity breaker blocks new borrowing.');
replace('Polls price and depth, then alerts when a haircut moves by more than one percentage point.', 'Available in the repository. The monitor is not running on this static page.');
replace('const response = await fetch(url);\n    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);\n    const payload = await response.json();\n    if (payload.error) throw new Error(payload.error);\n    return payload;', 'return demoApi(url);');
await writeFile(new URL('index.html', dashboard), '<!-- Generated from web/index.html by scripts/build-website-demo.mjs. -->\n' + html);
