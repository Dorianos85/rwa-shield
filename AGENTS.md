# Instrukcja dla agentów kodujących (Claude Code / Codex / inne)

Ten plik jest kontraktem. Przeczytaj go w całości przed pierwszą zmianą.

## Zasady twarde

1. **Nie zmieniasz sygnatur w `src/ecv/model.mjs` ani kształtu `outputs`.**
   Pięć pól (`max_borrow`, `collateral_cap`, `liquidation_route`, `risk_premium`,
   `borrow_disabled`) to kontrakt z resztą systemu. Zmiana = zepsute demo.
2. **Zero nowych zależności.** Node 20+, biblioteka standardowa. Jeśli uważasz, że
   potrzebujesz paczki — napisz dlaczego w PR i zaproponuj alternatywę bez niej.
3. **Każda zmiana w `src/ecv/` wymaga testu** w `src/ecv/model.test.mjs`.
   `node --test src/ecv/*.test.mjs` musi przechodzić przed commitem.
4. **Nie wymyślasz liczb.** Każdy parametr ma trafić do `src/ecv/params.mjs`
   z granicami, żeby kalibrator mógł go dopasować. Magic number w kodzie = bug.
5. **Offline musi działać.** Każdy adapter sięgający do sieci ma fallback.
   Demo nie może paść, bo Jupiter zwrócił 429.
6. **Polski w treściach dla zespołu, angielski w kodzie i komentarzach technicznych.**

## Definicja „gotowe" dla dowolnego zadania

- `node --test src/ecv/*.test.mjs` zielone
- `node src/backtest/run.mjs` kończy się tabelą, bez wyjątków
- `node src/api/server.mjs` wstaje i `/api/ecv` zwraca 200
- zmiana opisana jednym zdaniem w commit message: co i dlaczego

## Kolejność pracy, jeśli pracujesz równolegle z innymi agentami

Pliki są rozdzielone tak, żeby dwa agenty nie dotykały tego samego:

| Agent | Wolno dotykać | Nie dotykać |
|---|---|---|
| A — model | `src/ecv/*` | wszystkiego innego |
| B — dane | `src/data/*` | `src/ecv/*` |
| C — backtest | `src/backtest/*` | `src/ecv/*`, `web/*` |
| D — agenci | `src/agents/*` | `src/ecv/*` |
| E — API/UI | `src/api/*`, `web/*` | `src/ecv/*`, `src/backtest/*` |

Zadania szczegółowe: katalog `tasks/`.

## Ludzie / collaboratorzy GitHub

| GitHub | Rola | Zakres |
|---|---|---|
| `investiatech` | Rust / Anchor development | On-chain (po MVP demo), programy Solana. **Nie rusza** pięciu wyjść ECV w `src/ecv/model.mjs`. Czyta `AGENTS.md` przed pierwszym PR. Invite: write na `Dorianos85/rwa-shield`. |

