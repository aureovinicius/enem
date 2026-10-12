# Fisio

App web gamificado para estudar Física para o ENEM com questões reais da API [enem.dev](https://enem.dev/).

## Dados locais

Atualize o snapshot completo e gere o índice de Física:

```bash
node scripts/sync-enem-data.mjs
node scripts/build-physics-index.mjs
```

O snapshot integral fica em `data/enem/all-questions.json` e também é copiado para `dist/data/all-questions.json`. O índice usado pela interface fica em `dist/data/physics-questions.json`.

## Desenvolvimento

O projeto é estático. Sirva a pasta `dist` com qualquer servidor HTTP local:

```bash
python3 -m http.server 4173 --directory dist
```

Depois, abra `http://localhost:4173`.

## Fonte e licença

- Questões e gabaritos: [enem.dev](https://enem.dev/), obtidos de provas públicas do ENEM.
- Código da API de origem: [yunger7/enem-api](https://github.com/yunger7/enem-api), GPL-2.0.
- O Fisio não é afiliado ao INEP, MEC ou Duolingo. A interface usa identidade visual própria.
