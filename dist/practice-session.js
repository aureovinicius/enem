const AREA_LABELS = {
  "ciencias-natureza": "Ciências da Natureza e suas Tecnologias",
  "ciencias-humanas": "Ciências Humanas e suas Tecnologias",
  linguagens: "Linguagens, Códigos e suas Tecnologias",
  matematica: "Matemática e suas Tecnologias",
};
const AREA_ABBREVIATIONS = { "ciencias-natureza": "CN", "ciencias-humanas": "CH", linguagens: "LC", matematica: "MT" };
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });

function milliseconds(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function label(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function metadata(question, catalog) {
  const areaId = label(question.areaId, "sem-area");
  const subjectId = label(question.subjectId, "sem-disciplina");
  const moduleId = label(question.moduleId, "sem-assunto");
  const areaTitle = label(catalog?.matrix?.areas?.[areaId]?.title, AREA_LABELS[areaId] || "Área não informada");
  const course = catalog?.courses?.find(item => item.id === subjectId);
  const subjectTitle = label(question.subjectTitle, label(course?.title, "Disciplina não informada"));
  const moduleTitle = label(question.moduleTitle, label(course?.modules?.find(item => item.id === moduleId)?.title, "Assunto não informado"));
  const competency = Number.isInteger(Number(question.competency)) && Number(question.competency) > 0 ? Number(question.competency) : null;
  const competencyDescription = catalog?.matrix?.areas?.[areaId]?.competencies?.find(item => Number(item.number) === competency)?.description;
  return {
    areaId, areaTitle, subjectId, subjectTitle, moduleId, moduleTitle, competency,
    area: { id: areaId, title: areaTitle, areaId },
    subject: { id: `${areaId}:${subjectId}`, title: subjectTitle, areaId, subjectId },
    topic: { id: `${areaId}:${subjectId}:${moduleId}`, title: moduleTitle, areaId, subjectId, moduleId, subjectTitle },
    competencyGroup: {
      id: `${areaId}:c${competency ?? "-"}`,
      title: `${AREA_ABBREVIATIONS[areaId] || areaTitle} · ${competency ? `Competência ${competency}` : "Competência não informada"}`,
      areaId, competency, description: competencyDescription || "", areaTitle,
    },
  };
}

function addGroup(groups, dimension, questionId, correct, durationMs) {
  if (!groups.has(dimension.id)) groups.set(dimension.id, { ...dimension, total: 0, correct: 0, wrong: 0, durationMs: 0, questionIds: new Set() });
  const group = groups.get(dimension.id);
  group.total += 1;
  group.correct += Number(correct);
  group.wrong += Number(!correct);
  group.durationMs += durationMs;
  group.questionIds.add(questionId);
}

function finishGroups(groups) {
  return [...groups.values()].map(({ questionIds, ...group }) => ({
    ...group,
    unique: questionIds.size,
    accuracy: group.total ? 100 * group.correct / group.total : null,
    averageMs: group.total ? Math.round(group.durationMs / group.total) : 0,
  })).sort((a, b) => collator.compare(a.title, b.title) || collator.compare(a.id, b.id));
}

function recommendationsFor(report) {
  if (!report.total) return [{
    title: "Ainda não há respostas para analisar",
    body: "Responda e confira algumas questões na próxima sessão. Questões puladas ou deixadas em aberto não são tratadas como erros e não permitem estimar seu aproveitamento.",
  }];

  const recommendations = [];
  if (report.unique < 3) recommendations.push({
    title: "Esta é uma amostra inicial",
    body: `Você respondeu ${report.unique} ${report.unique === 1 ? "questão diferente" : "questões diferentes"}. Ainda há pouca evidência para apontar um padrão de desempenho. Use os erros como pistas de revisão e resolva questões novas antes de escolher um foco duradouro.`,
  });

  const priorities = report.groups.topic.filter(group => group.wrong > 0).sort((a, b) =>
    b.wrong - a.wrong || a.accuracy - b.accuracy || b.unique - a.unique || collator.compare(a.title, b.title));
  for (const topic of priorities.slice(0, 3)) {
    if (topic.moduleId === "acervo-api") {
      recommendations.push({
        title: `Revisar questões de ${AREA_LABELS[topic.areaId] || "esta área"}`,
        body: `Você teve ${topic.wrong} ${topic.wrong === 1 ? "erro" : "erros"} em ${topic.total} ${topic.total === 1 ? "resposta" : "respostas"} do acervo importado. Esses itens ainda não têm assunto ou competência classificados. Revise os enunciados e o gabarito; o resultado permite orientar a revisão da área, mas não identificar um assunto específico.`,
        areaId: topic.areaId,
      });
      continue;
    }
    const smallSample = topic.unique < 3;
    recommendations.push({
      title: `${smallSample ? "Revisitar" : "Priorizar a revisão de"} ${topic.title}`,
      body: `${topic.wrong} ${topic.wrong === 1 ? "erro" : "erros"} em ${topic.total} ${topic.total === 1 ? "resposta" : "respostas"}, envolvendo ${topic.unique} ${topic.unique === 1 ? "questão diferente" : "questões diferentes"}, em ${topic.subjectTitle}. ${smallSample ? "A amostra deste assunto é pequena: confira a justificativa e teste o mesmo conceito em outras questões antes de concluir que há uma dificuldade recorrente." : "Releia as justificativas, retome a introdução conceitual e resolva questões novas deste assunto para verificar o aprendizado."}`,
      areaId: topic.areaId, subjectId: topic.subjectId, moduleId: topic.moduleId,
    });
  }

  if (!report.wrong) recommendations.push({
    title: "Amplie a variedade de questões",
    body: `Você acertou todas as ${report.total} respostas desta sessão. Experimente outras questões e assuntos: este resultado descreve esta amostra, sem demonstrar domínio de toda a disciplina.`,
  });

  if (report.total > report.unique) recommendations.push({
    title: "Confirme o aprendizado com questões novas",
    body: `As ${report.total} respostas incluem ${report.unique} questões diferentes. Repetições contam no aproveitamento e no tempo, mas não aumentam a variedade da amostra. Na próxima sessão, inclua questões ainda não respondidas.`,
  });

  if (report.skipped || report.unfinished) recommendations.push({
    title: "Retome as questões sem resposta",
    body: `Você pulou ${report.skipped} ${report.skipped === 1 ? "questão" : "questões"} e encerrou com ${report.unfinished} ${report.unfinished === 1 ? "questão em aberto" : "questões em aberto"}. Esses registros não entram na taxa de acertos. Revisite os enunciados para distinguir falta de tempo, dúvida conceitual e dificuldade de interpretação.`,
  });

  if (recommendations.length < 5 && report.slowest.length) recommendations.push({
    title: "Observe como você usou o tempo",
    body: "Revise as questões da lista das mais demoradas e identifique se o tempo foi usado na leitura, no cálculo ou na escolha entre alternativas. O tempo, isoladamente, não indica domínio ou dificuldade; compare-o com seus acertos e erros.",
  });
  return recommendations.slice(0, 5);
}

/**
 * Summarizes a completed or in-progress session without mutating its inputs.
 * Attempts are counted separately; unique question counts expose repeated items.
 * Only answered records with an explicit boolean result enter performance groups.
 * Canonical catalog metadata keeps original subjects when integrated courses remap modules.
 */
export function buildPracticeReport(session, catalog) {
  const questions = new Map((Array.isArray(catalog?.questions) ? catalog.questions : []).filter(question => question && typeof question.id === "string").map(question => [question.id, question]));
  const groups = { area: new Map(), subject: new Map(), topic: new Map(), competency: new Map() };
  const unique = new Set();
  const slowest = new Map();
  const report = {
    total: 0, correct: 0, wrong: 0, accuracy: null, unique: 0, averageMs: 0,
    answerMs: 0, skipped: 0, skippedMs: 0, unfinished: 0, unfinishedMs: 0,
    activeMs: 0, recordedMs: 0, reviewMs: 0, invalidRecords: 0,
    groups: {}, slowest: [], recommendations: [],
  };
  for (const record of Array.isArray(session?.records) ? session.records : []) {
    const question = record && questions.get(record.questionId);
    if (!question || !["answered", "skipped", "unfinished"].includes(record.outcome) || (record.outcome === "answered" && typeof record.correct !== "boolean")) {
      report.invalidRecords += 1;
      continue;
    }
    const durationMs = milliseconds(record.durationMs);
    report.recordedMs += durationMs;
    if (record.outcome !== "answered") {
      report[record.outcome] += 1;
      report[`${record.outcome}Ms`] += durationMs;
      continue;
    }
    report.total += 1;
    report.correct += Number(record.correct);
    report.wrong += Number(!record.correct);
    report.answerMs += durationMs;
    unique.add(question.id);
    const meta = metadata(question, catalog);
    addGroup(groups.area, meta.area, question.id, record.correct, durationMs);
    addGroup(groups.subject, meta.subject, question.id, record.correct, durationMs);
    addGroup(groups.topic, meta.topic, question.id, record.correct, durationMs);
    addGroup(groups.competency, meta.competencyGroup, question.id, record.correct, durationMs);
    if (!slowest.has(question.id)) slowest.set(question.id, {
      questionId: question.id, title: label(question.title, `Questão ${question.id}`),
      subjectTitle: meta.subjectTitle, moduleTitle: meta.moduleTitle,
      subjectId: meta.subjectId, moduleId: meta.moduleId, areaId: meta.areaId,
      durationMs: 0, attempts: 0, correct: 0, wrong: 0,
    });
    const slow = slowest.get(question.id);
    slow.durationMs += durationMs;
    slow.attempts += 1;
    slow.correct += Number(record.correct);
    slow.wrong += Number(!record.correct);
  }
  report.unique = unique.size;
  report.accuracy = report.total ? 100 * report.correct / report.total : null;
  report.averageMs = report.total ? Math.round(report.answerMs / report.total) : 0;
  report.activeMs = Math.max(milliseconds(session?.activeMs), report.recordedMs);
  report.reviewMs = report.activeMs - report.recordedMs;
  report.groups = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, finishGroups(value)]));
  report.slowest = [...slowest.values()].sort((a, b) => b.durationMs - a.durationMs || collator.compare(a.questionId, b.questionId)).slice(0, 5);
  report.recommendations = recommendationsFor(report);
  return report;
}
