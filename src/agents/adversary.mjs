#!/usr/bin/env node
/**
 * AGENT 2 - ADVERSARY (red team)
 *
 * Takes the current parameters and hunts for the market it cannot survive:
 * it sweeps gap size, depth collapse and liquidation lag, and reports the
 * cheapest combination that produces bad debt. Whatever it finds goes on the
 * slide - a model whose breaking point you can state is trusted; one presented
 * as unbreakable is not.
 */

import { readFile } from 'node:fs/promises';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { generateSeries, loadSeries } from '../data/prices.mjs';
import { runBacktest } from '../backtest/engine.mjs';

let params = DEFAULT_PARAMS;
try {
  params = JSON.parse(await readFile(new URL('../../data/params.fitted.json', import.meta.url), 'utf8')).params;
  console.log('ADWERSARZ: atakuje parametry dopasowane przez kalibratora\n');
} catch { console.log('ADWERSARZ: atakuje parametry domyslne\n'); }

const base = (await loadSeries('SPYx')) ?? generateSeries();

const GAPS = [0.95, 0.90, 0.85, 0.80, 0.75, 0.70];
const DEPTHS = [1.0, 0.7, 0.5, 0.3, 0.15];

const breaks = [];
for (const gap of GAPS) {
  for (const depth of DEPTHS) {
    const series = applyGap(base, gap);
    const r = runBacktest(series, { params, depthStressFactor: depth, label: `gap${gap}_depth${depth}` });
    if (r.ecv.badDebt > 0) {
      breaks.push({
        'gap przy otwarciu': `${Math.round((1 - gap) * 100)}%`,
        'glebokosc': `${Math.round(depth * 100)}%`,
        'zly dlug ECV': '$' + Math.round(r.ecv.badDebt).toLocaleString('en-US'),
        'zly dlug FIXED': '$' + Math.round(r.fixed.badDebt).toLocaleString('en-US')
      });
    }
  }
}

if (!breaks.length) {
  console.log('Brak zlego dlugu w calej przeszukanej siatce (gap do -30%, glebokosc do 15%).');
  console.log('To NIE znaczy, ze model jest bezpieczny - znaczy, ze siatka jest za waska.');
  console.log('Rozszerz GAPS/DEPTHS w src/agents/adversary.mjs przed pitchem.');
} else {
  console.log('Najtansze warunki, w ktorych ECV zaczyna generowac zly dlug:\n');
  console.table(breaks.slice(0, 12));
  console.log('\nTo jest nasz punkt zlamania. Podajemy go sedziom sami.');
}

function applyGap(series, factor) {
  let week = 0;
  return series.map((x) => {
    const d = new Date(x.t);
    const mondayOpen = d.getUTCDay() === 1 && d.getUTCHours() === 13;
    if (mondayOpen) week++;
    return (mondayOpen && week % 3 === 0) ? { ...x, p: x.p * factor } : x;
  });
}
