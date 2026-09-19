/**
 * Backtest: the same loan book, priced two ways.
 *
 *   A) fixed 70% LTV on the oracle price  - what every venue does today
 *   B) ECV                                - what we propose
 *
 * We open positions on a schedule, mark them every hour, liquidate when the
 * health factor breaks, and measure what the pool actually recovered. Bad debt
 * is the number that matters; capital efficiency is the number that keeps us
 * honest about not just lending nothing.
 */

import { computeEcv, healthFactor, recoveryOnLiquidation } from '../ecv/model.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { sessionState } from '../data/session.mjs';
import { realizedVolAnnual } from '../data/volatility.mjs';
import { syntheticQuote } from '../data/jupiter.mjs';

const FIXED_LTV = 0.70;
const LIQ_THRESHOLD = 1.0;

/** Hours between trigger and actual execution, by state of the underlying market. */
const LIQ_LAG_HOURS = { regular: 1, afterHours: 5, weekend: 16, holiday: 16 };

/**
 * @param {{t:number,p:number}[]} series hourly closes
 * @param {object} opts
 */
export function runBacktest(series, opts = {}) {
  const {
    params = DEFAULT_PARAMS,
    openEveryHours = 7,
    positionUsd = 100_000,
    depthUsd = 400_000,
    depthStressFactor = 1.0,    // <1 simulates a thinner book than today
    maturityHours = 96,         // borrowers repay; this also bounds the open book
    label = 'base'
  } = opts;

  const books = {
    fixed: newBook('fixed 70% LTV'),
    ecv: newBook('ECV')
  };

  for (let i = 60; i < series.length; i++) {
    const { t, p } = series[i];
    const now = new Date(t);
    const state = sessionState(now);
    const hist = series.slice(0, i + 1).map(x => x.p);
    const vol = realizedVolAnnual(hist, params.volWindowDays);

    const qty = positionUsd / series[i].p;
    const effDepth = depthUsd * depthStressFactor * (state === 'regular' ? 1 : 0.4);
    const q = syntheticQuote({ notionalUsd: positionUsd, depthUsd: effDepth });

    const input = {
      mint: 'SPYx', symbol: 'SPYx', qty,
      oraclePrice: p, twapPrice: avg(hist.slice(-6)),
      priceAgeSec: 5,
      impactPct: q.impactPct,
      routableUsd: Math.min(effDepth, positionUsd * 2),
      sessionState: state,
      realizedVolAnnual: vol
    };

    const r = computeEcv(input, params);

    // 1. open new positions on schedule.
    //    The fixed-LTV venue lends regardless of conditions - it cannot see them.
    //    ECV refuses when a breaker is up; every refusal is counted, because
    //    "we lent nothing" is also a cost and the comparison must show it.
    if (i % openEveryHours === 0) {
      books.fixed.open.push({ qty, openedAt: t, debt: r.fixedLtvBorrow, openValue: positionUsd });
      books.fixed.lent += r.fixedLtvBorrow;
      if (r.outputs.borrow_disabled) {
        books.ecv.refusals++;
      } else {
        books.ecv.open.push({ qty, openedAt: t, debt: r.outputs.max_borrow, openValue: positionUsd });
        books.ecv.lent += r.outputs.max_borrow;
      }
    }

    // 2. mark and liquidate
    for (const key of ['fixed', 'ecv']) {
      const book = books[key];
      const still = [];
      for (const pos of book.open) {
        const posInput = { ...input, qty: pos.qty };
        const marked = computeEcv(posInput, params);
        const hf = key === 'ecv'
          ? healthFactor(marked.executableValue, pos.debt, params)
          // the fixed-LTV venue marks on the oracle price alone - it has no way
          // of knowing what the position would actually sell for
          : (pos.qty * p * 0.80) / pos.debt;

        if (hf < LIQ_THRESHOLD) {
          // liquidate into the book that exists at this moment, not the quoted price
          // both books liquidate into the SAME real book - the difference is
          // only how much debt they allowed against it and how early they act
          const recovery = recoveryOnLiquidation(marked.executableValue, params);
          const shortfall = Math.max(0, pos.debt - recovery);
          book.liquidations++;
          book.badDebt += shortfall;
          if (shortfall > 0) book.badLiquidations++;
          book.recovered += Math.min(pos.debt, recovery);
          if (state !== 'regular') book.offHoursLiquidations++;
        } else {
          still.push(pos);
        }
      }
      book.open = still;
    }
  }

  for (const key of ['fixed', 'ecv']) {
    const b = books[key];
    b.openPositions = b.open.length;
    b.positionsOpened = b.liquidations + b.open.length;
    delete b.open;
  }

  return {
    label,
    hours: series.length,
    fixed: books.fixed,
    ecv: books.ecv,
    delta: {
      lentRatio: books.fixed.lent > 0 ? round2(books.ecv.lent / books.fixed.lent) : 0,
      badDebtAvoided: round2(books.fixed.badDebt - books.ecv.badDebt),
      badDebtAvoidedPct: books.fixed.badDebt > 0
        ? round2(100 * (books.fixed.badDebt - books.ecv.badDebt) / books.fixed.badDebt) : 0,
      lentLess: round2(books.fixed.lent - books.ecv.lent),
      lentLessPct: books.fixed.lent > 0
        ? round2(100 * (books.fixed.lent - books.ecv.lent) / books.fixed.lent) : 0
    }
  };
}

function newBook(name) {
  return {
    name, open: [], lent: 0, recovered: 0, badDebt: 0, refusals: 0, repaid: 0,
    liquidations: 0, badLiquidations: 0, offHoursLiquidations: 0
  };
}
const avg = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
const round2 = (x) => Math.round(x * 100) / 100;
