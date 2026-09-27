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

`totalSupplyUsd` jest bazą scenariusza, a `totalBorrowUsd / totalSupplyUsd` określa wykorzystanie rezerwy USDC tego samego rynku. Osobna rezerwa xStock dostarcza LTV, próg likwidacji i oracle zabezpieczenia. Brak USDC nie powoduje podstawienia innego tokena. `currentAvailableUsd = supply - borrow` to model księgowy; saldo rzeczywistego vault może różnić się przez opłaty.

`maxLtv` API jest ułamkiem dziesiętnym. LTV i próg likwidacji konta są procentami całkowitymi dzielonymi przez 100. Punkty krzywej stóp są basis points dzielonymi przez 10 000. Limity supply/borrow są surowymi jednostkami tokena dzielonymi przez `10 ** mintDecimals`, a USD przeliczane jest ceną oracle. Limit borrow dotyczy pożyczania tego tokena; nie jest limitem pożyczek USDC zabezpieczonych tym tokenem. Szczególne limity grup elevation nie są modelowane.

Dekoder odrzuca inną długość konta, discriminator, mint, adres rynku lub LTV. Przy nieobsługiwanym układzie nie zgaduje parametrów: zwraca null i powód. Pierwsze załamanie rzeczywistej krzywej jest raportowane jako `firstCurveKink`; `optimalUtilization` pozostaje niedostępne, bo protokół nie udostępnia jednego tak nazwanego pola.

Nie potwierdzono niezależnego publicznego endpointu issuer NAV. `navPrice` jest jawnie oznaczonym proxy ceny oracle Kamino. Nie można z niego wnioskować niezależnej różnicy NAV/oracle. Wiek ceny korzysta z publikacji oracle, nigdy z czasu pobrania. Snapshot ma wiek przy zapisie około 103 s, przekraczający obecny limit RWA 30 s. Zmienność korzysta z jawnego modelowego parametru `volRefAnnual`, nie z rzekomego pomiaru.

Domyślnym źródłem AMM są kwotowania `https://api.jup.ag/swap/v1/quote` dla sprzedaży wybranego xStocka do USDC. [Oficjalny dostęp bez klucza](https://developers.jup.ag/docs/portal/setup) pozwala na 0,5 żądania/s; opcjonalny `JUP_API_KEY` podnosi limit (darmowy plan: 1/s). Adapter przestrzega tych odstępów. `JUP_QUOTE_URL` pozostaje jawną konfiguracją własnego endpointu. Kwoty wejściowe są surowymi jednostkami zweryfikowanego mintu; wyjście USDC ma 6 miejsc. `priceImpactPct` Jupiter jest ułamkiem dziesiętnym; adapter przelicza go na punkty procentowe. Stosowana strata jest konserwatywnym maksimum wpływu na cenę DEX oraz straty wypływów względem notionalu referencyjnego. Oryginalny wpływ i strata względem reference są zachowane osobno.

`routableUsd` live to największy przetestowany notional mieszczący się w limicie wpływu; nie jest sumą TVL wszystkich DEX. Gdy największy test przechodzi, `censored=true` sygnalizuje, że znaleziono tylko dolne ograniczenie pojemności. Quote nie gwarantuje transakcji; USD dla USDC zakłada $1.

Po awarii lub w trybie offline execution zachowuje ostatni rzeczywisty pomiar z jego timestampem, a jeśli pomiaru nie ma, zwraca `available=false`, pustą krzywą i jawne „Unavailable”. Nigdy automatycznie nie podstawia $400k. Dawna krzywa wymaga wybrania `Synthetic sandbox` (`execution=synthetic`) i pozostaje jawnie modelowa. Timeout Kamino wynosi 5 s na żądanie; Jupiter 2,5 s na punkt skończonej drabiny. Cache trwa 60 s i zachowuje czas najstarszego kwotowania; po awarii ma `live=false`, `cached=true`, `fallback=true`. Równoczesne identyczne pomiary współdzielą jedno zapytanie do drabiny.

Źródła są niezależne: `offline=1&execution=jupiter` pobiera Kamino ze snapshotu i AMM z Jupitera. `execution=offline` nie pobiera kwotowań. `RISK_OFFLINE=1` wymusza brak sieci dla całego panelu. Wartość początkowa i Reset suwaka AMM korzystają z wybranego pomiaru; przesunięcie suwaka pozostaje lokalnym scenariuszem, nie nowym kwotowaniem.
