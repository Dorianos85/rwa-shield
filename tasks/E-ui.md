# AGENT E — demo
Pliki: `src/api/*`, `web/*`. Czas: 3h. To jest to, co zobaczy sędzia.

1. Dodaj wykres krzywej głębokości: impact w funkcji wielkości pozycji, z
   zaznaczonym progiem, na którym odcinamy kredyt (dane z `depthProbe`).
2. Przełącznik „priors / fitted" wywołujący API z `?params=fitted` — pokazujemy,
   że parametry są dopasowywane, a nie wybrane ręcznie.
3. Tryb prezentacji: pełny ekran, trzy kroki (wycena → stress → backtest),
   sterowanie strzałkami. 60 sekund bez klikania po formularzach.
4. Stan w URL (`?notional=...&session=...`), żeby dało się wrócić do dokładnie
   tego samego widoku na scenie.

GOTOWE, gdy: całe demo przechodzi z klawiatury i nie wymaga tłumaczenia.
