# Enem

App web gamificado para estudar para o ENEM com questões reais da API [enem.dev](https://enem.dev/), introduções conceituais e resoluções comentadas.

| Matéria | Unidades | Questões selecionadas |
| --- | ---: | ---: |
| Física | 5 por tema | 120 |
| Química | 5 por tema | 90 |
| Biologia | 5 por tema | 90 |
| Matemática | 7 por competência | 140 |
| Ciências da Natureza | 8 por competência | 300 |
| Geografia | 5 por tema | 80 |
| História | 5 por tema | 80 |
| Ciências Humanas | 6 por competência | 200 |
| Língua Portuguesa | 2 por tema | 20 |
| Literatura | 2 por tema | 20 |
| Inglês | 2 por tema | 20 |
| Espanhol | 2 por tema | 20 |
| Linguagens, Códigos e suas Tecnologias | 4 por disciplina | 80 |

Natureza é a união exata de Física, Química e Biologia. Humanas reúne as 80 questões de Geografia, as 80 de História e 40 complementares de Filosofia e Sociologia. O catálogo tem **720 questões únicas**, sem duplicar registros nas trilhas integradas. Todas as unidades têm introdução; todas as questões ativas têm justificativa específica.

Geografia e História têm trilhas temáticas próprias. Ciências Humanas organiza os mesmos itens e os complementares pelas seis competências da matriz do INEP, cada uma com pelo menos cinco questões. Filosofia e Sociologia aparecem como disciplinas de origem nas questões da trilha integrada. Os filtros, favoritos, revisão e estatísticas funcionam nas três novas opções. Uma resposta dada em Geografia ou História conta também no desempenho de Humanas; concluir uma lição continua sendo independente em cada trilha.

Linguagens reúne 80 questões de Português, Literatura, Inglês e Espanhol. Cada disciplina tem duas unidades conceituais e quatro lições. A trilha integrada organiza as mesmas questões em quatro unidades por disciplina, compartilhando respostas, favoritos e revisão, com conclusão de lições independente. A matriz completa de Linguagens (nove competências e 30 habilidades) está disponível como referência; a seleção inicial cobre as quatro disciplinas indicadas, sem afirmar cobertura integral da área. Os IDs de línguas estrangeiras incluem o idioma (`2023-3-ingles` e `2023-3-espanhol`), usado também no vínculo com TRI, para impedir colisões entre itens de mesmo ano e número.

Matemática tem 20 questões por competência, distribuídas em quatro lições de cinco questões (28 lições). A ampliação acrescentou 105 itens comentados aos 35 anteriores, preservando suas posições e os IDs das lições já concluídas. O acervo bruto local contém 642 registros de Matemática; somente os itens selecionados e revisados entram na prática.

Química e Biologia receberam mais 50 questões cada (10 por unidade), com resoluções específicas. A composição das lições anteriores, inclusive as lições parciais de três questões, é preservada em `data/courses/lesson-layout.json`. Cada matéria agora tem 20 lições. A questão anulada 2023-164 foi substituída por 2017-165 na mesma posição de Matemática (C6/H26), mantendo o ID e a conclusão da lição; o motivo e as fontes estão em `data/courses/math-replacement.json`.

## Aprovação nas lições

Cada tentativa começa com zero erros. Para concluir a lição e liberar a próxima, responda todos os itens com no máximo **3 erros**. O quarto erro encerra a tentativa após a leitura da resolução, sem conceder conclusão nem o bônus de 20 XP. O botão **Reiniciar lição** renova a tentativa imediatamente, sem espera ou limite diário. Respostas, estatísticas e XP por acerto permanecem salvos, assim como lições aprovadas anteriormente. A regra também se aplica às lições curtas, sem alterar sua composição.

## Notação matemática

Variáveis e expressões do conteúdo editorial usam delimitadores explícitos `\(...\)` no texto e `\[...\]` em blocos, com sintaxe TeX. Nos arquivos JSON, escape as barras como `\\(a\\)`. Use frações, expoentes e índices para distinguir as variáveis da prosa; explique o significado de cada quantidade. Esquemas conceituais sem matemática permanecem em texto. Valores monetários com `R$` não são tratados como delimitadores.

O KaTeX 0.19.0 e suas fontes WOFF2 estão em `dist/vendor/katex/`, com licença MIT e registro da integridade do pacote. A renderização gera HTML e MathML para acessibilidade, não aceita HTML arbitrário ou comandos confiáveis do TeX e funciona offline após o primeiro carregamento completo. Expressões longas podem ser roladas horizontalmente em telas pequenas. Os testes validam todas as expressões do catálogo e a presença das fontes no cache offline.

## Prática e desempenho

O modo prática usa filtros combinados por matéria, assunto, competência, ano, dificuldade TRI, palavra-chave e situação (todas, não respondidas, respondidas, erros pendentes ou favoritas). Inspirado no fluxo de bancos de questões do [Qconcursos](https://www.qconcursos.com/questoes-de-concursos/questoes), permite responder, corrigir, ler a justificativa e seguir para outra questão, sem limite de cinco itens nem limite de erros.

O sorteio não repete itens antes de percorrer a seleção. Ao terminar, começa outra rodada aleatória, exceto quando filtros como “não respondidas” ou “erros para revisar” deixam de ter itens elegíveis. Pular não registra resposta nem tempo. Favoritos e filtros persistem por matéria no navegador.

O painel Desempenho informa tentativas, questões distintas, acertos, erros, taxa de acerto, tempo total e médio, atividade dos últimos sete dias, desempenho por assunto e respostas recentes. Tem filtros de período e modo. Os dados são registrados a cada correção; o tempo pausa quando a página fica oculta e termina antes da leitura da resolução. Histórico e estatísticas são locais, sem sincronização entre dispositivos. Respostas anteriores à atualização continuam no progresso, mas não entram na taxa de acerto porque não tinham resultado e duração registrados.

## Dificuldade TRI

A API enem.dev não fornece TRI. Os parâmetros oficiais **a, b e c de 2009–2023** foram extraídos separadamente dos arquivos `ITENS_PROVA` nos [microdados do INEP](https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/microdados/enem). Apenas itens, dicionários e documentação foram baixados; nenhum registro de participante foi necessário.

O vínculo verifica caderno azul regular, ano, área, posição, sequência de gabaritos e resposta individual. As correspondências de Natureza e Matemática também contam com amostras de enunciados dos cadernos oficiais; o método disponível para cada item é registrado em `matchMethod`. Itens abandonados, parâmetros inválidos, ambiguidade e divergências de gabarito não recebem dificuldade estimada. A base ativa tem **711 de 720 questões com parâmetros válidos**; os demais itens são identificados como indisponíveis.

Os valores originais ficam em `data/reference/tri-parameters.json`, com código do item, código da prova, método de correspondência e fonte. O app apresenta o parâmetro de dificuldade **b convertido por 500 + 100 × b**, conforme os [procedimentos de análise do INEP, páginas impressas 20–21](https://download.inep.gov.br/publicacoes/institucionais/avaliacoes_e_exames_da_educacao_basica/enem_procedimentos_de_analise.pdf). Esse valor não é peso, pontos ganhos por questão ou previsão de nota. As áreas têm escalas próprias. Os intervalos até 500, acima de 500 até 650 e acima de 650 são filtros editoriais, sem rótulos oficiais de fácil/médio/difícil.

Para reconstruir a vinculação a partir dos arquivos oficiais locais:

```bash
python3 scripts/import-tri-parameters.py --import-cached
node scripts/build-courses.mjs
```

Use `--fetch --import-cached` para baixar novamente os arquivos de itens e dicionários via HTTP Range. Manifests e fontes permanecem em `data/reference/tri-source/`; as evidências de cadernos estão em `data/reference/tri-booklet-evidence-*.json`.

## Dados locais

Atualize o snapshot completo e gere os índices:

```bash
node scripts/sync-enem-data.mjs
node scripts/build-physics-index.mjs
node scripts/build-courses.mjs
```

O snapshot integral de 2.757 questões de 2009–2023 fica em `data/enem/all-questions.json` e também em `dist/data/all-questions.json`. O repositório completo de origem, com imagens, fica em `data/enem-source/` (ignorado pelo Git). O catálogo usado pela interface é `dist/data/courses.json`. As imagens dos itens selecionados são copiadas para `dist/assets/questions/`, sem depender do servidor de imagens remoto.

## Matriz de referência

Matemática, Ciências da Natureza, Ciências Humanas e Linguagens seguem as áreas, competências e habilidades do [documento oficial do INEP](https://download.inep.gov.br/enem/outros_documentos/enem_matriz_de_referencia_v1.pdf), baixado em 12/10/2026. A cópia local está em `data/reference/enem-matriz-de-referencia.pdf`; `matrix.json` registra as 30 competências, 120 habilidades, fonte, data e SHA-256. `scripts/extract-enem-matrix.py` reproduz a extração com `pypdf`.

Os títulos resumidos das unidades são didáticos. O texto integral da competência e de suas habilidades aparece em “ver matriz e habilidades”. A API fornece a área, mas não separa as disciplinas de Natureza ou de Humanas nem classifica habilidades. **Essas associações são editoriais do Enem**, explicitadas na interface. Todas as competências têm pelo menos cinco questões; a seleção ainda não cobre todas as habilidades, e o app destaca as que têm exercícios.

## Conteúdo didático

Cada unidade tem uma introdução conceitual com relações e fórmulas, notação, exemplo resolvido e um alerta sobre erros comuns. A leitura pode ser marcada como concluída. A primeira lição de cada unidade fica disponível; as seguintes são liberadas conforme o estudo. O seletor “Explorar unidades” permite ir diretamente a um tema ou competência.

Após verificar uma resposta, o app apresenta a alternativa correta e uma resolução específica, tanto nos acertos quanto nos erros, inclusive na prática personalizada. Esse conteúdo é elaborado para o Enem; não é uma resolução oficial fornecida pelo INEP ou pela API.

- `data/learning/introductions.json`: introduções das cinco unidades de Física.
- `data/learning/explanations-*.json`: resoluções por ID de questão, com conceito, passos e ideia-chave. `moduleId` permite corrigir a classificação da questão; `excludeReason` documenta itens incompletos ou fora do escopo.
- `data/learning/review-report.json`: relatório reproduzível da seleção ativa e dos motivos de exclusão. Todos os itens continuam no acervo bruto.
- `data/courses/quimica.json`, `biologia.json`, `matematica.json`: unidades, introduções, IDs de questões, habilidades e justificativas revisadas.
- `data/courses/natureza.json`: as oito unidades integradas e suas introduções; o gerador deriva a união das questões automaticamente.
- `data/courses/geografia.json` e `historia.json`: trilhas temáticas com 80 questões comentadas cada.
- `data/courses/humanas.json`: seis unidades por competência e 40 questões complementares de Filosofia/Sociologia; o gerador acrescenta os itens de Geografia e História sem duplicá-los.
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

## Instalar como aplicativo

Abra o site em HTTPS no Chrome ou Edge e use a opção **Instalar Enem** no menu do navegador (o nome e a posição variam conforme a versão). No iPhone/iPad, use **Compartilhar → Adicionar à Tela de Início**. O aplicativo usa ícone próprio e abre em uma janela independente.

Após o primeiro carregamento completo, a interface, as questões e as explicações ficam disponíveis offline. Imagens de questões ficam disponíveis depois de visualizadas; imagens ainda não abertas precisam de internet. O progresso continua salvo no navegador, separado por domínio. O acesso offline depende do armazenamento disponível no dispositivo.

O manifest e o service worker funcionam tanto na raiz do ChatGPT Sites quanto em `/enem/` no GitHub Pages. Para cada atualização de conteúdo ou código, altere `VERSION` e os valores `?v=` de `CORE_PATHS` em `dist/sw.js`, junto com as versões em `dist/index.html` e `DATA_URL` em `dist/app.js`. O novo cache é preparado antes de ativar a atualização; feche as janelas do app e reabra para concluí-la sem interromper uma lição. Não use `skipWaiting` para forçar a troca durante uma sessão.

## GitHub e implantação contínua

Repositório: [aureovinicius/enem](https://github.com/aureovinicius/enem). A branch de publicação é `main`. O histórico do projeto, o snapshot completo de 2.757 questões, as fontes de TRI e as imagens usadas nas 720 questões selecionadas estão versionados. A cópia integral do repositório externo `data/enem-source/` pode ser baixada pelo script de sincronização e não é duplicada neste Git.

Site publicado: **[aureovinicius.com.br/enem](https://aureovinicius.com.br/enem/)**, com HTTPS obrigatório. O repositório é público para compatibilidade com o plano atual da conta. GitHub Pages usa GitHub Actions, e `PAGES_ENABLED=true` já está configurado: novos pushes em `main` publicam automaticamente após os testes passarem. O endereço usa o domínio do GitHub Pages já existente na conta.

O workflow `.github/workflows/pages.yml` executa os testes e prepara um artefato estático em cada push ou pull request para `main`, e também pode ser executado manualmente. As ações oficiais são fixadas por commit; o deploy usa o token temporário do próprio GitHub Actions, sem exigir token pessoal salvo como segredo.

Para testar o mesmo pacote localmente:

```bash
node --test scripts/test-*.mjs
node scripts/build-github-pages.mjs --base-path /enem --out-dir .preview/enem
python3 -m http.server 4173 --bind 127.0.0.1 --directory .preview
```

Abra `http://127.0.0.1:4173/enem/`. Sem `--out-dir`, o pacote fica em `_site/`, como no workflow. A pasta de saída deve estar vazia ou não existir. Para uma prévia na raiz, gere outro pacote com `--base-path /`. O empacotamento usa somente os arquivos de `dist/` rastreados pelo Git, adapta as URLs de recursos e preserva `dist/` para a publicação original no ChatGPT Sites. Não há instalação de dependências nem download da API durante o CI.

A publicação está separada dos testes: o job de deploy só roda em `main` quando a variável de repositório `PAGES_ENABLED` vale `true`. Habilite GitHub Pages com a fonte **GitHub Actions** em Settings → Pages antes de ativar essa variável. `PAGES_BASE_PATH` é opcional e usa `/enem` por padrão; para domínio próprio na raiz, use `/`. Execute novamente o workflow após configurar.

GitHub Pages em conta pessoal publica um site acessível pela internet. Repositórios privados exigem um plano compatível com Pages; a privacidade do código não torna o site privado. Veja a [documentação do GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages). A ativação dessa nova publicação não altera a audiência do site original. O progresso permanece separado por domínio, pois é salvo no navegador.

## Fonte e licença

- Questões e gabaritos: [enem.dev](https://enem.dev/), obtidos de provas públicas do ENEM.
- Código da API de origem: [yunger7/enem-api](https://github.com/yunger7/enem-api), GPL-2.0.
- A seleção comentada não ativa automaticamente toda a base: itens sem revisão, com dados faltantes ou gabarito inconsistente permanecem no acervo bruto. As novas resoluções de Química, Biologia e Matemática passaram por revisão independente, inclusive das imagens e dos cálculos necessários.
- O Enem não é afiliado ao INEP, MEC ou Duolingo. A interface usa identidade visual própria.
