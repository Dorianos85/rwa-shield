import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStressGrid } from '../../web/risk-chart.js';
import { computeKaminoRiskScenario } from './kaminoRisk.mjs';
import { getKaminoReservePair } from '../data/kamino.mjs';
import { getXstockAsset } from '../data/xstocks.mjs';
import { getLiquidity } from '../data/liquidity.mjs';

async function baseline() {
  const { reserve, fundingReserve } = await getKaminoReservePair({ symbol: 'TSLAx', offline: true });
  const asset = getXstockAsset({ reserve });
  const execution = await getLiquidity({ reserve, asset, offline: true });
  return { reserve, fundingReserve, asset, execution, scenario: { mode: 'sandbox',
    // Explore all three regions below the observed USDC rate-curve breakpoint.
    utilization: 0.5, navPrice: asset.navPrice,
    ammLiquidityUsd: execution.routableUsd, averageHealthFactor: 1.5, notionalUsd: 100_000 } };
}

test('stress map matches model across the full display without mutating fixed assumptions', async () => {
  const input = await baseline();
  const original = structuredClone(input);
  const cells = buildStressGrid(input, { navMax: input.asset.navPrice * 1.5, liquidityMax: 800_000 });
  assert.equal(cells.length, 864);
  assert.deepEqual(new Set(cells.map(c => c.status)), new Set(['SAFE', 'WARNING', 'CRITICAL']));
  for (const cell of cells) {
    const result = computeKaminoRiskScenario({ ...input, scenario: {
      ...input.scenario, navPrice: cell.navPrice, ammLiquidityUsd: cell.ammLiquidityUsd
    } }, { includeBoundaries: false });
    assert.equal(cell.status, result.overallStatus);
    assert.equal(result.reserve.tvlUsd, original.fundingReserve.tvlUsd);
    assert.equal(result.health.averageHealthFactorInitial, original.scenario.averageHealthFactor);
    assert.equal(result.scenario.utilization, original.scenario.utilization);
    assert.equal(result.scenario.notionalUsd, original.scenario.notionalUsd);
  }
  assert.deepEqual(input, original);
  assert.ok(cells[0].navPrice < cells[35].navPrice);
  assert.ok(cells[0].ammLiquidityUsd > cells.at(-1).ammLiquidityUsd);
});

test('current-data grid cannot hide stale references behind favorable scenario prices', async () => {
  const input = await baseline();
  input.scenario.mode = 'current';
  input.asset.priceAgeSec = 86_400;
  const cells = buildStressGrid(input, { navMax: input.asset.navPrice * 1.5, liquidityMax: 800_000 });
  assert.ok(cells.every(c => c.status === 'CRITICAL'));
});
