# AGENT C — wiarygodność backtestu
Pliki: `src/backtest/*`. Czas: 2h.

1. Dodaj walk-forward: kalibracja na pierwszych 60% serii, ocena na pozostałych
   40%. Bez tego każdy wynik to dopasowanie in-sample i sędzia to wytknie.
2. Raportuj rozkład, nie tylko sumę: mediana i 95. percentyl straty na pozycję.
3. Dodaj scenariusz „stablecoin depeg" (USDC -3%) — wpływa na stronę długu.
4. Eksport `data/backtest.json` do zasilenia UI bez przeliczania.

GOTOWE, gdy: raport pokazuje wynik out-of-sample osobno od in-sample.
