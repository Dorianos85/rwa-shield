import { sessionState } from './session.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';

const UNDERLYING = { SPYx: 'SPDR S&P 500 ETF Trust', QQQx: 'Invesco QQQ Trust', NVDAx: 'NVIDIA', TSLAx: 'Tesla', CRCLx: 'Circle Internet Group' };

/** An explicit price proxy: no unauthenticated issuer NAV feed has been verified. */
export function getXstockAsset({ reserve, now = Date.now() }) {
  const timestamp = reserve.oracleTimestamp;
  const age = timestamp ? Math.max(0, (now - Date.parse(timestamp)) / 1000) : null;
  return {
    symbol: reserve.symbol, mint: reserve.mint, underlying: UNDERLYING[reserve.symbol] ?? reserve.symbol,
    navPrice: reserve.kaminoOraclePrice, navType: 'Kamino oracle reference proxy — not independent issuer NAV',
    issuerNav: { value: null, available: false, reason: 'No verified public independent issuer NAV endpoint configured.' },
    priceTimestamp: timestamp, priceAgeSec: age, priceAgeAvailable: age !== null,
    priceAgeAtCaptureSec: reserve.priceAgeAtCaptureSec,
    sessionState: sessionState(new Date(now)), realizedVolAnnual: DEFAULT_PARAMS.volRefAnnual,
    modeledAssumptions: ['Reference price uses the Kamino oracle proxy; no independent NAV/oracle divergence can be inferred.', 'Volatility uses the existing volRefAnnual model prior, not measured realized volatility.'],
    source: { ...reserve.oracleSource, ageSec: age, referenceKind: 'oracle-proxy', independentNav: false },
  };
}
