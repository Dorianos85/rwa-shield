# Raport wykonania i weryfikacji — 2026-09-27

Gałąź: `feat/rwa-shield-kamino-risk-dashboard`, baza `origin/main` (`ade9dac`).
Repo sklonowano oddzielnie od wcześniejszego lokalnego, niecommitowanego panelu.

## Wynik

- `node --test src/**/*.test.mjs`: **59/59 PASS**, bez pominiętych testów.
- `node src/backtest/run.mjs`: **PASS**, sześć scenariuszy, 2640 godzin syntetycznych.
- `git diff --check`: **PASS**.
- Quant Validator: **MERGE BLOCKER: NO**.
- Adversarial DeFi Reviewer: **MERGE BLOCKER: NO**.
- Integration/Failure QA: **MERGE BLOCKER: NO**.
- Architecture reviewer: **MERGE BLOCKER: NO**.
- Kontrola przeglądarki: **PASS**, opis poniżej.

## Pętla build → review → fix → retest

Niezależny reviewer ujawnił dwa blockery i problem czasu pozyskania danych.
Wszystkie naprawiono i sprawdzono ponownie:

1. Stara krzywa egzekucji mogła otworzyć nowy kredyt przy świeżej cenie.
   Bieżąca wycena teraz zamyka bramkę dla starych/nieweryfikowalnych danych
   execution i rezerwy. Sandbox pozostaje jawnie hipotetyczny.
2. Stała siatka NAV pomijała wąski zdrowy przedział 101–101,01.
   Dodano analityczne punkty krzywej i pokrycia egzekucyjnego; regresja zwraca
   właściwą dolną granicę **101**.
3. Wiek ceny nie uwzględniał czekania na Jupiter. Test z 24 s pobierania i ceną
   początkowo mającą 29 s potwierdził końcowy wiek **53 s** i `stale_price`.

Dodatkowe naprawy integracyjne:

- wynik sprzedaży Jupiter w USDC ogranicza odzysk nawet przy małym venue impact;
- HTTP 400 `COULD_NOT_FIND_ANY_ROUTE` oznacza zmierzoną zerową lub częściową
  głębokość, nigdy zastąpienie braku trasy modelem 400k USD;
- mały notional w głębokim rynku nie wyzwala błędnie market depth floor;
- liczby przy breakerze odpowiadają jednostce konkretnego powodu;
- reset suwaków zachowuje dokładne bazowe utilization;
- przeglądarka starzeje cenę, kwotowania i rezerwę, bez żądań przy ruchu suwaka.

Niezależne dodatkowe sondy: **600 skrajnych kombinacji** i **2000 losowych
kontroli niezmienników**, bez naruszeń po poprawkach. Nie zastępują testów
produkcyjnego protokołu ani historycznej walidacji modelu.

## Źródła rzeczywiste i fallback

Oficjalny Kamino API potwierdzony z działającego lokalnego serwera:
SPYx w xStocks Market: supplied **4 266 211,91 USD**, utilization **2,31358149%**,
LTV **73%**, liquidation threshold **75%**. Metadane rezerwy miały `live=true`.
Wiek ceny w odrębnym pomiarze wynosił **55,488 s** i nie był odmładzany.

Zapis `data/kamino.snapshot.json`: **2026-09-27T11:50:33.3399858Z**.

Zweryfikowana dostępność w zapisanym pomiarze:

| Rynek | Assety w panelu |
|---|---|
| xStocks Market (`5wJe…Lsua`) | SPYx, QQQx, NVDAx, TSLAx, CRCLx |
| Sentora xStocks Market (`8BNU…6vjr`) | SPYx, QQQx, NVDAx |

Lista jest odświeżana z oficjalnego discovery i członkostwa rezerw, w zakresie
pięciu celowo wspieranych symboli. TSLAx/CRCLx nie są dopisywane do Sentora.

Nie skonfigurowano `JUP_API_KEY`; rzeczywisty Jupiter nie został przedstawiony
jako działający LIVE. Demo korzysta z jawnej syntetycznej krzywej. Ścieżka API
Jupiter jest sprawdzona mockami, w tym raw amounts, jednostkami impact, brakiem
trasy, timeoutem, cache i dyskontem reference→DEX.

Independent issuer NAV jest niedostępny. Panel używa jawnie nazwanego proxy
oracla Kamino. Aktualizacja tego proxy nie oznacza niezależnej walidacji NAV.

## Powtarzalne przykłady w sandboxie

Otwórz `/risk?offline=1&symbol=TSLAx&mode=sandbox` z domyślnymi priors.
Przykłady poniżej używają weekendowego M=0,85; wyniki innej sesji będą inne.
TVL rezerwy **2 831 988,09 USD**, reference **372,08 USD**, notional **100 000 USD**,
syntetyczna płynność execution **400 000 USD**.

| Przykład | Zmiana | Wynik |
|---|---|---|
| SAFE | HF=1,50, pozostałe bazowe | executable 98 800 USD, ECV 83 980 USD, max borrow 58 420,87 USD, safe LTV 58,42%, recovery 93 860 USD |
| WARNING | tylko HF=1,05 | stressed HF=1,05 poniżej target 1,15; TVL, dług i reserve liquidity bez zmian |
| CRITICAL | tylko AMM depth −80%, do 80k USD | impact 13,42%, executable około 69 267 USD, zamknięty borrow gate |
| NAV stress | tylko NAV −20% | HF około 1,20, niższe ECV; oracle i reserve debt bez zmian |
| Reserve pressure | utilization=99,9% | borrowed 2 829 156 USD, available 2 832 USD, naruszony token borrow cap; HF nadal 1,50 |

Dla pierwszego przykładu dynamiczne granice:

| Oś | Pierwsze ostrzeżenie lub gorzej | Pierwsze CRITICAL |
|---|---:|---:|
| Utilization | 32,846% (limit pożyczania tokena) | 32,846% |
| NAV/reference poniżej | 284,21 USD | 246,75 USD |
| AMM liquidity poniżej | 258 011,86 USD | 155 402,54 USD |
| Początkowy Average HF poniżej | 1,15 | 1,00 |

Jednakowy próg warning/critical oznacza bezpośrednie przejście do CRITICAL,
a nie wymyślone ostrzeżenie przed limitem. Limit pożyczania TSLAx nie jest
limitem USDC pożyczanego pod TSLAx. Domyślna bieżąca wycena ze starymi lub
syntetycznymi danymi zamyka bramkę niezależnie od powyższych ilustracji.

## Przeglądarka

Rzeczywisty Chromium w Codex, viewporty **1440×1000, 807×612, 390×844 i 320×780**.
Desktop i mobile sprawdzone wizualnie; brak poziomego overflow dokumentu.
Wąska tabela porównania przewija się w swoim kontenerze. Zwiększono rozmiary
metadanych i wyłączono sticky panel kontrolek na niskich ekranach.

Sprawdzone: dokładnie cztery range inputs, selektory obu rynków i właściwe
membership assetów, SPYx/TSLAx, reset, presety NAV/depth, rozmiar 1M, utilization
99,9%, HF 1,05 i 0,50, zmiana granic, rozdzielenie oracle od NAV scenariusza,
niezależność HF od reserve cash, provenance, komunikat sandboxu. Konsola
sprawdzonej sesji: **0 errors / 0 warnings**.

Lokalny screenshot dowodowy: `.qa/risk-desktop.png` (celowo poza Gitem).

## Definition of Done — dowody funkcjonalne

- [x] Oddzielna gałąź od aktualnego origin/main; feat/g-onchain nietknięta.
- [x] Pełne AGENTS/README/runbook/handoff przeczytane; zero nowych zależności.
- [x] Architektura i PR #1 zbadane; decyzja selektywnego reuse opisana.
- [x] Adapter Kamino, zweryfikowane reserve ID/mint/config i stałe TVL.
- [x] Utilization: current/scenario/delta; borrowed=TVL×U; available=TVL×(1−U).
- [x] TVL nie zmienia się od żadnego suwaka.
- [x] Reference/NAV best-available załadowane; brak independent NAV oznaczony.
- [x] Suwak NAV; oddzielne oracle/current reference/scenario reference.
- [x] Jupiter adapter i jawny fallback; osobna AMM execution liquidity.
- [x] Suwak AMM wpływa na krzywą, impact, executable, ECV i recovery.
- [x] Average HF jako niezależny suwak; stressed HF i target/boundary.
- [x] Testowany notional jako liczba/presety, bez piątego suwaka.
- [x] ECV, max_borrow, collateral_cap, risk_premium, borrow_disabled i route.
- [x] Safe LTV, Kamino LTV, safety gap USD/pp, recovery i jawny mianownik.
- [x] Borrow gate i oddzielna reserve pressure: caps/headroom/rate curve.
- [x] SAFE/WARNING/CRITICAL i liczbowa dominująca przyczyna.
- [x] Dynamiczne warning/critical boundaries każdej osi; brak przecięcia opisany.
- [x] Live/cached/fallback/timestamp/age widoczne; offline działa.
- [x] Istniejące ECV tests i backtest; nowe risk/adapter/API tests.
- [x] Rzeczywisty serwer, manualne API i rzeczywista przeglądarka.
- [x] Adversarial review, naprawy, ponowne testy i final grill bez blockerów.

## Uzupełnienie — mapa ryzyka NAV × AMM

- 61/61 testów PASS, w tym porównanie 864 komórek z silnikiem i kontrola,
  że stara cena w trybie current nie daje zielonych pól przy korzystnym NAV.
- Backtest: wszystkie sześć scenariuszy, bez wyjątków; integracyjny `/api/ecv` 200.
- Przegląd niezależnego agenta: brak blockerów modelu/integracji. Poprawiono
  zachowanie podglądu klawiatury/dotyku przy odświeżaniu co 5 s.
- Przeglądarka: 1440 × 1000 oraz 390 × 844, bez poziomego overflow strony/mapy.
  Strzałki, Enter, Apply i reset sprawdzone; aktualizacja obu suwaków działa.
- Current na nieaktualnym snapshot: cała mapa CRITICAL; sandbox: trzy strefy.
- Pierwsze rysowanie 864 pól: około 24 ms w lokalnej sesji, bez błędów konsoli.
- Zrzut lokalny `.qa/risk-chart.png` (poza Gitem).

Push i PR wykonuje orkiestrator po tej weryfikacji; dowód stanowi link PR i
historia commitów. Nie ma automatycznego merge ani publicznego deploymentu.
