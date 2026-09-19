# AGENT A — model ECV
Pliki: `src/ecv/*`. Czas: 2h.

1. Dodaj człon `C(q)` — koncentracja portfela: pozycja złożona w 80% z jednego
   tickera ma być karana względem zdywersyfikowanej. Granice w `PARAM_BOUNDS`.
2. Dodaj `explain(input, params)` zwracające tablicę `{term, value, why}` — UI ma
   pokazywać uzasadnienie każdego członu, nie tylko liczbę.
3. Testy: monotoniczność każdego członu (większy impact => mniejsze ECV) oraz
   niezmiennik `max_borrow <= executableValue` we wszystkich stanach sesji.

GOTOWE, gdy: `node --test src/ecv/*.test.mjs` zielone i backtest dalej działa.
