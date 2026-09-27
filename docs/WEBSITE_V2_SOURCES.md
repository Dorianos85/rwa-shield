# Website V2 — źródła, audyt i ograniczenia

## Zakres

Nowa statyczna strona w `docs/`. Bez nowych zależności, połączeń z API w przeglądarce, portfela i transakcji. `src/`, `web/` i `onchain/` pozostają bez zmian. Root `index.html` nadal przekierowuje do `docs/`.

Audyt wykonano względem `main` na commicie `a37abe7`, 28.09.2026. Poprzednia strona miała starą identyfikację, skupiała się na syntetycznym backteście, nie pokazywała aktualnego zespołu ani wdrożenia devnet. Link „Live dashboard” prowadził poza katalog publikowany przez Pages i wymagał serwera API.

## Główne źródło redakcyjne

`docs/deck/RWA-Shield-Warsaw-Pitch-Best.pptx`: oryginalny załącznik „RWA Shield — Warsaw pitch Best.pptx”, 15 slajdów.

SHA-256: `c0a48d9c0a38fe240decc6b62022190cfe0a3c63b9de9a0a3227fd77730957b1`.

Okładka mówi „10.2026”; strona zachowuje rzeczywiste wrześniowe daty pomiarów. Starszy PDF pozostawiono jako istniejący plik, ale nie jest źródłem V2.

| Treść strony | Źródło | Sposób prezentacji / ograniczenie |
|---|---|---|
| Nowe logo i grafika hero | `ppt/media/image-1-2.png`, `image-1-1.jpeg` | Oryginalne pliki, bez odrysowania |
| Problem i odbiorca B2B | Slajdy 1–2 | Lending / vault / curator integrujący xStocks |
| $34.8M, $7.8M, ≈4.5× | Slajd 4, 26.09.2026 | Pełne limity depozytów; 34.8/7.8 = 4.46; nie bieżący dług |
| 18, 43, 47, 48, 49, 104, 145, 291, ≥310% | Wykres `image-4-1.png`, slajd 4 | Exit book / dług dozwolony przy ówczesnych depozytach; inny mianownik niż nagłówek pełnych limitów; HOODx dolna granica |
| $5.1M, 1,424, 7,040, 59% | Slajd 5 | Odczyt on-chain 27.09, kwotowania 26.09; liczby raportowane w pitchu |
| GOOGLx $0.91M, ~751 tokenów, +$2k/−$18k/−$224k | Slajd 5 | Szoki −10/−20/−30%; wynik likwidatora, nie zrealizowana strata protokołu; bonus 5% |
| NVDAx 1.02/1.09/1.36M, 1.12/1.19/1.53M | Wykres `image-6-1.png`, slajd 6 | Pojemność zyskowna / cała księga, 24–26.09.2026; (1.36/1.02−1)=33.33% |
| −$22k/−$8k/+$34k | Slajd 6 | Ten sam szok −25%, pozycje przy 55% LTV; 5% bonus |
| Pięć wyjść ECV + diagnostyczny breaker_reason | `src/ecv/model.mjs`, `onchain/.../state.rs` | Model daje również executableValue i ecv; breaker nie zeruje marku istniejącej pozycji |
| Demo interaktywne SPYx | `scripts/build-website-demo.mjs` → `docs/demo-data.js` | Syntetyczne wejścia, wynik rzeczywistego modelu, DEFAULT_PARAMS; trzy skończone scenariusze, brak live API |
| Nagranie TSLAx $100k, $84,358, $58,684, $55,000, 90% | Slajd 8 | Oddzielne zwijane objaśnienie. Snapshot + sandbox; nie utożsamiany z publicznym demo SPYx |
| $5,336,023.085 fixed / $0 ECV / 369 odmów | Bieżący `src/backtest/run.mjs`, DEFAULT_PARAMS | Wynik odtworzony 28.09.2026, syntetyczny, in-sample. Na stronie zaokrąglony do $5.34M |
| ~80% kredytu bazowego | Bieżący engine | `lentLessPct=20.23%`, czyli 79.77% bazowej podaży kredytu; rounded ratio=0.8 |
| Devnet, program/config/record | `onchain/README.md`, `Anchor.toml`, `state.rs`, poster | Linki mają `cluster=devnet`. Publikacja, pojedynczy signer, bez egzekucji limitu |
| 26.09.2026, ostatni post 19:55 Warszawa | Slajd 10 | Zgodne z odczytem RPC: 17:55:12 UTC, 19:55:12 Warszawa; rekord stary wobec TTL 30 s |
| Monetyzacja | Slajd 13 | Hipoteza, nie ARR; żadnych fikcyjnych klientów |
| Nazwy, role, doświadczenie zespołu | Slajd 14 | Zachowane zgodnie z pitchem |

## Mapowanie zdjęć zespołu

Weryfikacja pozycji obiektów i relacji w `ppt/slides/slide14.xml`:

- `image-14-1.png` → Dorian Żaczek
- `image-14-2.png` → Julita Szaruta
- `image-14-3.png` → Mieszko Manijak
- Adam Książkiewicz → inicjały AK w oryginale, brak zdjęcia
- `image-14-5.png` → doradca Adam Kwak (nie Adam Książkiewicz)

## Różnice i kwestie do rozstrzygnięcia

1. **Backtest pitch vs kod.** Slajd 9 mówi ~$3.98M złego długu fixed, ~100% kredytu bazowego i ~27% średniej dla sześciu scenariuszy. Czysty publiczny checkout daje ~$5.34M i ~80% bazy. Dokładny artefakt kalibracji pitchu nie jest w repo. Nie zmieniano modelu, aby dopasować marketing. Strona pokazuje odtwarzalny wynik oraz jawne porównanie z pitchem.
2. **Ograniczenia silnika.** `LIQ_LAG_HOURS` i `maturityHours` są zadeklarowane, lecz pętla nie stosuje odroczonej egzekucji ani zapadalności. Nie powielono twierdzenia README, że te mechanizmy są symulowane. Wyniki pozostają ilustracją syntetyczną, nie walidacją historyczną.
3. **Brak surowych pomiarów Kamino/Jupiter w publicznym checkout.** Wartości dopasowano do tekstu i oryginalnych wykresów PPTX. Nie można odtworzyć pomiarów z samych plików w repo. Na stronie są daty, źródło pitch i informacja o braku raw quote ladders. Dla niezależnej replikacji potrzebny jest eksport kwotowań i odczytów obligations.
4. **Osobny sandbox TSLAx.** Slajd 8 opisuje rezerwę USDC i kink 90%. Publiczny model nie implementuje tego ostrzeżenia. Zapis pitchu oddzielono od interaktywnego demo kanonicznego modelu; nie dodano wymyślonego algorytmu.
5. **Devnet freshness.** Adresy i zakres funkcjonalny zweryfikowano z kodem/repo. Odczyt RPC `getMultipleAccounts`, commitment confirmed, slot 504960309: program jest executable; Config 45 B i EcvRecord 109 B mają właściwego ownera. Zdekodowany rekord: posted_at 1790445312 = 26.09.2026 17:55:12 UTC / 19:55:12 Warszawa; posted_slot 504492381; route `offline:synthetic-curve`; TTL konfiguracji 30 s. Rekord jest stary i syntetyczny. Potwierdza publikację, nie aktualne dane rynku ani ciągłą pracę postera. Surowy publiczny odczyt: `devnet-proof.json`.
6. **Metryki rynkowe i incydenty.** Nie przeniesiono wszystkich kwot incydentów, danych konkurencji ani twierdzenia o braku konkurentów. Nie są potrzebne do narracji strony i wymagają osobnego audytu źródeł pierwotnych. Zamiast nich pokazano precyzyjny problem, własne pomiary i neutralne kategorie rynkowe. Gauntlet opisuje curation/risk management na https://www.gauntlet.xyz/; Chaos Labs podlinkowano jako kategorię wskazaną w pitchu, bez kwot.
7. **Zdjęcie Adama Książkiewicza.** Pitch ma inicjały AK. Strona zachowuje je i nie generuje portretu. Zdjęcie doradcy przypisano Adamowi Kwakowi.

## Odtwarzanie

```sh
node --test src/ecv/*.test.mjs
node src/backtest/run.mjs
node scripts/build-website-demo.mjs
node src/api/server.mjs
# GET http://localhost:8787/api/ecv → 200
```

`docs/` działa bez instalacji i bez budowania. Generator uruchamia się tylko przy świadomej aktualizacji przykładów z modelu. Po zmianach modelu należy odtworzyć przykłady i ponownie zweryfikować treść sekcji Validation.

## Weryfikacja strony

Wyniki końcowej kontroli desktop/mobile i interakcji zapisano w `WEBSITE_V2_QA.md`.
