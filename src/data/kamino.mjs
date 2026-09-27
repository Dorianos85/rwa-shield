import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../../data/kamino.snapshot.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
const BASE = 'https://api.kamino.finance';
const cache = new Map();
const knownMarkets = new Map(snapshot.markets.map(m => [m.config.lendingMarket, m.config]));
let discovery = null;
const TTL_MS = 60_000;
const TIMEOUT_MS = 5_000;
export const DEFAULT_MARKET = '5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua';
export const SUPPORTED_SYMBOLS = ['SPYx', 'QQQx', 'NVDAx', 'TSLAx', 'CRCLx'];
const isAsset = row => SUPPORTED_SYMBOLS.includes(row.liquidityToken);
const num = value => value !== null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
const unavailable = reason => ({ value: null, available: false, reason });

export function provenance(source, timestamp, { live = false, cached = false, fallback = false, fallbackReason = null, now = Date.now() } = {}) {
  const ms = Date.parse(timestamp);
  return { source, timestamp, ageSec: Number.isFinite(ms) ? Math.max(0, (now - ms) / 1000) : null, live, cached, fallback, fallbackReason };
}

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = TIMEOUT_MS, headers = {} } = {}) {
  const response = await fetchImpl(url, { headers: { accept: 'application/json', ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    let body;
    try { body = await response.json(); } catch { /* transport errors need not contain JSON */ }
    throw Object.assign(new Error(`Upstream HTTP ${response.status}`), {
      status: response.status,
      upstreamCode: typeof body?.errorCode === 'string' ? body.errorCode : null
    });
  }
  return response.json();
}

function base58(bytes) {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let value = BigInt('0x' + Buffer.from(bytes).toString('hex'));
  let result = '';
  while (value > 0n) { result = alphabet[Number(value % 58n)] + result; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; result = '1' + result; }
  return result;
}

/** Pinned official SDK 38845294447623f6de3afc9dec29875f959f6f48, Reserve/ReserveConfig layouts.
 * No guessed layouts: reject changed account size, discriminator, mint, market or LTV.
 * All offsets include the 8-byte Anchor discriminator. Caps are raw token units.
 */
export function decodeReserveConfig(encoded, { mint, market, ltv } = {}) {
  const b = Buffer.from(encoded, 'base64');
  if (b.length !== 8624 || !b.subarray(0, 8).equals(Buffer.from([43, 242, 204, 202, 26, 247, 59, 127]))) throw new Error('Unsupported Kamino reserve account layout');
  if ((market && base58(b.subarray(32, 64)) !== market) || (mint && base58(b.subarray(128, 160)) !== mint)) throw new Error('Reserve account identity mismatch');
  const decimals = Number(b.readBigUInt64LE(272));
  const configuredLtv = b[4872] / 100;
  const liquidationThreshold = b[4873] / 100;
  if (decimals > 18 || configuredLtv > liquidationThreshold || liquidationThreshold > 1 || (ltv != null && Math.abs(ltv - configuredLtv) > 1e-9)) throw new Error('Reserve config validation failed');
  const borrowRateCurve = [];
  for (let i = 0; i < 11; i++) {
    const utilization = b.readUInt32LE(4920 + i * 8) / 10000;
    const borrowRate = b.readUInt32LE(4924 + i * 8) / 10000;
    if (utilization > 1 || (i && utilization < borrowRateCurve.at(-1).utilization)) throw new Error('Invalid rate curve');
    if (!borrowRateCurve.some(p => p.utilization === utilization)) borrowRateCurve.push({ utilization, borrowRate });
  }
  const cap = offset => b.readBigUInt64LE(offset) === (1n << 64n) - 1n ? null : Number(b.readBigUInt64LE(offset)) / 10 ** decimals;
  return {
    decimals, configuredLtv, liquidationThreshold,
    supplyCapTokens: cap(5016), borrowCapTokens: cap(5024), borrowRateCurve,
    firstCurveKink: borrowRateCurve.find(p => p.utilization > 0 && p.utilization < 1)?.utilization ?? null,
    oracleAddress: base58(b.subarray(5112, 5144)), oracleType: 'Kamino Scope price chain',
    oracleSlot: Number(b.readBigUInt64LE(16)),
    accountPriceTimestamp: new Date(Number(b.readBigUInt64LE(264)) * 1000).toISOString(),
    availableTokensOnchain: Number(b.readBigUInt64LE(224)) / 10 ** decimals,
  };
}

export function normalizeReserve(row, bundle, { source, now = Date.now() } = {}) {
  const tvlUsd = num(row.totalSupplyUsd), borrowedUsd = num(row.totalBorrowUsd), supplyTokens = num(row.totalSupply);
  if (!(tvlUsd > 0) || !(borrowedUsd >= 0) || borrowedUsd > tvlUsd || !(supplyTokens > 0) || !(num(row.maxLtv) >= 0 && num(row.maxLtv) <= 1)) throw new Error('Invalid reserve metrics');
  let config = {}, configReason = null;
  try {
    const account = bundle.accounts.find(a => a.pubkey === row.reserve);
    if (!account) throw new Error('Reserve account data unavailable');
    config = decodeReserveConfig(account.data, { mint: row.liquidityTokenMint, market: bundle.config.lendingMarket, ltv: num(row.maxLtv) });
  } catch (error) { configReason = error.message; }
  const oracle = bundle.prices.find(p => p.mint === row.liquidityTokenMint);
  const kaminoOraclePrice = num(oracle?.price) ?? tvlUsd / supplyTokens;
  if (!(kaminoOraclePrice > 0)) throw new Error('Invalid oracle price');
  const published = num(oracle?.timestamp);
  const timestamp = published !== null && published > 0 ? new Date(published * 1000).toISOString() : null;
  const priceSource = provenance(oracle ? `${BASE}/oracles/prices?markets=all` : 'Kamino supply USD / token quantity (implied price)', timestamp, { ...source, now });
  // Keep endpoint identity separate from shared cache/live flags.
  priceSource.source = oracle ? `${BASE}/oracles/prices?markets=all` : 'Kamino implied reserve price';
  const fields = {};
  for (const name of ['liquidationThreshold', 'borrowCapUsd', 'supplyCapUsd', 'borrowRateCurve', 'decimals', 'oracleAddress']) {
    if (configReason) fields[name] = unavailable(configReason);
  }
  fields.optimalUtilization = unavailable('Kamino exposes a multi-point rate curve, not a single optimal utilization field. First curve kink is reported separately.');
  return {
    market: bundle.config.lendingMarket, marketName: bundle.config.name, reserve: row.reserve, address: row.reserve,
    symbol: row.liquidityToken, mint: row.liquidityTokenMint, tvlUsd, currentBorrowedUsd: borrowedUsd,
    currentAvailableUsd: Math.max(0, tvlUsd - borrowedUsd), currentUtilization: borrowedUsd / tvlUsd,
    configuredLtv: num(row.maxLtv), liquidationThreshold: config.liquidationThreshold ?? null,
    borrowCapUsd: config.borrowCapTokens == null ? null : config.borrowCapTokens * kaminoOraclePrice,
    supplyCapUsd: config.supplyCapTokens == null ? null : config.supplyCapTokens * kaminoOraclePrice,
    borrowCapTokens: config.borrowCapTokens ?? null, supplyCapTokens: config.supplyCapTokens ?? null,
    optimalUtilization: null, firstCurveKink: config.firstCurveKink ?? null, borrowRateCurve: config.borrowRateCurve ?? null,
    decimals: config.decimals ?? null, oracleAddress: config.oracleAddress ?? null, oracleType: config.oracleType ?? null,
    oracleSlot: config.oracleSlot ?? null, kaminoOraclePrice, oracleTimestamp: timestamp,
    oracleMaxAgeSec: num(oracle?.maxAgeInSeconds), oracleSource: priceSource,
    priceAgeAtCaptureSec: timestamp ? Math.max(0, (Date.parse(source.timestamp) - Date.parse(timestamp)) / 1000) : null,
    borrowApy: num(row.borrowApy), supplyApy: num(row.supplyApy), unavailable: fields, source,
    notes: ['TVL means supplied USD, not net TVL. Available USD is supply minus borrow; protocol fees can differ from raw vault balance.', 'Borrow cap covers borrowing this token, not USDC loans secured by this collateral. Caps exclude elevation-group-specific limits.'],
  };
}

async function loadBundle(market, options = {}) {
  const { offline = false, refresh = false, fetchImpl = fetch, now = Date.now() } = options;
  const stored = snapshot.markets.find(m => m.config.lendingMarket === market);
  const prior = cache.get(market);
  if (!knownMarkets.has(market)) throw new RangeError('Unknown Kamino market');
  if (!offline && !refresh && prior && now - prior.loadedAt < TTL_MS) return { bundle: prior.bundle, source: provenance(BASE, prior.timestamp, { live: false, cached: true, now }) };
  if (!offline) {
    try {
      const [metrics, accounts, allPrices] = await Promise.all([
        fetchJson(`${BASE}/kamino-market/${market}/reserves/metrics`, { fetchImpl }),
        fetchJson(`${BASE}/kamino-market/reserves/account-data?markets=${market}`, { fetchImpl }),
        fetchJson(`${BASE}/oracles/prices?markets=all`, { fetchImpl }),
      ]);
      if (![metrics, accounts, allPrices].every(Array.isArray)) throw new Error('Invalid upstream JSON shape');
      const bundle = { config: knownMarkets.get(market), metrics, accounts: accounts.find(a => a.market === market)?.reserves ?? [], prices: allPrices.find(a => a.lendingMarket === market)?.prices ?? [] };
      if (!metrics.some(isAsset)) throw new Error('No verified supported xStocks reserves');
      const timestamp = new Date(now).toISOString();
      const source = provenance(BASE, timestamp, { live: true, now });
      for (const row of metrics.filter(isAsset)) normalizeReserve(row, bundle, { source, now });
      cache.set(market, { bundle, loadedAt: now, timestamp });
      return { bundle, source };
    } catch (error) {
      const bundle = prior?.bundle ?? stored;
      if (!bundle) throw new Error('Newly discovered market is unavailable and has no recorded snapshot');
      return { bundle, source: provenance(BASE, prior?.timestamp ?? snapshot.capturedAt, { cached: !!prior, fallback: true, fallbackReason: error.message, now }) };
    }
  }
  if (!stored) throw new RangeError('No recorded snapshot for this market');
  return { bundle: stored, source: provenance(BASE, snapshot.capturedAt, { fallback: true, fallbackReason: 'Offline recorded snapshot requested', now }) };
}

export async function getKaminoMarkets(options = {}) {
  const now = options.now ?? Date.now();
  let configs = snapshot.markets.map(m => m.config);
  if (!options.offline) {
    try {
      if (!discovery || options.refresh || now - discovery.loadedAt >= TTL_MS) {
        const list = await fetchJson(`${BASE}/v2/kamino-market`, options);
        if (!Array.isArray(list)) throw new Error('Invalid market discovery response');
        const selected = list.filter(m => /xstocks/i.test(m.name) && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(m.lendingMarket));
        if (!selected.length) throw new Error('No xStocks markets discovered');
        discovery = { configs: selected, loadedAt: now };
        for (const config of selected) knownMarkets.set(config.lendingMarket, config);
      }
      configs = discovery.configs;
    } catch { configs = discovery?.configs ?? configs; }
  }
  // Discover verified reserve membership; supported symbol universe is deliberate.
  const settled = await Promise.allSettled(configs.map(async config => {
    const { bundle, source } = await loadBundle(config.lendingMarket, options);
    return { address: bundle.config.lendingMarket, name: bundle.config.name, source,
      reserves: SUPPORTED_SYMBOLS.flatMap(symbol => bundle.metrics.filter(r => r.liquidityToken === symbol).map(r => ({ symbol, mint: r.liquidityTokenMint, address: r.reserve }))) };
  }));
  const markets = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
  return { markets, source: { source: `${BASE}/v2/kamino-market`, timestamp: markets[0]?.source.timestamp ?? snapshot.capturedAt,
    ageSec: markets[0]?.source.ageSec ?? null, live: markets.length > 0 && markets.every(m => m.source.live), cached: markets.some(m => m.source.cached),
    fallback: markets.some(m => m.source.fallback), fallbackReason: markets.find(m => m.source.fallback)?.source.fallbackReason ?? null } };
}

export async function getKaminoReserve({ market = DEFAULT_MARKET, symbol = 'SPYx', ...options } = {}) {
  if (!SUPPORTED_SYMBOLS.includes(symbol)) throw new RangeError('Unknown xStock asset');
  const { bundle, source } = await loadBundle(market, options);
  const row = bundle.metrics.find(r => r.liquidityToken === symbol);
  if (!row) throw new RangeError('Asset is not listed in this Kamino market');
  return normalizeReserve(row, bundle, { source, now: options.now });
}
