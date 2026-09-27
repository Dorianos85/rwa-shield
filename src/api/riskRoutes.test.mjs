import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('offline HTTP integration preserves legacy routes and validates risk-lab requests', async t => {
  const child = spawn(process.execPath, ['src/api/server.mjs'], {
    cwd: new URL('../../', import.meta.url),
    env: { ...process.env, PORT: '0', RISK_OFFLINE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`server_start_timeout: ${output}`)), 10_000);
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = output.match(/http:\/\/localhost:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    child.stderr.on('data', chunk => { output += chunk; });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`server_exit_${code}: ${output}`)); });
    child.once('error', reject);
  });
  const get = async path => {
    const response = await fetch(base + path);
    const data = await response.json();
    return { response, data };
  };

  for (const path of ['/api/state', '/api/ecv', '/api/backtest', '/api/agents']) {
    const { response, data } = await get(path);
    assert.equal(response.status, 200, path);
    if (path === '/api/ecv') {
      for (const key of ['max_borrow', 'collateral_cap', 'liquidation_route', 'risk_premium', 'borrow_disabled']) {
        assert.ok(Object.hasOwn(data.outputs, key), key);
      }
    }
  }
  const { data: discovery, response: marketsResponse } = await get('/api/kamino/markets');
  assert.equal(marketsResponse.status, 200);
  assert.ok(discovery.markets.length > 0);
  const { data: baseline, response: baselineResponse } = await get('/api/risk/baseline?symbol=SPYx');
  assert.equal(baselineResponse.status, 200, JSON.stringify(baseline));
  assert.ok(baseline.reserve.tvlUsd > 0);
  assert.equal(baseline.reserve.source.live, false);
  assert.equal(baseline.asset.source.live, false);
  assert.equal(baseline.execution.source.live, false);
  assert.equal(baseline.execution.available, false);
  assert.equal(baseline.execution.routableUsd, 0);
  assert.deepEqual(baseline.execution.curve, []);
  const { data: forcedOffline } = await get('/api/risk/baseline?symbol=TSLAx&execution=jupiter');
  assert.equal(forcedOffline.execution.available, false, 'RISK_OFFLINE prevents all Jupiter requests');
  const { data: explicitSynthetic } = await get('/api/risk/baseline?symbol=TSLAx&execution=synthetic');
  assert.equal(explicitSynthetic.execution.measured, false);
  assert.ok(explicitSynthetic.execution.curve.length > 0);
  assert.equal(explicitSynthetic.execution.source.live, false);
  assert.equal(baseline.fundingReserve.symbol, 'USDC');
  assert.equal(baseline.fundingReserve.market, baseline.reserve.market);
  assert.notEqual(baseline.fundingReserve.reserve, baseline.reserve.reserve);

  const { data: result, response: compareResponse } = await get('/api/risk/compare?symbol=SPYx&utilization=0.92&averageHealthFactor=1.8');
  assert.equal(compareResponse.status, 200, JSON.stringify(result));
  assert.equal(result.reserve.symbol, 'USDC');
  assert.equal(result.collateralReserve.symbol, 'SPYx');
  assert.equal(result.collateralReserve.configuredLtv, baseline.reserve.configuredLtv);
  assert.equal(result.asset.kaminoOraclePrice, baseline.reserve.kaminoOraclePrice);
  assert.equal(result.reserve.tvlUsd, baseline.fundingReserve.tvlUsd);
  assert.ok(Math.abs(result.reserve.scenarioBorrowedUsd - baseline.fundingReserve.tvlUsd * 0.92) < 0.01);
  assert.ok(Math.abs(result.reserve.scenarioAvailableUsd - baseline.fundingReserve.tvlUsd * 0.08) < 0.01);
  assert.ok(result.boundaries.nav);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(result)));

  const alternateMarket = discovery.markets.find(m => m.name.includes('Sentora')).address;
  const { data: missing } = await get(`/api/risk/baseline?market=${alternateMarket}&symbol=SPYx`);
  assert.equal(missing.fundingReserve, null);
  assert.match(missing.fundingReserveUnavailable, /No verified USDC/);
  const { data: unavailable, response: missingResponse } = await get(`/api/risk/compare?market=${alternateMarket}&symbol=SPYx&mode=sandbox`);
  assert.equal(missingResponse.status, 200);
  assert.equal(unavailable.overallStatus, 'CRITICAL');
  assert.equal(unavailable.reserve.tvlUsd, null);
  assert.equal(unavailable.rwaShield.borrowDisabled, true);

  for (const path of [
    '/api/risk/compare?utilization=1', '/api/risk/compare?notional=Infinity',
    '/api/risk/compare?notional=-5', '/api/risk/compare?notional=1000000000000',
    '/api/risk/compare?navPrice=NaN', '/api/risk/compare?averageHealthFactor=',
    '/api/risk/compare?mode=live-ish', '/api/risk/baseline?symbol=FAKEx', '/api/risk/baseline?execution=unknown',
    '/api/risk/baseline?market=not-a-market',
    '/api/risk/baseline?market=11111111111111111111111111111111'
  ]) {
    const { response, data } = await get(path);
    assert.equal(response.status, 400, `${path}: ${JSON.stringify(data)}`);
  }
  for (const path of ['/api/risk/compare?navPrice=0', '/api/risk/compare?ammLiquidityUsd=0', '/api/risk/compare?utilization=0.999&averageHealthFactor=0.5']) {
    const { response, data } = await get(path);
    assert.equal(response.status, 200, JSON.stringify(data));
    assert.equal(data.overallStatus, 'CRITICAL');
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(data)));
  }
  for (const path of ['/', '/risk', '/web/risk.js', '/web/risk.css', '/src/risk/kaminoRisk.mjs']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    if (path.endsWith('.mjs')) assert.match(response.headers.get('content-type'), /javascript/);
  }
  for (const path of ['/.git/config', '/package.json', '/src/data/kamino.mjs', '/src/api/server.mjs', '/web/%2e%2e/.git/config']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/api/risk/compare', { method: 'POST' })).status, 405);
});
