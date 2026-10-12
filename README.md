# Fisio

App web gamificado para estudar Física para o ENEM com questões reais da API [enem.dev](https://enem.dev/).

## Dados locais

Atualize o snapshot completo e gere o índice de Física:

```bash
node scripts/sync-enem-data.mjs
node scripts/build-physics-index.mjs
```

O snapshot integral fica em `data/enem/all-questions.json` e também é copiado para `dist/data/all-questions.json`. O índice usado pela interface fica em `dist/data/physics-questions.json`.

## Conteúdo didático

Cada uma das cinco unidades tem uma introdução conceitual com fórmulas, notação, exemplo resolvido e um alerta sobre erros comuns. A leitura pode ser marcada como concluída, sem bloquear a prática ou alterar lições já concluídas.

Após verificar uma resposta, o app apresenta a alternativa correta e uma resolução específica, tanto nos acertos quanto nos erros, inclusive na prática personalizada. Esse conteúdo é elaborado para o Fisio; não é uma resolução oficial fornecida pelo INEP ou pela API.

- `data/learning/introductions.json`: introduções das cinco unidades.
- `data/learning/explanations-*.json`: resoluções por ID de questão, com conceito, passos e ideia-chave. `moduleId` permite corrigir a classificação da questão; `excludeReason` documenta itens incompletos ou fora do escopo.
- `data/learning/review-report.json`: relatório reproduzível da seleção ativa e dos motivos de exclusão. Todos os itens continuam no acervo bruto.

O gerador só publica questões com resolução revisada, evitando que futuras sincronizações introduzam perguntas sem justificativa. Valide o conteúdo e os fluxos com:

```bash
node scripts/build-physics-index.mjs
node --test scripts/test-learning.mjs
```

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
