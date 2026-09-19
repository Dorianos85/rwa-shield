#!/usr/bin/env node
/**
 * SWARM - uruchamia cala armie po kolei i zostawia raport, ktory idzie na slajd.
 *   1. KALIBRATOR  dopasowuje parametry do historii
 *   2. BACKTEST    liczy tabele scenariuszy na dopasowanych parametrach
 *   3. ADWERSARZ   szuka rynku, ktorego dopasowany model nie przezyje
 * Wynik: data/report.json
 */
import { spawn } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';

const steps = [
  ['KALIBRATOR', 'src/agents/calibrator.mjs'],
  ['BACKTEST', 'src/backtest/run.mjs'],
  ['ADWERSARZ', 'src/agents/adversary.mjs']
];

const log = [];
for (const [name, file] of steps) {
  console.log(`\n=== ${name} ===`);
  const out = await run(file);
  log.push({ agent: name, finishedAt: new Date().toISOString(), tailOutput: out.slice(-1200) });
}

let params = null;
try { params = JSON.parse(await readFile(new URL('../../data/params.fitted.json', import.meta.url), 'utf8')); } catch {}
await writeFile(new URL('../../data/report.json', import.meta.url),
  JSON.stringify({ generatedAt: new Date().toISOString(), calibration: params?.score ?? null, log }, null, 2));
console.log('\nzapisano data/report.json');

function run(file) {
  return new Promise((resolve) => {
    let buf = '';
    const p = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout.on('data', d => { buf += d; process.stdout.write(d); });
    p.stderr.on('data', d => { buf += d; process.stderr.write(d); });
    p.on('close', () => resolve(buf));
  });
}
