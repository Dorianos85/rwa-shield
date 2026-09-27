import { computeKaminoRiskScenario } from '../src/risk/kaminoRisk.mjs';

// Rendering resolution only; financial rules remain in the shared risk engine.
const COLS = 36, ROWS = 24;
const PLOT = { x: 76, y: 24, width: 700, height: 320 };
const COLORS = { SAFE: '#12684e', WARNING: '#9e702a', CRITICAL: '#833b50' };
const INK = { SAFE: '#52efb3', WARNING: '#ffca74', CRITICAL: '#ff8b9d' };
const money = x => Number.isFinite(x) ? '$' + x.toLocaleString('en-US', { maximumFractionDigits: x < 1000 ? 2 : 0 }) : 'Unavailable';
const compact = x => x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1000 ? '$' + (x / 1000).toFixed(0) + 'K' : money(x);
const clamp = (x, max) => Math.max(0, Math.min(max, x));

export function buildStressGrid(input, { navMax, liquidityMax, columns = COLS, rows = ROWS }) {
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      const navPrice = navMax * (col + .5) / columns;
      const ammLiquidityUsd = liquidityMax * (1 - (row + .5) / rows);
      const result = computeKaminoRiskScenario({ ...input, scenario: { ...input.scenario, navPrice, ammLiquidityUsd } }, { includeBoundaries: false });
      cells.push({ row, col, navPrice, ammLiquidityUsd, status: result.overallStatus });
    }
  }
  return cells;
}

export function mountRiskChart({ onApply }) {
  const $ = id => document.getElementById(id);
  const svg = $('stressSvg'), surface = $('stressMap');
  let input, ranges, result, preview = null, keyboard = null, cacheKey = '', lastRender = 0;
  const at = point => computeKaminoRiskScenario({ ...input, scenario: { ...input.scenario, ...point } }, { includeBoundaries: false });
  const xOf = nav => PLOT.x + clamp(nav / ranges.navMax, 1) * PLOT.width;
  const yOf = depth => PLOT.y + (1 - clamp(depth / ranges.liquidityMax, 1)) * PLOT.height;

  function inspect(point, label = 'EXPLORED SCENARIO') {
    if (!input) return;
    preview = point;
    const r = point ? at(point) : result;
    $('chartPointLabel').textContent = point ? label : 'SELECTED SCENARIO';
    $('chartPointStatus').textContent = `${r.modeledOnly ? 'MODELED ' : ''}${r.overallStatus}`;
    $('chartPointStatus').style.color = INK[r.overallStatus];
    $('chartPointMetrics').innerHTML = [
      ['NAV / reference', money(r.asset.navPriceScenario)],
      ['AMM liquidity', money(r.execution.ammLiquidityScenarioUsd)],
      ['ECV', money(r.rwaShield.ecv)],
      ['Recovery', money(r.rwaShield.recovery)],
      ['Stressed Avg HF', Number.isFinite(r.health.averageHealthFactorStressed) ? r.health.averageHealthFactorStressed.toFixed(2) : 'Unavailable']
    ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('');
    $('chartPointReason').textContent = r.dominantReason;
    $('applyChartPoint').disabled = !point;
    const x = point ? xOf(point.navPrice) : 0, y = point ? yOf(point.ammLiquidityUsd) : 0;
    $('chartHover').innerHTML = point ? `<path d="M${PLOT.x} ${y}H${PLOT.x + PLOT.width} M${x} ${PLOT.y}V${PLOT.y + PLOT.height}" stroke="#e6eff0" opacity=".65" stroke-dasharray="4 5" fill="none"/><circle cx="${x}" cy="${y}" r="5" fill="${INK[r.overallStatus]}" stroke="#071014" stroke-width="2"/>` : '';
  }

  function apply() {
    if (!preview) return;
    const point = { ...preview };
    preview = null;
    onApply(point);
  }

  function pointFromEvent(event) {
    const rect = svg.getBoundingClientRect();
    const x = (event.clientX - rect.left) * 800 / rect.width;
    const y = (event.clientY - rect.top) * 420 / rect.height;
    if (x < PLOT.x || x > PLOT.x + PLOT.width || y < PLOT.y || y > PLOT.y + PLOT.height) return null;
    return { navPrice: (x - PLOT.x) / PLOT.width * ranges.navMax,
      ammLiquidityUsd: (1 - (y - PLOT.y) / PLOT.height) * ranges.liquidityMax };
  }

  surface.addEventListener('pointermove', event => {
    if (!input || event.pointerType === 'touch') return;
    const point = pointFromEvent(event);
    if (point) inspect(point);
  });
  surface.addEventListener('click', event => {
    if (!input) return;
    const point = pointFromEvent(event);
    if (!point) return;
    keyboard = null;
    inspect(point);
    // Touch previews first so the user can read the result before applying.
    if (event.pointerType !== 'touch') apply();
  });
  surface.addEventListener('keydown', event => {
    if (!input) return;
    if (event.key === 'Escape') { keyboard = null; inspect(null); event.preventDefault(); return; }
    if (event.key === 'Enter') { apply(); event.preventDefault(); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    keyboard = keyboard || { navPrice: result.asset.navPriceScenario, ammLiquidityUsd: result.execution.ammLiquidityScenarioUsd };
    if (event.key === 'ArrowLeft') keyboard.navPrice -= ranges.navMax / COLS;
    if (event.key === 'ArrowRight') keyboard.navPrice += ranges.navMax / COLS;
    if (event.key === 'ArrowDown') keyboard.ammLiquidityUsd -= ranges.liquidityMax / ROWS;
    if (event.key === 'ArrowUp') keyboard.ammLiquidityUsd += ranges.liquidityMax / ROWS;
    keyboard.navPrice = clamp(keyboard.navPrice, ranges.navMax);
    keyboard.ammLiquidityUsd = clamp(keyboard.ammLiquidityUsd, ranges.liquidityMax);
    inspect({ ...keyboard }, 'KEYBOARD EXPLORATION');
  });
  $('applyChartPoint').addEventListener('click', apply);

  return {
    update(nextInput, nextResult, nextRanges) {
      const previousScenario = input?.scenario;
      input = nextInput; result = nextResult; ranges = nextRanges;
      const s = input.scenario;
      // Price age changes continuously; its effect on classification changes at
      // the freshness gate. Cache until a gate, fixed assumption or baseline changes.
      const { source: reserveSource, ...reserveData } = input.reserve;
      const { source: executionSource, ...executionData } = input.execution;
      const { source: assetSource, priceAgeSec, ...assetData } = input.asset;
      const ageBand = (age, limit) => Number.isFinite(age) ? age > limit ? 'stale' : 'fresh' : 'unknown';
      const policy = input.rwaParams.riskLab;
      const key = JSON.stringify({ reserveData, executionData, assetData, params: input.rwaParams, ranges,
        fixed: [s.utilization, s.averageHealthFactor, s.notionalUsd, s.mode],
        provenance: [reserveSource, executionSource, assetSource].map(source => source && { ...source, ageSec: undefined }),
        age: [ageBand(priceAgeSec, input.rwaParams.maxStalenessSec), ageBand(reserveSource?.ageSec, policy.maxReserveAgeSec), ageBand(executionSource?.ageSec, policy.maxExecutionAgeSec)] });
      const keepPreview = cacheKey === key && JSON.stringify(previousScenario) === JSON.stringify(s);
      if (cacheKey !== key) {
        const started = performance.now();
        const cells = buildStressGrid(input, ranges);
        $('chartCells').innerHTML = cells.map(cell => `<rect x="${PLOT.x + cell.col * PLOT.width / COLS}" y="${PLOT.y + cell.row * PLOT.height / ROWS}" width="${PLOT.width / COLS + .2}" height="${PLOT.height / ROWS + .2}" fill="${COLORS[cell.status]}"/>`).join('');
        cacheKey = key;
        lastRender = performance.now() - started;
        surface.dataset.renderMs = lastRender.toFixed(1);
      }
      const navBase = input.asset.navPrice, depthBase = input.execution.routableUsd;
      const grid = [];
      for (let i = 0; i <= 4; i++) {
        const x = PLOT.x + i * PLOT.width / 4, y = PLOT.y + i * PLOT.height / 4;
        grid.push(`<path d="M${x} ${PLOT.y}V${PLOT.y + PLOT.height} M${PLOT.x} ${y}H${PLOT.x + PLOT.width}" stroke="#bcd2d9" opacity=".15" fill="none"/>`);
        grid.push(`<text x="${x}" y="${PLOT.y + PLOT.height + 24}" text-anchor="middle">${navBase > 0 ? Math.round(ranges.navMax / navBase * i / 4 * 100) + '%' : compact(ranges.navMax * i / 4)}</text>`);
        grid.push(`<text x="${PLOT.x - 12}" y="${y + 4}" text-anchor="end">${depthBase > 0 ? Math.round(ranges.liquidityMax / depthBase * (1 - i / 4) * 100) + '%' : compact(ranges.liquidityMax * (1 - i / 4))}</text>`);
      }
      grid.push(`<text x="${PLOT.x + PLOT.width / 2}" y="400" text-anchor="middle">NAV / REFERENCE ${navBase > 0 ? '· % OF BASELINE' : '· USD'}</text><text transform="translate(18 184) rotate(-90)" text-anchor="middle">AMM LIQUIDITY ${depthBase > 0 ? '· % OF BASELINE' : '· USD'}</text>`);
      $('chartAxes').innerHTML = grid.join('');
      const x = xOf(result.asset.navPriceScenario), y = yOf(result.execution.ammLiquidityScenarioUsd);
      $('chartMarker').innerHTML = `<path d="M${x} ${PLOT.y}V${PLOT.y + PLOT.height} M${PLOT.x} ${y}H${PLOT.x + PLOT.width}" stroke="white" opacity=".3" stroke-dasharray="2 6" fill="none"/><circle cx="${x}" cy="${y}" r="11" fill="#071014" stroke="white" stroke-width="2"/><circle cx="${x}" cy="${y}" r="4" fill="white"/>`;
      $('chartMode').textContent = result.valuationMode === 'sandbox' ? 'SANDBOX · MODEL GRID' : result.valuationMode === 'snapshot-replay' ? 'REPLAY · MODEL GRID' : 'CURRENT DATA · MODEL GRID';
      $('chartContext').textContent = `${input.reserve.symbol} · ${money(s.notionalUsd)} tested exposure · utilization ${(s.utilization * 100).toFixed(2)}% · initial Average HF ${s.averageHealthFactor.toFixed(2)}. These assumptions stay fixed across the map.`;
      svg.setAttribute('aria-label', `Risk landscape for ${input.reserve.symbol}. Selected scenario ${result.overallStatus}; NAV ${money(result.asset.navPriceScenario)}, AMM liquidity ${money(result.execution.ammLiquidityScenarioUsd)}. ${result.dominantReason}`);
      if (!keepPreview) { keyboard = null; preview = null; }
      inspect(preview, keyboard ? 'KEYBOARD EXPLORATION' : 'EXPLORED SCENARIO');
    }
  };
}
