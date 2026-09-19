# Wrzucenie repo na GitHub — 15 sekund

Repo jest już zainicjowane i ma pierwszy commit. Brakuje tylko Twojego konta.

## Wariant A — masz GitHub CLI (`gh`)

```bash
cd rwa-shield
gh repo create rwa-shield --private --source=. --remote=origin --push
```

## Wariant B — bez CLI

1. Załóż puste repo na https://github.com/new — nazwa `rwa-shield`, **prywatne**,
   bez README, bez .gitignore (mamy własne).
2. Potem:

```bash
cd rwa-shield
git remote add origin git@github.com:<TWOJ_LOGIN>/rwa-shield.git
git branch -M main
git push -u origin main
```

## Zaproszenie zespołu

Settings → Collaborators → Add people. Minimum na dziś:
- deweloper Rust/Anchor — write
- Bartek (design) — write (katalog `web/`)
- Julita (legal) — read, plus dostęp do `docs/` gdy powstanie

## Zasady pracy w repo (ustalone, nie do negocjacji przed 12.10)

- Branch na zadanie: `feat/b-dane`, `feat/e-demo`, `fix/...`
- `main` zawsze działa: `node --test src/ecv/*.test.mjs` musi przechodzić
- Commit message po polsku, jedno zdanie: co i dlaczego
- Nie zmieniamy kształtu pięciu wyjść z `src/ecv/model.mjs` — to kontrakt
- Historia commitów z okresu hackathonu jest dowodem dla sędziów Colosseum.
  Commitujemy codziennie, nie jedną paczką na końcu.
