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
replace('import { demoApi } from "./static-api.mjs";', 'import { demoApi } from "./static-api.mjs";\n  import { createDepthChart } from "./depth-chart.mjs";');
replace('<h3>Position size → price impact</h3>', '<h3>Liquidity surface / 3D</h3>');
replace('<div class="chart-wrap"><svg id="depthChart" viewBox="0 0 640 250" role="img" aria-label="Depth curve showing price impact by position size"></svg></div>', `<div class="chart-3d">
  <div class="chart-tools"><span>SYNTHETIC MODEL SURFACE</span><div><button type="button" data-chart-zoom-out aria-label="Zoom out">−</button><button type="button" data-chart-zoom-in aria-label="Zoom in">+</button><button type="button" data-chart-reset>Reset view</button></div></div>
  <canvas id="depthChart" tabindex="0" role="img" aria-label="Interactive 3D liquidity surface" aria-describedby="chartHelp"></canvas>
  <p id="chartReadout" class="chart-readout"></p>
  <p id="chartHelp" class="chart-help">Drag to orbit · pinch or focus + scroll to zoom · hover to inspect · click a point to apply. Keyboard: arrows rotate, +/− zoom, Home resets. Scroll outside the chart to move the page.</p>
  <details class="chart-table"><summary>Exact values at current depth</summary><div><table><thead><tr><th>Position</th><th>Depth</th><th>Impact</th><th>Impact threshold</th></tr></thead><tbody id="chartData"></tbody></table></div></details>
</div>`);
replace('  hydrateControlsFromUrl();', `  const depthChart3d = createDepthChart($('depthChart'), { onSelect: (notional, depth) => {
    $('notional').value = notional; $('depth').value = depth;
    updateControlLabels(); syncUrl(); refresh();
  }});
  hydrateControlsFromUrl();`);
replace("renderDepthChart(result.depthCurve || [], Number($('notional').value), result.limits.breakerImpactPct);", "depthChart3d.update(result, Number($('notional').value), Number($('depth').value));\n    $('cutoffCaption').textContent = `Impact breaker > ${result.limits.breakerImpactPct}%`;");
replace('<span>Smaller position</span><span id="cutoffCaption">Credit cutoff —</span><span>Larger position</span>', '<span>Cyan: current depth slice</span><span id="cutoffCaption">Impact threshold</span><span>Gold: selected position</span>');
const chartStart = html.indexOf('  function renderDepthChart(');
const chartEnd = html.indexOf('  async function loadBacktest()', chartStart);
if (chartStart < 0 || chartEnd < 0) throw new Error('Dashboard chart source changed');
html = html.slice(0, chartStart) + html.slice(chartEnd);
await writeFile(new URL('index.html', dashboard), '<!-- Generated from web/index.html by scripts/build-website-demo.mjs. -->\n' + html);
