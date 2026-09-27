import { computeKaminoRiskScenario } from '/src/risk/kaminoRisk.mjs';
import { DEFAULT_PARAMS } from '/src/ecv/params.mjs';
import { mountRiskChart } from './risk-chart.js';

const $ = id => document.getElementById(id);
const axes = ['utilization', 'navPrice', 'ammLiquidityUsd', 'averageHealthFactor'];
const app = { baseline: null, current: null, markets: [], request: 0, frame: null, loadedAt: 0 };
const query = new URLSearchParams(location.search);
if (query.get('offline') === '1') $('dataMode').value = 'offline';
if (['snapshot-replay', 'sandbox'].includes(query.get('mode'))) $('valuationMode').value = query.get('mode');

const finite = value => typeof value === 'number' && Number.isFinite(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const num = (value, digits = 2) => finite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits }) : 'Unavailable';
const usd = value => finite(value) ? '$' + num(value, Math.abs(value) < 1000 ? 2 : 0) : 'Unavailable';
const pct = value => finite(value) ? num(value * 100, 1) + '%' : 'Unavailable';
const signed = value => finite(value) ? (Math.abs(value) < .05 ? '0.0' : (value > 0 ? '+' : '') + num(value, 1)) : '—';
const compact = value => finite(value) ? '$' + (Math.abs(value) >= 1e6 ? num(value / 1e6, 2) + 'M' : Math.abs(value) >= 1e3 ? num(value / 1e3, 1) + 'K' : num(value, 2)) : 'Unavailable';
const text = (id, value) => { $(id).textContent = value; };
const metricRows = rows => rows.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('');
const riskChart = mountRiskChart({ onApply: point => {
  $('navPrice').value = point.navPrice;
  $('ammLiquidityUsd').value = point.ammLiquidityUsd;
  queueRender();
} });

function scenario() {
  return {
    utilization: Number($('utilization').value) / 100,
    navPrice: Number($('navPrice').value),
    ammLiquidityUsd: Number($('ammLiquidityUsd').value),
    averageHealthFactor: Number($('averageHealthFactor').value),
    notionalUsd: Number($('notional').value),
    mode: $('valuationMode').value
  };
}

async function fetchJson(path) {
  const response = await fetch(path, { signal: AbortSignal.timeout(25000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

function showError(error) {
  $('error').hidden = false;
  text('error', `Unable to update: ${error.message || error}. Try Offline snapshot or refresh. The last successful baseline is preserved.`);
}

function updateAssets(preferred) {
  const market = app.markets.find(item => item.address === $('market').value);
  const reserves = market?.reserves || [];
  $('asset').innerHTML = reserves.map(item => `<option value="${escape(item.symbol)}">${escape(item.symbol)}</option>`).join('');
  if (reserves.some(item => item.symbol === preferred)) $('asset').value = preferred;
}

async function boot() {
  bindEvents();
  try {
    const result = await fetchJson(`/api/kamino/markets?offline=${$('dataMode').value === 'offline' ? '1' : '0'}`);
    app.markets = result.markets || [];
    if (!app.markets.length) throw new Error('No verified xStocks reserves are available');
    $('market').innerHTML = app.markets.map(item => `<option value="${escape(item.address)}">${escape(item.name || item.address)}</option>`).join('');
    if (app.markets.some(item => item.address === query.get('market'))) $('market').value = query.get('market');
    updateAssets(query.get('symbol') || 'SPYx');
    await loadBaseline();
  } catch (error) { showError(error); }
}

async function loadBaseline(refresh = false) {
  const request = ++app.request;
  const controls = ['market', 'asset', 'refresh', 'dataMode'];
  controls.forEach(id => { $(id).disabled = true; });
  text('refresh', '↻ Loading');
  const params = new URLSearchParams({ market: $('market').value, symbol: $('asset').value, offline: $('dataMode').value === 'offline' ? '1' : '0' });
  if (refresh) params.set('refresh', '1');
  try {
    const baseline = await fetchJson('/api/risk/baseline?' + params);
    if (request !== app.request) return;
    const current = computeKaminoRiskScenario({ ...baseline, scenario: { notionalUsd: Number($('notional').value), mode: $('valuationMode').value } }, { includeBoundaries: false });
    app.baseline = baseline;
    app.loadedAt = Date.now();
    app.current = current;
    resetControls();
    $('controls').disabled = false;
    $('error').hidden = true;
    render();
    renderSources();
    const next = new URLSearchParams(params);
    next.delete('refresh');
    if ($('valuationMode').value !== 'current') next.set('mode', $('valuationMode').value);
    history.replaceState(null, '', '/risk?' + next);
  } catch (error) { if (request === app.request) showError(error); }
  finally {
    if (request === app.request) {
      controls.forEach(id => { $(id).disabled = false; });
      text('refresh', '↻ Refresh');
    }
  }
}

function resetControls() {
  if (!app.current) return;
  const r = app.current;
  const policy = { ...DEFAULT_PARAMS.riskLab, ...app.baseline.rwaParams?.riskLab };
  $('utilization').max = String(policy.maxUtilization * 100);
  $('utilization').value = (r.reserve.currentUtilization ?? 0) * 100;
  $('utilization').disabled = !finite(r.reserve.currentUtilization);
  const nav = r.asset.navPriceCurrent;
  $('navPrice').min = '0';
  $('navPrice').max = String(Math.max(1, (nav ?? 0) * policy.navRangeMultiplier));
  $('navPrice').step = 'any';
  $('navPrice').value = nav ?? 0;
  const depth = r.execution.ammLiquidityCurrentUsd;
  $('ammLiquidityUsd').max = String(Math.max(1, (depth ?? 0) * policy.liquidityRangeMultiplier));
  $('ammLiquidityUsd').step = 'any';
  $('ammLiquidityUsd').value = depth ?? 0;
  $('averageHealthFactor').max = String(policy.maxAverageHealthFactor);
  $('averageHealthFactor').value = policy.defaultAverageHealthFactor;
}

function bindEvents() {
  for (const axis of axes) $(axis).addEventListener('input', queueRender);
  $('notional').addEventListener('input', () => { if ($('notional').checkValidity()) queueRender(); });
  $('notional').addEventListener('change', () => {
    const value = Number($('notional').value);
    $('notional').value = finite(value) ? Math.max(1, Math.min(10000000, value)) : 100000;
    queueRender();
  });
  $('refresh').addEventListener('click', () => loadBaseline(true));
  $('market').addEventListener('change', () => { updateAssets($('asset').value); loadBaseline(); });
  $('asset').addEventListener('change', () => loadBaseline());
  $('dataMode').addEventListener('change', () => loadBaseline());
  $('valuationMode').addEventListener('change', () => {
    queueRender(); renderSources();
    const next = new URL(location.href); next.searchParams.set('mode', $('valuationMode').value); history.replaceState(null, '', next);
  });
  $('reset').addEventListener('click', () => { resetControls(); queueRender(); });
  document.querySelectorAll('[data-notional]').forEach(button => button.addEventListener('click', () => { $('notional').value = button.dataset.notional; queueRender(); }));
  $('navShock').addEventListener('click', () => { if (app.current) { $('navPrice').value = app.current.asset.navPriceCurrent * .8; queueRender(); } });
  $('depthShock').addEventListener('click', () => { if (app.current) { $('ammLiquidityUsd').value = app.current.execution.ammLiquidityCurrentUsd * .2; queueRender(); } });
  $('combined').addEventListener('click', () => {
    if (!app.current) return;
    $('utilization').value = '92'; $('averageHealthFactor').value = '1.08';
    $('navPrice').value = app.current.asset.navPriceCurrent * .85;
    $('ammLiquidityUsd').value = app.current.execution.ammLiquidityCurrentUsd * .3;
    queueRender();
  });
}

function queueRender() {
  if (app.frame !== null) cancelAnimationFrame(app.frame);
  app.frame = requestAnimationFrame(() => { app.frame = null; render(); });
}

function render() {
  if (!app.baseline) return;
  try {
    const elapsedSec = Math.max(0, (Date.now() - app.loadedAt) / 1000);
    const actualAge = app.baseline.asset.priceAgeSec;
    const agedSource = source => source ? { ...source, ageSec: finite(source.ageSec) ? source.ageSec + elapsedSec : null } : source;
    const baseline = { ...app.baseline,
      asset: { ...app.baseline.asset, priceAgeSec: finite(actualAge) ? actualAge + elapsedSec : actualAge },
      execution: { ...app.baseline.execution, source: agedSource(app.baseline.execution.source) },
      reserve: { ...app.baseline.reserve, source: agedSource(app.baseline.reserve.source) },
      fundingReserve: app.baseline.fundingReserve ? { ...app.baseline.fundingReserve, source: agedSource(app.baseline.fundingReserve.source) } : null
    };
    const r = computeKaminoRiskScenario({ ...baseline, scenario: scenario() });
    const { reserve, collateralReserve, asset, execution, health, rwaShield: rwa, comparison } = r;
    text('utilizationValue', finite(reserve.currentUtilization) ? pct(reserve.scenarioUtilization) : 'Unavailable');
    text('utilizationBase', `Current ${pct(reserve.currentUtilization)}`);
    text('utilizationDelta', finite(reserve.currentUtilization) ? `${signed((reserve.scenarioUtilization - reserve.currentUtilization) * 100)} pp` : 'No USDC baseline');
    text('fundingNote', baseline.fundingReserve ? 'USDC borrowed / supplied · same Kamino market · USD-valued amounts' : baseline.fundingReserveUnavailable || 'USDC reserve unavailable in this market');
    text('navPriceValue', usd(asset.navPriceScenario));
    text('navPriceBase', `Reference ${usd(asset.navPriceCurrent)}`);
    text('navPriceDelta', `${signed(asset.navShockPct)}% shock`);
    text('ammLiquidityUsdValue', compact(execution.ammLiquidityScenarioUsd));
    text('ammLiquidityUsdBase', `Baseline ${compact(execution.ammLiquidityCurrentUsd)}`);
    text('ammLiquidityUsdDelta', execution.ammLiquidityCurrentUsd > 0 ? `${num(execution.ammLiquidityScenarioUsd / execution.ammLiquidityCurrentUsd * 100, 0)}% remaining` : 'No baseline depth');
    text('averageHealthFactorValue', num(health.averageHealthFactorInitial));
    text('averageHealthFactorDelta', `Stressed ${num(health.averageHealthFactorStressed)}`);
    renderCurrent(r);
    const status = r.overallStatus.toLowerCase();
    $('riskBanner').className = `risk-banner panel ${status}`;
    text('riskStatus', `${r.valuationMode === 'sandbox' ? 'MODELED ' : ''}${r.overallStatus}`);
    $('sandboxNotice').hidden = r.valuationMode !== 'sandbox';
    text('dominantReason', r.dominantReason || 'No evaluated boundary is crossed.');
    const first = r.constraints?.find(item => item.severity === r.overallStatus) || r.constraints?.[0];
    const constraintValue = value => first?.id === 'borrow_breaker' && rwa.breakerReason === 'stale_price' ? `${num(value, 1)} sec`
      : first?.id === 'borrow_breaker' && rwa.breakerReason === 'impact_extreme' ? `${num(value)}%`
      : ['borrow_cap', 'execution_shortfall', 'reserve_exhausted', 'supply_cap'].includes(first?.id) || first?.id === 'borrow_breaker' && rwa.breakerReason === 'depth_floor' ? usd(value)
      : ['ltv_gap', 'utilization_kink'].includes(first?.id) ? pct(value) : num(value, 4);
    text('dominantDetail', first ? `${first.id.replaceAll('_', ' ')} · observed ${constraintValue(first.value)} · boundary ${constraintValue(first.threshold)}` : 'Within the evaluated rules for this test exposure. Source and model limitations still apply.');
    $('riskTags').innerHTML = (r.constraints || []).slice(1, 5).map(item => `<span>${escape(item.severity)} · ${escape(item.message)}</span>`).join('');
    text('safeLtv', pct(rwa.safeLtv)); text('maxBorrow', usd(rwa.maxBorrow)); text('stressedHF', num(health.averageHealthFactorStressed));
    text('ltvGap', `${collateralReserve.symbol} LTV ${pct(collateralReserve.configuredLtv)} · ${signed(comparison.safetyGapLtvPoints)} pp`);
    text('borrowGate', `BORROW GATE ${rwa.borrowDisabled ? 'CLOSED' : 'OPEN'}`);
    text('healthBuffer', finite(health.averageHealthFactorStressed) ? `Buffer ${signed(health.averageHealthFactorStressed - 1)} above 1.00` : 'Baseline execution unavailable');
    $('maxBorrow').style.color = rwa.borrowDisabled ? 'var(--red)' : 'var(--green)';
    $('stressedHF').style.color = health.averageHealthFactorStressed < 1 ? 'var(--red)' : health.averageHealthFactorStressed < health.targetHealth ? 'var(--amber)' : 'var(--green)';
    renderBoundaries(r.boundaries);
    riskChart.update({ ...baseline, scenario: r.scenario, rwaParams: {
      ...DEFAULT_PARAMS, ...baseline.rwaParams,
      riskLab: { ...DEFAULT_PARAMS.riskLab, ...baseline.rwaParams?.riskLab }
    } }, r, { navMax: Number($('navPrice').max), liquidityMax: Number($('ammLiquidityUsd').max) });
    renderWaterfall(r);
    $('reserveBar').style.width = `${reserve.scenarioUtilization * 100}%`;
    $('reserveMetrics').innerHTML = metricRows([
      ['Fixed USDC supplied value', usd(reserve.tvlUsd)], ['USDC utilization', finite(reserve.currentUtilization) ? pct(reserve.scenarioUtilization) : 'Unavailable'],
      ['Scenario USDC borrowed (USD)', usd(reserve.scenarioBorrowedUsd)], ['Scenario USDC available (USD)', usd(reserve.scenarioAvailableUsd)],
      ['USDC borrow cap (USD)', usd(reserve.borrowCapUsd)], ['Cap usage / headroom', `${pct(reserve.borrowCapUsage)} / ${usd(reserve.borrowCapHeadroomUsd)}`],
      ['USDC supply cap (USD)', usd(reserve.supplyCapUsd)], ['Optimal utilization', pct(reserve.optimalUtilization)],
      ['Rate-curve breakpoint', pct(reserve.rateCurveKink)],
      ['Distance to kink', finite(reserve.distanceToKink) ? `${signed(reserve.distanceToKink * 100)} pp` : 'Unavailable'],
      ['Interest-rate regime', reserve.interestRateRegime || 'Unavailable'], ['Borrow rate', pct(reserve.borrowRate)],
      ['Remaining reserve capacity', usd(reserve.remainingReserveCapacityUsd)]
    ]);
    $('comparison').innerHTML = [
      [`${collateralReserve.symbol} LTV`, pct(collateralReserve.configuredLtv), pct(rwa.safeLtv)],
      ['Borrowing capacity', usd(comparison.kaminoBorrowCapacityUsd), usd(rwa.maxBorrow)],
      ['Capacity difference', 'Configured lending policy', usd(comparison.safetyGapUsd)],
      ['Collateral liquidation threshold / target HF', pct(collateralReserve.liquidationThreshold), num(health.targetHealth)],
      ['Collateral cap', usd(app.baseline.reserve.supplyCapUsd), usd(rwa.collateralCap)],
      ['Risk premium', 'Protocol borrow rate above', pct(rwa.riskPremium)],
      ['Execution price impact', 'Test position', `${num(execution.priceImpactPct)}%`],
      ['Routable execution liquidity', 'Separate from reserve cash', usd(execution.routableUsd)],
      ['Liquidation route', 'Quote / model source below', rwa.liquidationRoute || execution.route || 'Unavailable']
    ].map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('');
    $('healthMetrics').innerHTML = [['Initial Avg HF', num(health.averageHealthFactorInitial)], ['Stressed Avg HF', num(health.averageHealthFactorStressed)], ['RWA targetHealth', num(health.targetHealth)], ['Liquidation boundary', '1.00'], ['Execution ratio', pct(health.executableValueRatio)]].map(([label, value]) => `<div><small>${escape(label)}</small><strong>${escape(value)}</strong></div>`).join('');
  } catch (error) { showError(error); }
}

function renderCurrent(r) {
  const { reserve, collateralReserve, asset, execution } = r;
  const cards = [
    ['USDC supplied (USD)', compact(reserve.tvlUsd), 'FIXED USDC RESERVE BASE'], ['USDC utilization', pct(reserve.currentUtilization), 'SAME KAMINO MARKET'],
    ['USDC borrowed (USD)', compact(reserve.currentBorrowedUsd), 'USDC RESERVE'], ['USDC available (USD)', compact(reserve.currentAvailableUsd), 'USDC RESERVE LIQUIDITY'],
    [`${collateralReserve.symbol} configured LTV`, pct(collateralReserve.configuredLtv), 'COLLATERAL PARAMETER'], [`${collateralReserve.symbol} liquidation threshold`, pct(collateralReserve.liquidationThreshold), 'COLLATERAL PARAMETER'],
    ['NAV / reference price', usd(asset.navPriceCurrent), app.baseline.asset.source?.independentNav === false ? 'ORACLE PROXY · NO ISSUER NAV' : app.baseline.asset.navType || 'SOURCE DETAILS BELOW'], ['Kamino oracle price', usd(asset.kaminoOraclePrice), 'OBSERVED · NOT SLIDER'],
    ['AMM execution depth', compact(execution.ammLiquidityCurrentUsd), app.baseline.execution.source?.fallback ? 'MODELLED FALLBACK' : 'EXECUTION BASELINE'], ['Average HF assumption', num(r.health.averageHealthFactorInitial), 'ABSTRACT · NOT OBSERVED']
  ];
  $('currentCards').innerHTML = cards.map(([label, value, note]) => `<div class="current-card"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(note)}</small></div>`).join('');
}

function renderBoundaries(boundaries) {
  const names = { utilization: 'USDC utilization', nav: 'NAV / reference', ammLiquidity: 'AMM liquidity', averageHealthFactor: 'Initial Average HF' };
  const format = (key, value) => key === 'utilization' ? pct(value) : key === 'averageHealthFactor' ? num(value) : usd(value);
  $('boundaries').innerHTML = Object.entries(names).map(([key, name]) => {
    const axis = boundaries?.[key];
    const row = (severity, label) => {
      const boundary = axis?.[severity];
      const value = finite(boundary?.value) ? format(key, boundary.value) : boundary?.alreadyBreached ? 'Already crossed' : 'No crossing';
      const note = finite(boundary?.value) && boundary?.alreadyBreached ? 'Currently crossed. ' : '';
      return `<p class="${severity}">${label} ${escape(axis?.direction || '')}<strong>${escape(value)}</strong><small>${escape(note + (boundary?.reason || 'No verified threshold in search range'))}</small></p>`;
    };
    return `<div class="boundary-item"><h3>${escape(name)}</h3>${row('warning', 'Warning')}${row('critical', 'Critical')}</div>`;
  }).join('');
}

function renderWaterfall(r) {
  const rwa = r.rwaShield;
  const rows = (rwa.waterfall || []).map(row => [row.label, row.value]);
  const max = Math.max(1, ...rows.map(([, value]) => finite(value) ? value : 0));
  $('waterfall').innerHTML = rows.map(([label, value]) => `<div class="waterfall-row"><div class="waterfall-label"><span>${escape(label)}</span><strong>${escape(usd(value))}</strong></div><div class="waterfall-track"><div class="waterfall-fill" style="width:${finite(value) ? Math.max(0, value / max * 100) : 0}%"></div></div></div>`).join('');
  text('recovery', usd(rwa.recovery));
  text('recoveryNote', `${pct(rwa.recoveryVsNotional)} of tested liquidation notional, after liquidator bonus. This is not coverage of total reserve debt.`);
}

function renderSources() {
  if (!app.baseline) return;
  const { reserve, fundingReserve, asset, execution } = app.baseline;
  const entries = [['USDC funding reserve', fundingReserve || { notes: [app.baseline.fundingReserveUnavailable || 'No USDC reserve observation for this market'] }], [`${reserve.symbol} collateral reserve`, reserve], ['xStocks reference', asset], ['AMM execution', execution]];
  const anyFallback = entries.some(([, item]) => !item.source?.live || item.source?.fallback);
  const replay = $('valuationMode').value === 'snapshot-replay';
  const sandbox = $('valuationMode').value === 'sandbox';
  const actualAge = finite(asset.priceAgeSec) ? asset.priceAgeSec + Math.max(0, (Date.now() - app.loadedAt) / 1000) : null;
  const stale = actualAge === null || actualAge > app.baseline.rwaParams.maxStalenessSec;
  text('feedBadge', sandbox ? 'SANDBOX · NOT LIVE' : replay ? 'SNAPSHOT REPLAY · NOT LIVE' : stale ? anyFallback ? 'STALE / FALLBACK · NOT LIVE' : 'STALE REFERENCE · SEE SOURCES' : anyFallback ? 'MIXED / FALLBACK · SEE SOURCES' : 'FRESH OBSERVATIONS');
  $('feedBadge').className = 'badge' + (!anyFallback && !replay && !sandbox && !stale ? ' live' : '');
  text('updated', sandbox ? 'Hypothetical fresh reference · model only' : replay ? 'Valuation uses capture-time freshness' : 'Observation time is shown per source');
  $('sources').innerHTML = entries.map(([label, item]) => {
    const source = item.source || {};
    const state = source.fallback ? 'OFFLINE / FALLBACK · NOT LIVE' : source.cached ? 'CACHED OBSERVATION' : source.live ? 'LIVE FETCH' : 'UNAVAILABLE / NOT LIVE';
    const time = source.timestamp ? String(source.timestamp) : 'Unavailable';
    const age = finite(source.ageSec) ? `${num(source.ageSec, 0)} seconds at fetch` : 'Unknown source age';
    const provenance = typeof source.source === 'string' ? source.source : 'Source unavailable';
    const link = /^https:\/\//.test(provenance) ? `<a href="${escape(provenance)}" target="_blank" rel="noreferrer">Source endpoint ↗</a>` : '';
    const notes = [source.fallbackReason, item.navType, item.referenceLabel, item.referenceReason, item.note, item.disclaimer, item.priceTimestampReason, ...(item.modeledAssumptions || []), ...(item.notes || [])].filter(value => typeof value === 'string');
    return `<article class="source-card"><h3>${escape(label)}</h3><span class="badge ${source.live && !source.fallback ? 'live' : ''}">${state}</span><p>${escape(provenance)}<br>Timestamp: ${escape(time)}<br>Age: ${escape(age)}</p>${link}${notes.map(note => `<p>${escape(note)}</p>`).join('')}</article>`;
  }).join('');
}

boot();
setInterval(() => {
  if (!app.baseline || document.hidden) return;
  if ($('valuationMode').value === 'current') render();
  renderSources();
}, 5000);
