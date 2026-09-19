# RWA Shield — Executable Collateral Value

**Landing:** https://dorianos85.github.io/rwa-shield/
**Live demo path:** `DEMO_RUNBOOK.md`

Warstwa ryzyka dla lendingu pod tokenizowane akcje na Solanie. Zamiast stałego LTV
liczy **ECV** — kwotę USDC, jaką likwidacja pozycji realnie zwróci w obecnych
warunkach płynności, sesji giełdowej i zmienności.

```
ECV = P_oracle × D(q) × S(q) × M(t) × V(σ)          B = breaker (bramkuje nowy kredyt)
```

## Uruchomienie (zero instalacji, Node 20+)

```bash
node src/api/server.mjs      # dashboard demo:  http://localhost:8787
node --test src/ecv/*.test.mjs
node src/backtest/run.mjs    # tabela scenariuszy
node src/agents/swarm.mjs    # kalibrator -> backtest -> adwersarz
```

Brak `npm install`. Brak build stepu. To jest celowe: w nocy przed pitchem każda
zależność to ryzyko, że coś nie ruszy na cudzym laptopie.

## Co tu jest i dlaczego

| Plik | Odpowiada za | Zasada |
|---|---|---|
| `src/ecv/model.mjs` | sześć członów ECV, health factor, recovery | czyste funkcje, zero I/O, w pełni testowalne |
| `src/ecv/params.mjs` | parametry + ich granice | każda liczba ma granice, bo kalibrator w nich szuka |
| `src/data/jupiter.mjs` | realny impact i trasa z Jupitera + fallback offline | mierzymy egzekucję, nie zakładamy jej |
| `src/data/session.mjs` | stan sesji NYSE w UTC, godziny do otwarcia | 63% obrotu dzieje się przy zamkniętym rynku |
| `src/data/volatility.mjs` | realized vol, odchylenia od średniej | |
| `src/backtest/engine.mjs` | ta sama książka pożyczek wyceniona dwoma modelami | |
| `src/backtest/scenarios.mjs` | 6 scenariuszy stresu | |
| `src/agents/*` | kalibrator, adwersarz, monitor, swarm | |
| `src/api/server.mjs` | API + host dashboardu, zero zależności | |
| `web/index.html` | demo: wodospad wyceny, stress, backtest, agenci | |

## Dwie decyzje modelowe, o które zapyta sędzia

**1. Breaker bramkuje nowy kredyt, nie wycenę istniejącego zabezpieczenia.**
Gdyby stary feed zerował wycenę otwartych pozycji, każda awaria oracla
likwidowałaby całą książkę — czyli dokładnie kaskada, której mamy zapobiegać.
`borrow_disabled = true`, ale `executableValue` zostaje.

**2. Health factor liczy się od wartości egzekucyjnej, nie od ECV.**
Haircut za zamknięty rynek chroni pulę **przy udzielaniu** kredytu. Gdyby wchodził
też do marku, w każdy piątek wieczorem likwidowalibyśmy zdrowe pozycje.

## Co model potrafi — wyniki backtestu

110 dni godzinowych danych, pozycje otwierane co 7h, zapadalność 96h,
likwidacja z opóźnieniem zależnym od sesji (1h w sesji, 16h w weekend — bo nikt
nie chce brać inwentarza, którego nie może zahedgować).

| Scenariusz | Zły dług: stałe 70% LTV | Zły dług: ECV | Kredyt vs fixed |
|---|---|---|---|
| Rynek bazowy | $0 | $0 | 100% |
| Weekend gap −14% | $0 | $0 | 22% |
| **Ogon: gap −22% w weekend + cienka księga** | **$3 982 378** | **$0** | 0% |
| Zapaść płynności −70% | $297 220 | $0 | 0% |
| Gap spółki −18% (earnings) | $0 | $0 | 20% |

Czytanie: w spokojnym rynku ECV pożycza tyle samo co model ze stałym LTV
(różnica 0,4%). Cena za bezpieczeństwo pojawia się dopiero w stresie — i wtedy
jest to odmowa kredytu, nie strata puli.

## Uczciwe ograniczenia (mówimy je pierwsi)

1. **Dane są syntetyczne.** `src/data/prices.mjs` generuje serię z weekendowymi
   lukami. Przed pitchem podmień na realną historię w `data/prices.SPYx.json`
   (format: `[{t: ms, p: number}]`).
2. **Kalibrator kasuje nasz ulubiony parametr.** Na tej serii dopasowanie ustawia
   `session.weekend = 1.0` i `volSlope = 0` — czyli dane nie uzasadniają haircutu
   za weekend; ochronę daje głębokość, slippage i breaker. Nie ukrywamy tego:
   dashboard pokazuje priors, a wynik kalibracji jest widoczny w panelu agentów.
3. **Scenariusze stresu działają przez całe okno**, więc „kredyt vs fixed" w tych
   wierszach to górne ograniczenie kosztu, nie realna średnia.
4. **Mint adresy xStocks w `src/data/jupiter.mjs` trzeba zweryfikować** przed
   demo na żywo. Offline fallback działa zawsze.

## Następny krok po hackathonie

Program Anchor konsumujący pięć wyjść (`max_borrow`, `collateral_cap`,
`liquidation_route`, `risk_premium`, `borrow_disabled`). Kształt tej struktury
jest zamrożony — patrz `tasks/`.
