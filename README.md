# Fisio

App web gamificado para estudar para o ENEM com questões reais da API [enem.dev](https://enem.dev/), introduções conceituais e resoluções comentadas.

| Matéria | Unidades | Questões selecionadas |
| --- | ---: | ---: |
| Física | 5 por tema | 120 |
| Química | 5 por tema | 40 |
| Biologia | 5 por tema | 40 |
| Matemática | 7 por competência | 140 |
| Ciências da Natureza | 8 por competência | 200 |

Natureza é a união exata de Física, Química e Biologia. O catálogo tem **340 questões únicas**, sem duplicar registros para a trilha integrada. Todas as 30 unidades têm introdução; todas as questões ativas têm justificativa específica.

Matemática tem 20 questões por competência, distribuídas em quatro lições de cinco questões (28 lições). A ampliação acrescentou 105 itens comentados aos 35 anteriores, preservando suas posições e os IDs das lições já concluídas. O acervo bruto local contém 642 registros de Matemática; somente os itens selecionados e revisados entram na prática.

## Dados locais

Atualize o snapshot completo e gere os índices:

```bash
node scripts/sync-enem-data.mjs
node scripts/build-physics-index.mjs
node scripts/build-courses.mjs
```

O snapshot integral de 2.757 questões de 2009–2023 fica em `data/enem/all-questions.json` e também em `dist/data/all-questions.json`. O repositório completo de origem, com imagens, fica em `data/enem-source/` (ignorado pelo Git). O catálogo usado pela interface é `dist/data/courses.json`. As imagens dos itens selecionados são copiadas para `dist/assets/questions/`, sem depender do servidor de imagens remoto.

## Matriz de referência

Matemática e Ciências da Natureza seguem as áreas, competências e habilidades do [documento oficial do INEP](https://download.inep.gov.br/enem/outros_documentos/enem_matriz_de_referencia_v1.pdf), baixado em 12/10/2026. A cópia local está em `data/reference/enem-matriz-de-referencia.pdf`; `matrix.json` registra as 15 competências, 60 habilidades, fonte, data e SHA-256. `scripts/extract-enem-matrix.py` reproduz a extração com `pypdf`.

Os títulos resumidos das unidades são didáticos. O texto integral da competência e de suas habilidades aparece em “ver matriz e habilidades”. A API fornece a área, mas não separa Física, Química e Biologia nem classifica habilidades. **Essas associações são editoriais do Fisio**, explicitadas na interface. Todas as competências têm pelo menos cinco questões; a seleção ainda não cobre todas as habilidades, e o app destaca as que têm exercícios.

## Conteúdo didático

Cada unidade tem uma introdução conceitual com relações e fórmulas, notação, exemplo resolvido e um alerta sobre erros comuns. A leitura pode ser marcada como concluída. A primeira lição de cada unidade fica disponível; as seguintes são liberadas conforme o estudo. O seletor “Explorar unidades” permite ir diretamente a um tema ou competência.

Após verificar uma resposta, o app apresenta a alternativa correta e uma resolução específica, tanto nos acertos quanto nos erros, inclusive na prática personalizada. Esse conteúdo é elaborado para o Fisio; não é uma resolução oficial fornecida pelo INEP ou pela API.

- `data/learning/introductions.json`: introduções das cinco unidades de Física.
- `data/learning/explanations-*.json`: resoluções por ID de questão, com conceito, passos e ideia-chave. `moduleId` permite corrigir a classificação da questão; `excludeReason` documenta itens incompletos ou fora do escopo.
- `data/learning/review-report.json`: relatório reproduzível da seleção ativa e dos motivos de exclusão. Todos os itens continuam no acervo bruto.
- `data/courses/quimica.json`, `biologia.json`, `matematica.json`: unidades, introduções, IDs de questões, habilidades e justificativas revisadas.
- `data/courses/natureza.json`: as oito unidades integradas e suas introduções; o gerador deriva a união das questões automaticamente.
- `data/courses/physics-mapping.json`: associação editorial das questões de Física às habilidades da área de Natureza.

O progresso permanece no navegador usando `fisio-progress-v1`. Os IDs antigos das lições de Física são preservados. Conclusão e leitura são independentes por trilha; XP, sequência e revisão de erros são compartilhados. Um acerto em Natureza remove o erro pendente da mesma questão na matéria de origem. A prática filtra os erros pela matéria selecionada.

O gerador só publica questões com resolução revisada, evitando que futuras sincronizações introduzam perguntas sem justificativa. Valide o conteúdo e os fluxos com:

```bash
node scripts/build-physics-index.mjs
node scripts/build-courses.mjs
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
- A seleção comentada não ativa automaticamente toda a base: itens sem revisão, com dados faltantes ou gabarito inconsistente permanecem no acervo bruto. As novas resoluções de Química, Biologia e Matemática passaram por revisão independente, inclusive das imagens e dos cálculos necessários.
- O Fisio não é afiliado ao INEP, MEC ou Duolingo. A interface usa identidade visual própria.
