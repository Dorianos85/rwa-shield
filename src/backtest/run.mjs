#!/usr/bin/env node
/** Runs every scenario and prints the table that goes on the pitch slide. */

import { runBacktest } from './engine.mjs';
import { SCENARIOS } from './scenarios.mjs';
import { generateSeries, loadSeries, loadSeriesSource } from '../data/prices.mjs';
import { DEFAULT_PARAMS } from '../ecv/params.mjs';
import { readFile } from 'node:fs/promises';

const symbol = process.argv[2] || 'SPYx';

let params = DEFAULT_PARAMS;
try {
  const fitted = JSON.parse(await readFile(new URL('../../data/params.fitted.json', import.meta.url), 'utf8'));
  params = fitted.params;
  console.log('using fitted params from data/params.fitted.json\n');
} catch { console.log('using default params (run `npm run calibrate` to fit)\n'); }

const real = await loadSeries(symbol);
const base = real ?? generateSeries();
const provenance = real ? (await loadSeriesSource(symbol)) : null;
console.log(`series: ${real ? 'real ' + symbol : 'generated'} | ${base.length} hourly points\n`);
if (provenance) console.log(`source: ${provenance}\n`);

const rows = [];
for (const sc of SCENARIOS) {
  const series = sc.transform(base);
  const r = runBacktest(series, { params, depthStressFactor: sc.depthStressFactor, label: sc.label });
  rows.push({
    scenario: sc.label,
    'zly dlug FIXED': usd(r.fixed.badDebt),
    'zly dlug ECV': usd(r.ecv.badDebt),
    'uniknieto': usd(r.delta.badDebtAvoided) + `  (${r.delta.badDebtAvoidedPct}%)`,
    'kredyt mniej': `${r.delta.lentLessPct}%`,
    'likwidacje poza sesja': `${r.ecv.offHoursLiquidations}`
  });
}

console.table(rows);
console.log('\nCzytanie tabeli: ECV pozycza mniej, ale traci istotnie mniej.');
console.log('Roznica to dokladnie ten dlug, ktory w modelu ze stalym LTV pokrywa wspolna pula.\n');

function usd(x) { return '$' + Math.round(x).toLocaleString('en-US'); }
