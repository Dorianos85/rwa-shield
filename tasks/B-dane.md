# AGENT B — dane realne
Pliki: `src/data/*`, `data/*.json`. Czas: 3h. NAJWYŻSZY PRIORYTET przed pitchem.

1. Zweryfikuj mint adresy xStocks w `src/data/jupiter.mjs` (SPYx, QQQx, NVDAx).
   Źródło: xstocks.fi / eksplorator. Zły mint = demo na żywo nie zadziała.
2. Ściągnij realną historię godzinową dla SPYx (min. 60 dni) do
   `data/prices.SPYx.json` w formacie `[{"t": 1750000000000, "p": 612.4}]`.
   Dowolne źródło z publicznym API; zapisz w komentarzu, skąd pochodzi.
3. Podłącz realny feed ceny (Pyth lub Jupiter price API) z polem wieku ceny,
   żeby `priceAgeSec` przestał być stałą.
4. `depthProbe` ma cache 60s — bez tego monitor zabije limity API.

GOTOWE, gdy: `node src/backtest/run.mjs SPYx` liczy na realnej serii i wypisuje
„series: real SPYx".
