# Website V2 — kontrola jakości

Wykonano 28.09.2026 w Chrome headless, z lokalnego serwera plików statycznych. Narzędzia QA pochodzą ze środowiska Codex i nie są zależnościami strony.

## Wyniki

- 7/7 istniejących testów `src/ecv/*.test.mjs` przechodzi.
- `node src/backtest/run.mjs` kończy się tabelą wszystkich sześciu scenariuszy, bez wyjątku.
- `node src/api/server.mjs`: `/api/ecv` zwraca HTTP 200 (oddzielny port QA 18878).
- Generator przykładów używa bezpośrednio kanonicznego modelu i parametrów, bez kopii algorytmu w przeglądarce.
- Sprawdzono przełączanie trzech scenariuszy. Stary oracle blokuje nowe pożyczki i zachowuje $99,000 executable value. Cienka płynność blokuje pożyczkę, ale zachowuje dodatni mark.
- Menu mobilne działa, Escape je zamyka i oddaje fokus, wybranie odnośnika również je zamyka. Przycisk Menu jest ukryty na desktopie.
- Pierwszy fokus klawiatury trafia do Skip to content. Kontrolki mają widoczny fokus i etykiety.
- Wszystkie lokalne zasoby i odnośniki HTTP 200, wszystkie kotwice istnieją, identyfikatory nie powtarzają się.
- Brak błędów JavaScript i błędnych odpowiedzi lokalnych w przeglądarce.
- Brak poziomego przepełnienia przy szerokościach: 320, 390, 540, 768, 820, 821, 1024, 1440, 1920 px.
- Wizualnie oceniono hero oraz wszystkie sekcje na desktopie; evidence, liquidity, demo, devnet i team również na mobile 390 px.
- Zdjęcia lazy-loaded poprawnie dekodują się po przewinięciu.
- `prefers-reduced-motion` wyłącza smooth scroll i przejścia.
- Bez JavaScript pozostają dostępne treść, nawigacja i domyślny przykład demo.
- Po załadowaniu strony demo działa bez sieci.
- Przekierowanie root → `docs/` działa. Relatywne zasoby i demo działają pod ścieżką katalogu, zgodnie z GitHub Pages.
- Odczyt publicznych kont Solana devnet potwierdził executable program i własność kont; szczegóły w `devnet-proof.json`.

## Poprawki po QA

- Ukrycie mobilnego przycisku Menu na desktopie.
- Poprawa ukrywania linku Skip to content poza fokusem.
- Wyraźne rozdzielenie pełnych limitów depozytów od mianownika wykresu asset-level.
- Wyraźna informacja o starej, syntetycznej trasie w rekordzie devnet.
- Usunięcie starego linku „Live dashboard”, który nie działa bez serwera API na Pages.

## Granice weryfikacji

Nie przeprowadzono testów na fizycznych telefonach ani osobno w Safari/Firefox. Strona nie została scalona ani wdrożona na produkcyjne GitHub Pages. Pełne ograniczenia danych, brak kalibracji pitchu i brak surowych snapshotów opisano w `WEBSITE_V2_SOURCES.md`.
