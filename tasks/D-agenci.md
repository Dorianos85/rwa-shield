# AGENT D — armia agentów
Pliki: `src/agents/*`. Czas: 2h.

1. Kalibrator: zamień coordinate descent na random search + local refine
   (100 losowań, potem 2 przejścia po współrzędnych). Zapisuj wszystkie próby do
   `data/calibration.trace.json` — wykres zbieżności to dobry slajd.
2. Adwersarz: zapisuj wynik do `data/adversary.json` w formacie
   `{breaks: number, cheapest: string, grid: [...]}` — UI już tego oczekuje.
3. Monitor: dodaj tryb `--once --json` (jedno przejście, wyjście JSON), żeby dał
   się wpiąć w cron.
4. Nowy agent: `src/agents/reporter.mjs` — czyta `data/report.json` i wypisuje
   6-zdaniowe podsumowanie po polsku, gotowe do wklejenia na Telegram.

GOTOWE, gdy: `node src/agents/swarm.mjs` przechodzi całość i zostawia komplet
plików w `data/`.
