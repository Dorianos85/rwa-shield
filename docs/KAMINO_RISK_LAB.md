# Kamino × xStocks Risk Lab

Panel porównuje parametry zabezpieczenia xStock i wykorzystanie rezerwy USDC
w tym samym rynku Kamino z odzyskiem egzekucyjnym testowanego zabezpieczenia.
Nie jest oceną całego rynku ani rekomendacją inwestycyjną.

## Uruchomienie

```powershell
node src/api/server.mjs
```

Otwórz `http://localhost:8787/risk`. Dotychczasowe demo i tryb prezentacji są pod `/`.
Bez instalowania pakietów, bundlera i zewnętrznych fontów. Wymagany Node 20+.

Tryb bez dostępu do sieci:

```powershell
$env:RISK_OFFLINE='1'
node src/api/server.mjs
```

Offline oznacza zapisany pomiar Kamino i jawny model krzywej egzekucji.
Nie oznacza aktualnych danych. Tryb wyceny i tryb pozyskania danych są osobne.

`Current freshness` zamyka bramkę nowego kredytu przy starych lub niezweryfikowanych
danych. `Replay at capture` wymaga rzeczywistego wieku ceny/kwotowania/rezerwy w
chwili pomiaru. `Stress sandbox` jest osobnym, jawnym eksperymentem: zakłada świeżą
cenę i pozwala badać model wykonania, zachowując faktyczny wiek i provenance.
Jego SAFE/WARNING/CRITICAL mają prefiks **MODELED** i nie są bieżącym sygnałem
kredytowym. Nie należy utożsamiać offline z automatycznym sandboxem.

## Interaktywna mapa ryzyka

Mapa NAV × płynność AMM pokazuje SAFE/WARNING/CRITICAL dla 864 scenariuszy
obliczonych tym samym silnikiem co panel i API. Utilization, początkowy Average HF
i testowany notional pozostają stałe. Biały znacznik wskazuje wybrany scenariusz.
Najechanie lub dotyk pokazuje ECV, odzysk, stressed HF i przyczynę statusu.
Kliknięcie albo przycisk Apply ustawia oba suwaki; strzałki eksplorują mapę,
Enter stosuje punkt, Escape przywraca podgląd wybranego scenariusza.

To próbkowana mapa modelu, nie historia cen ani dokładna linia graniczna.
Dokładniejsze granice dla jednej zmiennej pozostają w sekcji poniżej. Current
zachowuje blokady świeżości; sandbox ma jawne oznaczenie MODELED. SVG działa
offline, bez nowych bibliotek, także na małym ekranie.

## Architektura i kontrakty

- `src/data/kamino.mjs`: oficjalne metryki, konfiguracja rezerw, cache i zapisany pomiar.
- `src/data/xstocks.mjs`: zweryfikowany mint i jawny proxy ceny referencyjnej.
- `src/data/liquidity.mjs`: sondowanie Jupitera i oznaczony model offline.
- `src/risk/kaminoRisk.mjs`: czyste obliczenia i numeryczne granice scenariusza.
- `src/api/riskRoutes.mjs`: nowe endpointy, walidacja zapytań i integracja źródeł.
- `web/risk.*`: panel vanilla JS. Importuje ten sam moduł ryzyka co API.

Nie zmieniono sygnatur ani implementacji `src/ecv/model.mjs`, pięciu zamrożonych
wyjść ani istniejącego `breaker_reason`. Nie zmieniono on-chain, backtestu ani
wyników starego demo. `riskLab` w `params.mjs` określa zakresy kontrolek;
oddzielne `RISK_LAB_BOUNDS` nie są celami kalibracji backtestu.

## Trzy niezależne poziomy

1. **Finansowanie USDC:** TVL oznacza dostarczoną wartość USD rezerwy USDC
   w wybranym rynku, zweryfikowanej przez symbol i canonical mint. Przez cały
   scenariusz pozostaje stałe. Borrowed = TVL × utilization; available = TVL ×
   (1 − utilization). To uproszczona księgowość scenariusza, nie odczyt salda vault.
   USDC borrow/supply cap oraz krzywa oprocentowania pochodzą z tej rezerwy.
   Kwoty pokazujemy w USD po cenie oracle, nie jako surową liczbę tokenów USDC.
   LTV, próg likwidacji i oracle zabezpieczenia nadal pochodzą z wybranego xStocka.
   Brak rezerwy USDC oznacza niedostępne utilization i zamkniętą bramkę kredytu,
   także w sandboxie; dashboard nigdy nie podmienia jej na rezerwę zabezpieczenia.
2. **Testowane zabezpieczenie:** domyślnie 100 000 USD według bazowej ceny
   referencyjnej. Liczba tokenów jest stała po przesunięciu NAV. AMM depth opisuje
   możliwości sprzedaży tych tokenów, a nie płynność rezerwy Kamino.
3. **Average Health Factor:** niezależny abstrakcyjny parametr książki pożyczek.
   HF po stresie = początkowy HF × (executable po stresie / executable bazowe).
   HF nie ustala zadłużenia rezerwy. To nie jest pomiar kont użytkowników Kamino.

Zmiana utilization nie zmienia D, S, M ani V. NAV nie zmienia długu rezerwy.
Ryzyko sesji i zmienności wpływa na underwriting ECV, lecz nie drugi raz na HF.

## Wycena i porównanie

RWA safe LTV = max_borrow / wartość referencyjna po stresie. Kamino capacity =
ta wartość × skonfigurowane LTV. Safety gap = RWA capacity − Kamino capacity.
Recovery jest liczone istniejącą `recoveryOnLiquidation()`, po bonusie
likwidatora. Mianownik recovery to testowany bazowy notional: nie wymyślamy
pozycyjnego długu ani wskaźnika pokrycia rzeczywistego zadłużenia.

Przesunięcie AMM liquidity skaluje poziomą oś krzywej wpływu ceny. Monotoniczna
obwiednia eliminuje pozorne poprawy wynikające z szumu kwotowań. Ekstrapolacja
jest założeniem stresowym, nie ofertą transakcyjną. Adapter nie wysyła transakcji.
Warstwa porównawcza konserwatywnie uwzględnia faktyczny wpływ ceny powyżej
zakresu starego silnika; zamrożony silnik pozostaje bez zmian.

## Reguły statusu i granice

CRITICAL: m.in. breaker nowego kredytu, HF po stresie poniżej 1, brak wystarczającej
głębokości dla testowanego zabezpieczenia, wyczerpanie płynności lub limitu
pożyczania wybranego tokena. Osiągnięcie limitu oznacza ograniczenie pożyczania,
nie dowód niewypłacalności Kamino.

WARNING: m.in. HF pomiędzy 1 a `targetHealth`, safe LTV poniżej LTV Kamino,
przekroczenie udokumentowanego punktu krzywej oprocentowania lub tolerancji impact.
SAFE oznacza, że przekazane założenia modelu przechodzą wszystkie dostępne reguły.
Nie jest weryfikacją bezpieczeństwa rynku.

Polityka RWA dla tego panelu: cena nie starsza niż istniejące `maxStalenessSec`
(30 s), zmierzone kwotowanie nie starsze niż `riskLab.maxExecutionAgeSec` (60 s),
obserwacja rezerwy nie starsza niż `riskLab.maxReserveAgeSec` (60 s). Nie są to
progi Kamino. Czas pobierania danych wlicza się do wieku; przeglądarka dalej
zwiększa wiek wszystkich trzech źródeł bez odpytywania sieci przy ruchu suwaka.

Granice pochodzą z numerycznego przeszukiwania tej samej funkcji ryzyka, przy
pozostałych suwakach nieruchomych. Wynik zawiera próg, powód, zakres przeszukiwania,
informację o już przekroczonej granicy lub braku przecięcia. Zmiana jednej osi
nie musi przywrócić bezpieczeństwa, gdy inna oś już narusza ograniczenie.

## Źródła i ograniczenia

Oficjalne źródła Kamino:

- [Lista rynków](https://api.kamino.finance/v2/kamino-market).
- [Metryki rezerw xStocks](https://api.kamino.finance/kamino-market/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua/reserves/metrics).
- [SDK Kamino Lending](https://github.com/Kamino-Finance/klend-sdk).

Metryki USD, adresy, minty, konfiguracja i znaczniki czasu mają zachowane
pochodzenie. Konfiguracja konta jest dekodowana zgodnie z przypiętym układem
oficjalnego SDK, z kontrolą długości, discriminatora, mintu, rynku i LTV.
Niezgodność formatu powoduje wartości niedostępne, a nie zgadywanie parametrów.

Borrow/supply cap z tokenów jest przeliczany przez bazową cenę oracla. Limit
pożyczania xStock nie jest limitem USDC pożyczonego pod ten xStock. Nie modelujemy
elevation groups ani kompletnej reguły każdej wieloassetowej pozycji.
Kamino ma wielopunktową krzywą stóp; brak pojedynczego `optimalUtilization`
pozostaje jawny. Pierwszy punkt załamania krzywej jest odrębnym wyprowadzeniem.

Nie zweryfikowano publicznego, niezależnego źródła issuer NAV. Obecna cena
referencyjna jest **Kamino oracle proxy**, oznaczonym jako taki. Cena oracla,
proxy i NAV scenariusza mają osobne pola. Nie można na ich podstawie wnioskować
o niezależnym odchyleniu issuer NAV od oracla. Zmienność jest istniejącym priorem
modelu, nie nowym pomiarem historycznym.

Publiczny Jupiter może odmówić dostępu lub wymagać klucza. Wtedy krzywa syntetyczna
jest jawnie oznaczona i nie może udawać LIVE. Wiek obserwacji i wiek publikacji
ceny nie są utożsamiane. Zapisany pomiar zachowuje oryginalne znaczniki czasu.

## Decyzja dotycząca PR #1

[PR #1](https://github.com/Dorianos85/rwa-shield/pull/1), commit
`b46d43c03d39b472f20db57b2a1f9ee83d764ee1`, został przeanalizowany; nie został
scalony. Korzystamy z idei korekty mintów, cache i jawnego provenance, weryfikując
minty ponownie przez członkostwo rezerw Kamino. Nie kopiujemy odczytu oracla bez
timeoutu, sztucznego wieku fallbacku 5 sekund ani niepodpisanej świeżości ceny.

Historia SPY w PR #1 jest proxy Yahoo, nie ceną SPYx: 1089 punktów, z 193 odstępami
innymi niż godzina. Nie włączamy jej do istniejącego backtestu 24/7 jako godzinowej
historii tokena. Stary backtest zachowuje jawne ograniczenia z `GROK_HANDOFF.md`:
syntetyczna seria, nieużyte maturity/lag, brak predykcyjnej walidacji.

## API

```text
GET /api/kamino/markets
GET /api/kamino/reserve?market=…&symbol=SPYx
GET /api/xstocks/asset?market=…&symbol=SPYx
GET /api/liquidity?market=…&symbol=SPYx&notional=100000
GET /api/risk/baseline?market=…&symbol=SPYx
GET /api/risk/compare?symbol=SPYx&utilization=0.92&averageHealthFactor=1.8
```

Opcje `offline=1`, `refresh=1`. Porównanie przyjmuje `navPrice`, `ammLiquidityUsd`,
`notional`, `mode=current|snapshot-replay|sandbox`. Niepoprawne dane wejściowe zwracają
HTTP 400; metoda inna niż GET zwraca 405. Istniejące `/api/state`, `/api/ecv`,
`/api/backtest`, `/api/agents` zachowują kontrakty.

## Weryfikacja

```powershell
node --test src/**/*.test.mjs
node src/backtest/run.mjs
```

Raport końcowych testów, ataków na model i kontroli przeglądarki:
`docs/KAMINO_QA.md`.
