# Website V2 — kontrola jakości

Wykonano 28.09.2026 w Chrome headless, z lokalnego serwera plików statycznych. Narzędzia QA pochodzą ze środowiska Codex i nie są zależnościami strony.

## Wyniki

- 7/7 istniejących testów `src/ecv/*.test.mjs` przechodzi.
- `node src/backtest/run.mjs` kończy się tabelą wszystkich sześciu scenariuszy, bez wyjątku.
- `node src/api/server.mjs`: `/api/ecv` zwraca HTTP 200 (oddzielny port QA 18878).
- Generator przykładów używa bezpośrednio kanonicznego modelu i parametrów, bez kopii algorytmu w przeglądarce.
- Demo używa teraz oryginalnego dashboardu z repo. Zweryfikowano suwaki, wybór aktywa/sesji, weekend stress, wykres impactu, sześć wierszy backtestu i tryb prezentacji. Cienka płynność blokuje nową pożyczkę przy zachowanym dodatnim marku.
- Menu mobilne działa, Escape je zamyka i oddaje fokus, wybranie odnośnika również je zamyka. Przycisk Menu jest ukryty na desktopie.
- Pierwszy fokus klawiatury trafia do Skip to content. Kontrolki mają widoczny fokus i etykiety.
- Wszystkie lokalne zasoby i odnośniki HTTP 200, wszystkie kotwice istnieją, identyfikatory nie powtarzają się.
- Brak błędów JavaScript i błędnych odpowiedzi lokalnych w przeglądarce.
- Brak poziomego przepełnienia przy szerokościach: 320, 390, 540, 768, 820, 821, 1024, 1440, 1920 px.
- Wizualnie oceniono hero oraz wszystkie sekcje na desktopie; evidence, liquidity, demo, devnet i team również na mobile 390 px.
- Zdjęcia lazy-loaded poprawnie dekodują się po przewinięciu.
- `prefers-reduced-motion` wyłącza smooth scroll i przejścia.
- Bez JavaScript pozostają dostępne treść i nawigacja strony. Dashboard pokazuje komunikat o wymaganym JavaScript.
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

## Dodatkowa kontrola dashboardu z repo

- 48 kombinacji aktywo × sesja × rozmiar/głębokość: pełna zgodność odpowiedzi statycznego adaptera z działającym `/api/ecv` (kwoty, terms, outputs, depthCurve, limity i trasa).
- Wszystkie sześć wierszy statycznego backtestu identyczne z `/api/backtest?params=priors`.
- Weekend stress zamyka gate, max borrow = $0, a executable mark pozostaje dodatni.
- Dashboard działa zarówno osobno, jak i w iframe strony. Sprawdzono tryb prezentacji, przejście do backtestu i wyjście Escape.
- Kontrolki działają po odłączeniu sieci. Przeglądarka nie wykonuje żadnych żądań `/api/`.
- Poprawiono przepełnienie odziedziczonego układu dashboardu przy 1024 px. Brak overflow w przedziale 320–1920 px.
- Live probe i Fitted są wyłączone z odpowiednim kontekstem; strona nie udaje połączenia z Jupiterem ani posiadania kalibracji.

## Kontrola interaktywnego wykresu 3D

- Obrót drag i klawiaturą, zoom, reset widoku oraz inspekcja punktów sprawdzone w przeglądarce.
- Kliknięcie punktu ustawia suwaki i przelicza dashboard; weekend stress odświeża powierzchnię/odczyt i zamyka gate.
- Tabela dokładnych wartości przekroju działa, obliczenia i widok działają bez sieci po załadowaniu.
- Kontrola wizualna desktop/mobile, brak overflow przy 320, 390, 768, 1024 i 1440 px.
- Klawiatura wykresu nie przełącza kroków prezentacji. Brak błędów JavaScript.
- Ponownie: 7/7 testów modelu, backtest bez wyjątku, /api/ecv HTTP 200.
- Dodatkowo sprawdzono dwupunktowy pinch zoom na emulowanym ekranie dotykowym oraz tabelę awaryjną przy niedostępnym kontekście Canvas.
