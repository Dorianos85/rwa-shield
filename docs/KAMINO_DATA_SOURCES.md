# Źródła danych i jednostki

Snapshot `data/kamino.snapshot.json` pochodzi z rzeczywistych odpowiedzi publicznego API Kamino, zapisanych 2026-09-27T11:50:33Z. Zawiera surowe dane kont rezerw i ceny z oryginalnym czasem publikacji. Snapshot ani cache awaryjny nie mają `live=true`.

## Oficjalne źródła

- [Indeks API Kamino](https://api.kamino.finance/llms.txt)
- [Schemat OpenAPI](https://api.kamino.finance/openapi/json?openapi=3.0.0)
- [Lista rynków](https://api.kamino.finance/v2/kamino-market)
- [Metryki rezerw rynku xStocks](https://api.kamino.finance/kamino-market/5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua/reserves/metrics)
- [Surowe konta rezerw](https://api.kamino.finance/kamino-market/reserves/account-data?markets=5wJeMrUYECGq41fxRESKALVcHnNX26TAWy4W98yULsua)
- [Ceny oracle wszystkich rynków](https://api.kamino.finance/oracles/prices?markets=all)
- [Oficjalny SDK — Reserve, przypięty commit](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/accounts/Reserve.ts)
- [Oficjalny SDK — ReserveConfig](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/types/ReserveConfig.ts)
- [Oficjalny SDK — ReserveLiquidity](https://github.com/Kamino-Finance/klend-sdk/blob/38845294447623f6de3afc9dec29875f959f6f48/src/%40codegen/klend/types/ReserveLiquidity.ts)
- [Oficjalna dokumentacja Jupiter: quote i jednostki](https://developers.jup.ag/docs/guides/how-to-build-a-custom-swap-with-metis)

## Zakres i ograniczenia

Lista rynków jest odkrywana przez API, a lista obsługiwanych aktywów jest przecięciem SPYx, QQQx, NVDAx, TSLAx, CRCLx z rezerwami danego rynku. Zapisane rynki: xStocks Market oraz Sentora xStocks Market. Drugi obsługuje trzy pierwsze aktywa. Nie zakładamy obecności TSLAx ani CRCLx w Sentora.

`totalSupplyUsd` jest bazą scenariusza, a `totalBorrowUsd / totalSupplyUsd` określa wykorzystanie konkretnej rezerwy. Nie zastępujemy niskiego wykorzystania rezerw akcyjnych wysokim wykorzystaniem USDC. `currentAvailableUsd = supply - borrow` to model księgowy; saldo rzeczywistego vault może różnić się przez opłaty.

`maxLtv` API jest ułamkiem dziesiętnym. LTV i próg likwidacji konta są procentami całkowitymi dzielonymi przez 100. Punkty krzywej stóp są basis points dzielonymi przez 10 000. Limity supply/borrow są surowymi jednostkami tokena dzielonymi przez `10 ** mintDecimals`, a USD przeliczane jest ceną oracle. Limit borrow dotyczy pożyczania tego tokena; nie jest limitem pożyczek USDC zabezpieczonych tym tokenem. Szczególne limity grup elevation nie są modelowane.

Dekoder odrzuca inną długość konta, discriminator, mint, adres rynku lub LTV. Przy nieobsługiwanym układzie nie zgaduje parametrów: zwraca null i powód. Pierwsze załamanie rzeczywistej krzywej jest raportowane jako `firstCurveKink`; `optimalUtilization` pozostaje niedostępne, bo protokół nie udostępnia jednego tak nazwanego pola.

Nie potwierdzono niezależnego publicznego endpointu issuer NAV. `navPrice` jest jawnie oznaczonym proxy ceny oracle Kamino. Nie można z niego wnioskować niezależnej różnicy NAV/oracle. Wiek ceny korzysta z publikacji oracle, nigdy z czasu pobrania. Snapshot ma wiek przy zapisie około 103 s, przekraczający obecny limit RWA 30 s. Zmienność korzysta z jawnego modelowego parametru `volRefAnnual`, nie z rzekomego pomiaru.

Jupiter wymaga `JUP_API_KEY` lub świadomie skonfigurowanego `JUP_QUOTE_URL`. Kwoty wejściowe są surowymi jednostkami zweryfikowanego mintu; wyjście USDC ma 6 miejsc. `priceImpactPct` Jupiter jest ułamkiem dziesiętnym; adapter przelicza go na punkty procentowe. Stosowana strata jest konserwatywnym maksimum wpływu na cenę DEX oraz straty wypływów względem notionalu referencyjnego. Oryginalny wpływ i strata względem reference są zachowane osobno.

`routableUsd` live to największy przetestowany notional mieszczący się w limicie wpływu; nie jest sumą TVL wszystkich DEX. Gdy największy test przechodzi, `censored=true` sygnalizuje, że znaleziono tylko dolne ograniczenie pojemności. Quote nie gwarantuje transakcji; USD dla USDC zakłada $1.

Awaryjne execution używa istniejącej deterministycznej krzywej syntetycznej i jawnego `riskLab.syntheticDepthUsd`. Jest modelem, nie snapshotem pomiaru DEX. Timeout Kamino wynosi 5 s na żądanie; Jupiter 2,5 s na punkt skończonej drabiny. Cache trwa 60 s, zachowując źródłowy timestamp, a po awarii ma `live=false`, `cached=true`, `fallback=true`.
