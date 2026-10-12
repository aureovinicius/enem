const DATA_URL = "/data/courses.json?v=practice-2";
const STORAGE_KEY = "fisio-progress-v1";
const DAILY_GOAL = 50;

const modulePalette = {
  mecanica: ["#35b66f", "#178655"],
  eletricidade: ["#ffb339", "#d78612"],
  "ondas-optica": ["#37a8e5", "#147eb8"],
  termologia: ["#f06d62", "#bd423e"],
  eletromagnetismo: ["#8d6bdd", "#6547ae"],
};

const app = document.querySelector("#app");
const rail = document.querySelector("#right-rail");
const modal = document.querySelector("#lesson-modal");
const toast = document.querySelector("#toast");
const shell = document.querySelector(".shell");
let returnFocus = null;
let introModuleId = null;

let catalog;
let data;
let lessons = [];
let activeView = location.hash.slice(1) || "aprender";
let quiz = null;
let statsPeriod = "30";
let statsMode = "all";
let storageWarning = false;

function localDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function loadState() {
  const fallback = {
    xp: 0,
    todayXp: 0,
    dailyDay: localDay(),
    lastStudyDay: null,
    streak: 0,
    hearts: 5,
    completed: [],
    introductionsRead: [],
    answered: [],
    missed: [],
    activeCourse: "fisica",
    attempts: [],
    favorites: [],
    practiceFilters: {},
    statsSince: new Date().toISOString(),
    legacyAnsweredCount: 0,
  };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    for (const key of ["completed", "introductionsRead", "answered", "missed", "favorites"]) {
      saved[key] = Array.isArray(saved[key]) ? saved[key].filter(x => typeof x === "string") : [];
    }
    saved.attempts = Array.isArray(saved.attempts) ? saved.attempts.filter(a => a && typeof a.questionId === "string" && typeof a.correct === "boolean" && Number.isFinite(Date.parse(a.at))) : [];
    if (!saved.attempts.length && !saved.legacyAnsweredCount) saved.legacyAnsweredCount = saved.answered.length;
    if (!saved.practiceFilters || typeof saved.practiceFilters !== "object" || Array.isArray(saved.practiceFilters)) saved.practiceFilters = {};
    if (saved.dailyDay !== localDay()) {
      saved.todayXp = 0;
      saved.hearts = 5;
      saved.dailyDay = localDay();
    }
    return saved;
  } catch {
    return fallback;
  }
}

let state = loadState();

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); storageWarning = false; }
  catch { storageWarning = true; showToast("O navegador não conseguiu salvar. Mantenha esta página aberta para preservar a sessão."); }
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderMarkdown(value = "") {
  const escaped = escapeHtml(value);
  const withImages = escaped.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
    const safeUrl = url.startsWith("/assets/questions/") || url.startsWith("https://enem.dev/")
      ? url
      : "";
    return safeUrl ? `<img src="${safeUrl}" alt="${alt || "Imagem da questão"}" loading="lazy">` : "";
  });
  return `<p>${withImages
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>")}</p>`;
}

function makeLessons() {
  let globalIndex = 0;
  lessons = data.modules.flatMap((module, moduleIndex) => {
    const questions = data.questions.filter((question) => question.moduleId === module.id);
    const byId = new Map(questions.map(q => [q.id, q]));
    const groups = data.lessonLayout?.[module.id] || Array.from({ length: Math.ceil(questions.length / 5) }, (_, i) => questions.slice(i * 5, i * 5 + 5).map(q => q.id));
    return groups.map((ids, index) => {
      const lessonQuestions = ids.map(id => byId.get(id)).filter(Boolean);
      const lesson = {
        id: `${module.id}-${index + 1}`,
        module,
        moduleIndex,
        index,
        globalIndex: globalIndex++,
        title: ["Fundamentos", "Aplicações", "Desafio ENEM", "Domínio"][index] || `Prática ${index + 1}`,
        questions: lessonQuestions.length ? lessonQuestions : questions.slice(0, 5),
      };
      return lesson;
    });
  });
}

function isUnlocked(lesson) {
  return lesson.index === 0 || state.completed.includes(lessons[lesson.globalIndex - 1]?.id);
}

function setCourse(courseId) {
  const course = catalog.courses.find((c) => c.id === courseId) || catalog.courses[0];
  const byId = new Map(catalog.questions.map((q) => [q.id, q]));
  data = { ...course, questions: course.questionIds.map((id) => {
    const question = byId.get(id);
    if (course.id !== "ciencias-natureza") return question;
    const module = course.modules.find((m) => m.competency === question.competency);
    return { ...question, moduleId: module.id, moduleTitle: module.title };
  }) };
  state.activeCourse = course.id;
  makeLessons();
  saveState();
}

function completedLessons() {
  return lessons.filter((lesson) => state.completed.includes(lesson.id)).length;
}

function courseSwitcher() {
  return `<div class="course-switcher"><label for="course-select">Matéria</label><select id="course-select" aria-label="Matéria">${catalog.courses.map((course) => `<option value="${course.id}" ${course.id === data.id ? "selected" : ""}>${course.emoji} ${escapeHtml(course.title)}</option>`).join("")}</select><span>${data.total} questões comentadas</span></div>`;
}

function referenceMarkup(module) {
  if (!module.reference) return "";
  const practiced = new Set(data.questions.filter((q) => q.moduleId === module.id).map((q) => q.skill));
  return `<details class="competency-reference"><summary>Competência de área ${module.competency} · ver matriz e habilidades</summary>
    <p>${escapeHtml(module.reference.description)}</p>
    <ul>${module.reference.skills.map((skill) => `<li><strong>H${skill.number}</strong> ${escapeHtml(skill.description)}${practiced.has(skill.number) ? '<span class="skill-present">Na prática desta unidade</span>' : ""}</li>`).join("")}</ul>
    <p class="reference-note">Texto da matriz do INEP, p. ${module.reference.page}. A associação das questões às habilidades é editorial. As habilidades destacadas têm exercícios nesta seleção.</p>
    <a class="source-link" href="${catalog.matrix.source}" target="_blank" rel="noreferrer">Consultar documento oficial ↗</a></details>`;
}

function nextLesson() {
  return lessons.find((lesson) => isUnlocked(lesson) && !state.completed.includes(lesson.id)) || lessons[0];
}

function statMarkup() {
  return `
    <div class="stat-chip fire" title="Sequência diária">🔥 ${state.streak}</div>
    <div class="stat-chip xp" title="Pontos de experiência">✦ ${state.xp}</div>
    <div class="stat-chip hearts" title="Corações">♥ ${state.hearts}</div>
  `;
}

function renderRail() {
  const goal = Math.min(100, (state.todayXp / DAILY_GOAL) * 100);
  const completed = completedLessons();
  const course = Math.round((completed / Math.max(lessons.length, 1)) * 100);
  rail.innerHTML = `
    <div class="stat-strip">${statMarkup()}</div>
    <section class="rail-card">
      <h3>Meta diária</h3>
      <p>Ganhe ${DAILY_GOAL} XP para fechar o dia.</p>
      <div class="progress-row"><span>Hoje</span><span>${state.todayXp} / ${DAILY_GOAL} XP</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${goal}%"></div></div>
    </section>
    <section class="rail-card">
      <h3>Seu curso</h3>
      <p>${completed} de ${lessons.length} lições concluídas.</p>
      <div class="progress-row"><span>${escapeHtml(data.title)}</span><span>${course}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${course}%;background:var(--green)"></div></div>
      <button class="button" data-action="continue">Continuar</button>
    </section>
    <section class="rail-card">
      <h3>Questões reais</h3>
      <p class="tiny">${data.total} questões de ${escapeHtml(data.title)} com resolução comentada. Acervo ENEM de 2009 a 2023.</p>
      <p class="tiny" style="margin-top:9px"><a class="source-link" href="https://enem.dev" target="_blank" rel="noreferrer">Fonte: enem.dev ↗</a></p>
    </section>
  `;
}

function pageHeader(kicker, title, subtitle) {
  return `
    <div class="mobile-stats">${statMarkup()}</div>
    ${courseSwitcher()}
    <p class="page-kicker">${kicker}</p>
    <h1 class="page-title">${title}</h1>
    <p class="page-subtitle">${subtitle}</p>
  `;
}

function renderLearn() {
  const next = nextLesson();
  const grouped = data.modules.map((module) => ({
    module,
    lessons: lessons.filter((lesson) => lesson.module.id === module.id),
  }));

  app.innerHTML = `
    ${pageHeader(`Trilha de ${escapeHtml(data.title)}`, "Do conceito à prova.", escapeHtml(data.description))}
    <div class="course-toolbar">
      <div class="course-pill"><span class="course-dot"></span> ${data.emoji} ${escapeHtml(data.title)} · ENEM</div>
      <button class="button" data-lesson="${next.id}">Continuar trilha</button>
    </div>
    <div class="curriculum-note"><strong>${escapeHtml(data.areaTitle)}</strong><span>${["matematica", "ciencias-natureza"].includes(data.id) ? `${data.modules.length} unidades organizadas pelas competências da matriz do INEP.` : "Unidades organizadas por tema, com competência e habilidade indicadas em cada questão."} Comece por qualquer unidade e avance pelas lições.</span>${data.id === "ciencias-natureza" ? '<span>Esta trilha reúne todas as questões de Física, Química e Biologia, sem repetição. A revisão de erros é compartilhada entre as trilhas.</span>' : ""}</div>
    <div class="unit-jump"><label for="unit-select">Explorar unidades</label><select id="unit-select"><option value="">Escolha uma unidade…</option>${data.modules.map((m, i) => `<option value="${m.id}">${m.competency ? `C${m.competency}` : `Unidade ${i + 1}`} · ${escapeHtml(m.title)}</option>`).join("")}</select></div>
    <div class="path">
      ${grouped.map(({ module, lessons: moduleLessons }, moduleIndex) => {
        const [color, dark] = modulePalette[module.id] || module.color || modulePalette.mecanica;
        const completed = moduleLessons.filter((lesson) => state.completed.includes(lesson.id)).length;
        return `
          <section id="unit-${module.id}" class="unit" style="--unit-color:${color};--unit-dark:${dark}">
            <div class="unit-banner">
              <div class="unit-title-wrap">
                <span class="unit-emoji">${module.emoji}</span>
                <div><h2 tabindex="-1">${module.competency ? `Competência ${module.competency}` : `Unidade ${moduleIndex + 1}`} · ${escapeHtml(module.title)}</h2><p>${escapeHtml(module.description || moduleDescriptions[module.id] || "")}</p></div>
              </div>
              <span class="unit-count">${completed}/${moduleLessons.length} lições</span>
            </div>
            ${referenceMarkup(module)}
            <button class="intro-card" data-intro="${module.id}" aria-label="Introdução conceitual de ${module.title}">
              <span class="intro-icon" aria-hidden="true">☰</span>
              <span><strong>Introdução conceitual</strong><span>${escapeHtml(module.introduction.summary)}</span><small>${state.introductionsRead.includes(module.id) ? "✓ Lida · Revisar conceitos" : `${module.introduction.duration} de leitura · Comece por aqui`}</small></span>
              <span aria-hidden="true">↗</span>
            </button>
            <div class="lesson-path">
              ${moduleLessons.map((lesson) => {
                const complete = state.completed.includes(lesson.id);
                const unlocked = isUnlocked(lesson);
                const current = unlocked && !complete && lesson.id === next.id;
                const icon = complete ? "✓" : unlocked ? ["▸", "◆", "★", "♛"][lesson.index % 4] : "🔒";
                return `
                  <div class="lesson-row">
                    <button class="lesson-node ${complete ? "complete" : ""} ${!unlocked ? "locked" : ""} ${current ? "current" : ""}"
                      ${unlocked ? `data-lesson="${lesson.id}"` : "disabled"}
                      aria-label="${escapeHtml(lesson.title)}${complete ? ", concluída" : unlocked ? "" : ", bloqueada"}">${icon}</button>
                    <div class="lesson-label"><strong>${lesson.title}</strong><span>${complete ? "Concluída" : unlocked ? `${lesson.questions.length} questões` : "Complete a anterior"}</span></div>
                  </div>
                `;
              }).join("")}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

const moduleDescriptions = {
  mecanica: "Movimento, forças, energia e equilíbrio.",
  eletricidade: "Circuitos, potência e consumo elétrico.",
  "ondas-optica": "Som, luz, espelhos e fenômenos ondulatórios.",
  termologia: "Calor, temperatura e transformações térmicas.",
  eletromagnetismo: "Campos magnéticos, indução e aplicações.",
};

function defaultPracticeFilters() {
  return { module: "", year: "", competency: "", difficulty: "", status: "all", query: "" };
}

function practiceFilters() {
  return { ...defaultPracticeFilters(), ...state.practiceFilters[data.id] };
}

function difficultyScore(question) {
  return Number.isFinite(question.tri?.difficultyScore) ? question.tri.difficultyScore : null;
}

function questionMatches(question, filters) {
  if (filters.module && question.moduleId !== filters.module) return false;
  if (filters.year && String(question.year) !== String(filters.year)) return false;
  if (filters.competency && String(question.competency) !== String(filters.competency)) return false;
  const score = difficultyScore(question);
  if (filters.difficulty === "known" && score === null) return false;
  if (filters.difficulty === "unknown" && score !== null) return false;
  if (filters.difficulty === "low" && (score === null || score > 500)) return false;
  if (filters.difficulty === "medium" && (score === null || score <= 500 || score > 650)) return false;
  if (filters.difficulty === "high" && (score === null || score <= 650)) return false;
  if (filters.status === "unanswered" && state.answered.includes(question.id)) return false;
  if (filters.status === "answered" && !state.answered.includes(question.id)) return false;
  if (filters.status === "wrong" && !state.missed.includes(question.id)) return false;
  if (filters.status === "favorites" && !state.favorites.includes(question.id)) return false;
  const query = String(filters.query || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  if (query) {
    const haystack = [question.id, question.context, question.alternativesIntroduction, question.moduleTitle, ...question.alternatives.map(a => a.text)].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!query.split(/\s+/).every(word => haystack.includes(word))) return false;
  }
  return true;
}

function filteredPracticeQuestions(filters = practiceFilters()) {
  return data.questions.filter(q => questionMatches(q, filters));
}

function filterOptions(values, selected, allLabel) {
  return `<option value="">${allLabel}</option>${values.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function renderPractice() {
  const filters = practiceFilters();
  const pool = filteredPracticeQuestions(filters);
  const withTri = pool.filter(q => difficultyScore(q) !== null).length;
  const years = [...new Set(data.questions.map(q => q.year))].sort((a, b) => b - a);
  const competencies = [...new Set(data.questions.map(q => q.competency))].sort((a, b) => a - b);
  const metrics = performanceMetrics(courseAttempts());
  app.innerHTML = `
    ${pageHeader("Banco de questões", "Seu treino, seu ritmo.", "Escolha os filtros e resolva questões aleatórias, uma de cada vez. Veja a resolução após responder e continue pelo tempo que quiser.")}
    <div class="practice-overview"><span><strong>${metrics.total}</strong> respostas registradas</span><span><strong>${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}</strong> de acerto</span><a href="#desempenho" data-view="desempenho">Ver desempenho ↗</a></div>
    <form id="practice-filters" class="filter-card">
      <div class="section-heading"><div><p class="page-kicker">Monte sua seleção</p><h2>Filtros de questões</h2></div><button type="button" class="text-button" data-action="reset-filters">Limpar filtros</button></div>
      <div class="filter-grid">
        <label>Assunto<select name="module">${filterOptions(data.modules.map(m => [m.id, m.title]), filters.module, "Todos os assuntos")}</select></label>
        <label>Ano<select name="year">${filterOptions(years.map(y => [y, y]), filters.year, "Todos os anos")}</select></label>
        <label>Competência<select name="competency">${filterOptions(competencies.map(c => [c, `Competência ${c}`]), filters.competency, "Todas as competências")}</select></label>
        <label>Dificuldade TRI<select name="difficulty">${filterOptions([["known", "Com dificuldade oficial"], ["low", "Até 500"], ["medium", "Acima de 500 até 650"], ["high", "Acima de 650"], ["unknown", "Sem parâmetro disponível"]], filters.difficulty, "Todas as dificuldades")}</select></label>
        <label>Minha resolução<select name="status">${[["all", "Todas as questões"], ["unanswered", "Ainda não respondi"], ["wrong", "Erros para revisar"], ["answered", "Já respondi"], ["favorites", "Favoritas"]].map(([value, label]) => `<option value="${value}" ${value === filters.status ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label>Palavra-chave ou código<input name="query" type="search" maxlength="120" value="${escapeHtml(filters.query)}" placeholder="Ex.: energia, célula, 2022-142"></label>
      </div>
      <button class="button secondary" type="submit">Aplicar filtros</button>
      <p class="filter-help">A matéria é escolhida no seletor acima. Quanto maior a dificuldade TRI, mais difícil o item. Os intervalos numéricos são filtros do Fisio, sem classificação oficial em fácil, médio ou difícil. A ausência de parâmetro não significa dificuldade baixa.</p>
    </form>
    <section class="practice-launch" aria-live="polite"><div><p class="page-kicker">Seleção atual</p><h2>${pool.length} ${pool.length === 1 ? "questão encontrada" : "questões encontradas"}</h2><p>${pool.length ? `${withTri} com dificuldade oficial vinculada. Sorteio sem repetição até percorrer a seleção.` : "Nenhuma questão corresponde a estes filtros. Amplie o ano, o assunto ou a situação de resolução."}</p></div><button class="button" data-action="practice" ${pool.length ? "" : "disabled"}>Iniciar prática contínua <span aria-hidden="true">→</span></button></section>
    <div class="notice">As respostas são salvas a cada correção. Você pode pular uma questão ou encerrar quando quiser; a prática não consome corações.</div>
  `;
}

function courseAttempts(period = "all", mode = "all") {
  const ids = new Set(data.questionIds);
  const earliest = period === "all" ? "" : new Date(new Date(`${localDay()}T12:00:00Z`).getTime() - (Number(period) - 1) * 86400000).toISOString().slice(0, 10);
  return state.attempts.filter(a => ids.has(a.questionId) && (mode === "all" || a.mode === mode) && (!earliest || a.day >= earliest));
}

function performanceMetrics(attempts) {
  const correct = attempts.filter(a => a.correct).length;
  const duration = attempts.reduce((sum, a) => sum + (Number.isFinite(a.durationMs) ? a.durationMs : 0), 0);
  return { total: attempts.length, correct, wrong: attempts.length - correct, unique: new Set(attempts.map(a => a.questionId)).size, accuracy: attempts.length ? Math.round(correct / attempts.length * 100) : null, duration, average: attempts.length ? duration / attempts.length : 0 };
}

function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min`;
}

function counted(value, singular, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function renderPerformance() {
  const attempts = courseAttempts(statsPeriod, statsMode);
  const metrics = performanceMetrics(attempts);
  const questionById = new Map(data.questions.map(q => [q.id, q]));
  const rows = data.modules.map(module => ({ module, ...performanceMetrics(attempts.filter(a => questionById.get(a.questionId)?.moduleId === module.id)) }));
  const days = Array.from({ length: 7 }, (_, index) => new Date(new Date(`${localDay()}T12:00:00Z`).getTime() - (6 - index) * 86400000).toISOString().slice(0, 10));
  const daily = days.map(day => ({ day, ...performanceMetrics(attempts.filter(a => a.day === day)) }));
  const max = Math.max(1, ...daily.map(d => d.total));
  app.innerHTML = `
    ${pageHeader("Estatísticas", "Veja sua evolução.", "Acompanhe suas respostas e descubra os assuntos que merecem mais atenção.")}
    <div class="stats-controls"><label>Período<select id="stats-period">${[["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["all", "Todo o histórico"]].map(([v, l]) => `<option value="${v}" ${statsPeriod === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Modo<select id="stats-mode">${[["all", "Todos os modos"], ["practice", "Prática"], ["lesson", "Lições"]].map(([v, l]) => `<option value="${v}" ${statsMode === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    ${storageWarning ? '<div class="notice">O navegador não conseguiu salvar o histórico. Os dados desta sessão estão apenas na memória; libere espaço para preservá-los.</div>' : ""}
    <div class="metric-grid">
      ${[[metrics.total, "Respostas", `${metrics.unique} ${metrics.unique === 1 ? "questão distinta" : "questões distintas"}`], [`${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}`, "Taxa de acerto", `${counted(metrics.correct, "acerto")} · ${counted(metrics.wrong, "erro")}`], [formatDuration(metrics.duration), "Tempo respondendo", `${formatDuration(metrics.average)} por resposta`], [data.questions.filter(q => state.missed.includes(q.id)).length, "Erros para revisar", "Situação atual da matéria"]].map(([n, title, detail]) => `<article class="metric-card"><strong>${n}</strong><h2>${title}</h2><p>${detail}</p></article>`).join("")}
    </div>
    ${!metrics.total ? '<div class="empty-state"><span aria-hidden="true">↗</span><h2>Seu próximo treino começa este gráfico.</h2><p>Responda uma questão na prática ou nas lições. O resultado aparece aqui assim que você verifica a resposta.</p><a class="button" href="#praticar" data-view="praticar">Escolher questões</a></div>' : ""}
    <section class="stats-card"><div class="section-heading"><h2>Ritmo nos últimos 7 dias</h2><span class="chart-legend"><i></i> Acertos <i class="wrong"></i> Erros</span></div><div class="activity-chart">${daily.map(d => `<div class="day-column"><span>${d.total}</span><div class="day-track" role="img" aria-label="${d.day}: ${counted(d.correct, "acerto")} e ${counted(d.wrong, "erro")}"><div class="day-wrong" style="height:${d.wrong / max * 100}%"></div><div class="day-correct" style="height:${d.correct / max * 100}%"></div></div><small>${d.day.slice(8)}/${d.day.slice(5, 7)}</small></div>`).join("")}</div></section>
    <section class="stats-card"><div class="section-heading"><h2>Desempenho por assunto</h2><span class="tiny">Cada tentativa conta</span></div><div class="performance-list">${rows.map(row => `<div class="performance-row"><div><strong>${escapeHtml(row.module.title)}</strong><small>${counted(row.total, "resposta")} · ${counted(row.correct, "acerto")} · ${counted(row.wrong, "erro")}</small></div><div class="performance-result"><strong>${row.accuracy === null ? "—" : `${row.accuracy}%`}</strong><div class="progress-track"><div class="progress-fill" style="width:${row.accuracy || 0}%"></div></div></div></div>`).join("")}</div></section>
    ${attempts.length ? `<section class="stats-card"><h2>Respostas recentes</h2><div class="recent-list">${attempts.slice(-10).reverse().map(a => { const q = questionById.get(a.questionId); return `<div class="recent-row"><span class="result-icon ${a.correct ? "" : "wrong"}">${a.correct ? "✓" : "×"}</span><div><strong>ENEM ${q.year} · Questão ${q.index}</strong><small>${escapeHtml(q.moduleTitle)} · ${a.mode === "practice" ? "Prática" : "Lição"} · ${a.day.split("-").reverse().join("/")}</small></div><span>${formatDuration(a.durationMs || 0)}</span></div>`; }).join("")}</div></section>` : ""}
    <p class="stats-note">Histórico salvo neste navegador, sem sincronização entre dispositivos. Os resultados detalhados começam com esta atualização.${state.legacyAnsweredCount ? ` As ${state.legacyAnsweredCount} respostas anteriores permanecem no progresso, mas não entram nas taxas por não terem acerto e tempo registrados.` : ""} O tempo mede apenas a questão aberta e visível, até a correção; leitura da resolução e questões puladas não entram.</p>
  `;
}

function triMarkup(question) {
  const score = difficultyScore(question);
  if (score === null) return `<div class="tri-badge unavailable">Dificuldade TRI: indisponível${question.triUnavailable?.reason === "official_item_abandoned" ? " · item excluído da calibração oficial" : " para este item na base vinculada"}</div>`;
  return `<details class="tri-details"><summary>Dificuldade TRI <strong>${score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong> <span>INEP · ${question.year}</span></summary><p>Quanto maior o valor, maior a dificuldade do item. Este valor não representa pontos ganhos ao acertar nem uma previsão de nota.</p><p>b original (escala 0,1): ${escapeHtml(question.tri.b)}. Conversão para a escala do ENEM: 500 + 100 × b. Item ${escapeHtml(question.tri.itemCode)} · Prova ${escapeHtml(question.tri.examCode)}.</p><a class="source-link" href="${escapeHtml(question.tri.sourceUrl)}" target="_blank" rel="noreferrer">Consultar parâmetros oficiais ↗</a> · <a class="source-link" href="${escapeHtml(catalog.tri.scale.methodologyUrl)}" target="_blank" rel="noreferrer">Metodologia do INEP ↗</a></details>`;
}

function markStudyDay() {
  const today = localDay();
  if (state.lastStudyDay === today) return;
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  state.streak = state.lastStudyDay === yesterday ? state.streak + 1 : 1;
  state.lastStudyDay = today;
}

function stopQuestionTimer() {
  if (!quiz || quiz.checked || quiz.timerStartedAt === null) return;
  quiz.elapsedMs += Math.max(0, Date.now() - quiz.timerStartedAt);
  quiz.timerStartedAt = null;
}

function startQuestionTimer() {
  if (quiz && !quiz.checked && !quiz.ended && !document.hidden && quiz.timerStartedAt === null) quiz.timerStartedAt = Date.now();
}

function resetQuestionTimer() {
  quiz.elapsedMs = 0;
  quiz.timerStartedAt = null;
  startQuestionTimer();
}

function recordAttempt(question, correct) {
  const at = new Date().toISOString();
  state.attempts.push({ questionId: question.id, answer: quiz.selected, correct, at, day: localDay(), durationMs: Math.round(quiz.elapsedMs), mode: quiz.practice ? "practice" : "lesson", courseId: data.id });
  markStudyDay();
}

function drawPracticeQuestion() {
  const byId = new Map(data.questions.map(q => [q.id, q]));
  const previous = quiz.questions[quiz.index]?.id;
  while (quiz.queue.length) {
    const question = byId.get(quiz.queue.shift());
    if (question && questionMatches(question, quiz.filters)) return question;
  }
  const eligible = filteredPracticeQuestions(quiz.filters);
  if (!eligible.length) return null;
  quiz.cycle += 1;
  quiz.queue = shuffle(eligible).map(q => q.id);
  if (quiz.queue.length > 1 && quiz.queue[0] === previous) [quiz.queue[0], quiz.queue[1]] = [quiz.queue[1], quiz.queue[0]];
  showToast("Seleção percorrida. Começando uma nova rodada aleatória.");
  return byId.get(quiz.queue.shift());
}

function endPractice(exhausted = false) {
  if (!quiz?.practice) return;
  stopQuestionTimer();
  const answered = quiz.answeredCount;
  const accuracy = answered ? Math.round(quiz.correct / answered * 100) : null;
  quiz.ended = true;
  modal.innerHTML = `<div class="quiz-shell"><div class="finish-card"><div class="finish-burst">${exhausted ? "✓" : "↗"}</div><h1 tabindex="-1">${exhausted ? "Seleção concluída!" : "Prática encerrada"}</h1><p>${exhausted ? "Não restam questões que atendam aos filtros atuais. Ajuste sua seleção para continuar." : "Cada resposta corrigida já está salva no seu desempenho."}</p><div class="finish-stats"><div class="finish-stat"><strong>${answered}</strong><span>Respondidas</span></div><div class="finish-stat"><strong>${accuracy === null ? "—" : `${accuracy}%`}</strong><span>Acerto</span></div><div class="finish-stat"><strong>${quiz.skipped}</strong><span>Puladas</span></div></div><p>${counted(quiz.correct, "acerto")} · ${counted(answered - quiz.correct, "erro")} · ${formatDuration(quiz.totalDurationMs)} respondendo</p><div class="finish-actions"><button class="button" data-action="finish">Voltar aos filtros</button><button class="button secondary" data-action="view-performance">Ver desempenho</button></div></div></div>`;
  modal.querySelector("h1").focus();
}

function skipPracticeQuestion() {
  if (!quiz?.practice || quiz.checked || quiz.ended) return;
  quiz.skipped += 1;
  advancePractice();
}

function advancePractice() {
  const question = drawPracticeQuestion();
  if (!question) { endPractice(true); return; }
  quiz.questions.push(question);
  quiz.index += 1;
  quiz.selected = null;
  quiz.checked = false;
  resetQuestionTimer();
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "smooth" });
}

function renderAchievements() {
  const achievements = [
    ["🚀", "Primeira órbita", "Conclua sua primeira lição.", state.completed.length >= 1],
    ["🔥", "Em chamas", "Mantenha uma sequência de 3 dias.", state.streak >= 3],
    ["⚡", "Alta tensão", "Acumule 200 XP.", state.xp >= 200],
    ["🎯", "Precisão", "Responda 20 questões.", state.answered.length >= 20],
    ["🏅", "Meio caminho", `Conclua metade da trilha de ${data.title}.`, completedLessons() >= Math.ceil(lessons.length / 2)],
    ["🧠", `Domínio de ${data.title}`, "Conclua toda a trilha selecionada.", completedLessons() >= lessons.length],
  ];
  app.innerHTML = `
    ${pageHeader("Seu progresso", "Conquistas", "Cada marco registra a constância que você está construindo.")}
    <div class="achievement-grid">
      ${achievements.map(([icon, title, description, unlocked]) => `
        <article class="badge-card ${unlocked ? "" : "locked"}">
          <div class="badge-icon">${icon}</div>
          <div><h3>${title}</h3><p>${unlocked ? "Conquista desbloqueada!" : description}</p></div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderAbout() {
  app.innerHTML = `
    ${pageHeader("Projeto aberto", "Sobre o Fisio", "Uma experiência gamificada, com identidade própria, para transformar provas anteriores em prática diária.")}
    <div class="about-grid">
      <article class="info-card"><div class="big-number">2.757</div><h3>questões locais</h3><p>O snapshot completo das edições de 2009 a 2023 está incluído no ambiente do projeto.</p></article>
      <article class="info-card"><div class="big-number">${catalog.total}</div><h3>questões comentadas únicas</h3><p>Seleção revisada com resoluções próprias. Natureza reúne Física, Química e Biologia; suas questões são contadas uma única vez neste total.</p></article>
      <article class="info-card"><div class="big-number">15</div><h3>anos de prova</h3><p>As questões mantêm o ano, o número, o enunciado, as alternativas e o gabarito original.</p></article>
      <article class="info-card"><div class="big-number">100%</div><h3>progresso local</h3><p>XP, sequência, corações e lições concluídas ficam salvos apenas neste navegador.</p></article>
    </div>
    <div class="notice"><strong>Áreas e competências:</strong> Matemática e Ciências da Natureza seguem a organização da <a class="source-link" href="${catalog.matrix.source}" target="_blank" rel="noreferrer">matriz de referência do INEP</a>. Os títulos didáticos, introduções e vínculos entre questões e habilidades são editoriais. A seleção atual não contém exercícios de todas as habilidades. <a class="source-link" href="/data/enem-matriz-de-referencia.pdf" download>Baixar matriz local (PDF)</a>.</div>
    <div class="notice"><strong>Acervo integral preservado:</strong> os ${catalog.rawTotal.toLocaleString("pt-BR")} registros da API permanecem disponíveis no <a class="source-link" href="/data/all-questions.json" download>snapshot completo em JSON</a>. A prática utiliza somente itens selecionados e comentados; itens incompletos ou inconsistentes ficam fora dela.</div>
    <div class="notice"><strong>Dificuldade TRI oficial:</strong> ${catalog.tri.matched} das ${catalog.total} questões comentadas têm parâmetros vinculados aos <a class="source-link" href="${escapeHtml(catalog.tri.sourceIndexUrl)}" target="_blank" rel="noreferrer">arquivos de itens do INEP, de 2009 a 2023</a>. A API de questões não fornece esses parâmetros. O vínculo confere ano, caderno, numeração e gabarito. Itens sem parâmetro válido são identificados como indisponíveis. A dificuldade exibida usa 500 + 100 × b; não é uma previsão da nota do aluno.</div>
    <div class="notice"><strong>Fonte:</strong> <a class="source-link" href="https://enem.dev" target="_blank" rel="noreferrer">enem.dev</a>, projeto comunitário sem vínculo com INEP ou MEC. O código da API de origem é GPL-2.0. As introduções e resoluções são conteúdo didático próprio do Fisio, não comentários oficiais do INEP. O Fisio não é afiliado ao Duolingo.</div>
  `;
}

function renderPage(resetScroll = true) {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === activeView);
  });
  if (activeView === "praticar") renderPractice();
  else if (activeView === "desempenho") renderPerformance();
  else if (activeView === "conquistas") renderAchievements();
  else if (activeView === "sobre") renderAbout();
  else renderLearn();
  renderRail();
  if (resetScroll) window.scrollTo({ top: 0, behavior: "smooth" });
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function openModal(label) {
  returnFocus = document.activeElement;
  modal.setAttribute("aria-label", label);
  modal.hidden = false;
  shell.inert = true;
  document.body.style.overflow = "hidden";
  modal.scrollTop = 0;
}

function openIntroduction(moduleId) {
  const module = data.modules.find((item) => item.id === moduleId);
  if (!module) return;
  const intro = module.introduction;
  introModuleId = moduleId;
  const [color, dark] = modulePalette[moduleId] || module.color || modulePalette.mecanica;
  openModal(`Introdução conceitual de ${module.title}`);
  modal.innerHTML = `
    <div class="intro-shell" style="--unit-color:${color};--unit-dark:${dark}">
      <header class="intro-topbar"><span>${module.emoji} ${module.title} · ${intro.duration}</span><button class="icon-button" data-action="close-intro" aria-label="Fechar introdução">×</button></header>
      <article class="intro-content">
        <p class="page-kicker">Introdução conceitual</p>
        <h1 class="page-title" tabindex="-1">${escapeHtml(intro.title)}</h1>
        <p class="page-subtitle">${escapeHtml(intro.summary)}</p>
        ${referenceMarkup(module)}
        ${intro.sections.map((section, index) => `<section class="concept-section"><span class="concept-number">0${index + 1}</span><div><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.text)}</p><div class="formula">${escapeHtml(section.formula)}</div><p class="notation">${escapeHtml(section.notation)}</p></div></section>`).join("")}
        <section class="worked-example"><p class="page-kicker">Aplicando a ideia</p><h2>${escapeHtml(intro.example.title)}</h2><ol>${intro.example.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></section>
        <div class="notice"><strong>Evite esta confusão</strong><br>${escapeHtml(intro.pitfall)}</div>
        <div class="intro-actions"><button class="button" data-action="complete-intro">${state.introductionsRead.includes(moduleId) ? "Voltar à unidade" : "Concluir introdução"}</button></div>
      </article>
    </div>`;
  modal.querySelector("h1").focus();
}

function completeIntroduction() {
  if (!state.introductionsRead.includes(introModuleId)) {
    state.introductionsRead.push(introModuleId);
    saveState();
  }
  closeQuiz();
}

function startLesson(lessonId, customQuestions) {
  const lesson = lessons.find((item) => item.id === lessonId) || {
    id: `practice-${Date.now()}`,
    title: "Prática personalizada",
    module: { title: "Revisão", id: "mecanica" },
    questions: customQuestions,
  };
  quiz = {
    lesson,
    questions: customQuestions || lesson.questions,
    index: 0,
    selected: null,
    checked: false,
    correct: 0,
    practice: false,
  };
  if (!quiz.questions?.length) { quiz = null; return; }
  resetQuestionTimer();
  openModal(lesson.title);
  renderQuestion();
  modal.querySelector("h1").focus();
}

function startPractice() {
  const filters = practiceFilters();
  const pool = shuffle(filteredPracticeQuestions(filters));
  if (!pool.length) { showToast("Nenhuma questão corresponde aos filtros. Ajuste sua seleção."); return; }
  quiz = {
    practice: true, filters: { ...filters }, queue: pool.slice(1).map(q => q.id), cycle: 1,
    lesson: { title: "Prática contínua", module: { title: data.title } },
    questions: [pool[0]], index: 0, selected: null, checked: false, correct: 0,
    answeredCount: 0, skipped: 0, totalDurationMs: 0,
  };
  resetQuestionTimer();
  openModal("Prática contínua");
  renderQuestion();
  modal.querySelector("h1").focus();
}

function renderQuestion() {
  const question = quiz.questions[quiz.index];
  const progress = ((quiz.index + (quiz.checked ? 1 : 0)) / quiz.questions.length) * 100;
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="quiz-topbar">
        ${quiz.practice ? `<button class="text-button" data-action="end-practice">Encerrar prática</button><span class="session-counter">${counted(quiz.answeredCount, "respondida")} · ${counted(quiz.correct, "acerto")}</span><span class="session-round">Rodada ${quiz.cycle}</span>` : `<button class="icon-button" data-action="close-quiz" aria-label="Fechar lição">×</button><div class="quiz-progress" aria-label="Progresso da lição"><span style="width:${progress}%"></span></div><div class="quiz-hearts">♥ ${state.hearts}</div>`}
      </div>
      <div class="question-wrap">
        <div class="question-meta"><span>${escapeHtml(question.subjectTitle || data.title)} · ${escapeHtml(question.moduleTitle || quiz.lesson.module.title)}</span><span>ENEM ${question.year} · Questão ${question.index}</span></div>
        <div class="question-tools">${triMarkup(question)}<button class="text-button favorite-button" data-action="favorite" aria-pressed="${state.favorites.includes(question.id)}">${state.favorites.includes(question.id) ? "★ Favorita" : "☆ Favoritar"}</button></div>
        ${question.skill ? `<div class="question-skill"><strong>${question.areaId === "matematica" ? "MT" : "CN"} · C${question.competency} · H${question.skill}</strong><span>${escapeHtml(catalog.matrix.areas[question.areaId].competencies.find(c => c.number === question.competency).skills.find(s => s.number === question.skill).description)}</span><small>Associação editorial à matriz do INEP</small></div>` : ""}
        <h1 tabindex="-1">${escapeHtml(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1>
        ${question.context ? `<div class="question-context">${renderMarkdown(question.context)}</div>` : ""}
        <div class="answers">
          ${question.alternatives.map((alternative) => {
            let status = quiz.selected === alternative.letter ? "selected" : "";
            if (quiz.checked && alternative.letter === question.correctAlternative) status = "correct";
            else if (quiz.checked && quiz.selected === alternative.letter) status = "wrong";
            const body = alternative.file
              ? `<img src="${escapeHtml(alternative.file)}" alt="Alternativa ${alternative.letter}" style="max-width:100%;max-height:180px">`
              : escapeHtml(alternative.text || "Alternativa com imagem");
            return `<button class="answer ${status}" data-answer="${alternative.letter}" ${quiz.checked ? "disabled" : ""}><span class="answer-letter">${alternative.letter}</span><span class="answer-text">${body}</span></button>`;
          }).join("")}
        </div>
        ${quiz.checked ? renderExplanation(question) : ""}
      </div>
      ${renderQuizFooter(question)}
    </div>
  `;
}

function renderExplanation(question) {
  const explanation = question.explanation;
  const correctAnswer = question.alternatives.find((alternative) => alternative.letter === question.correctAlternative);
  return `<section class="explanation" aria-labelledby="explanation-title" tabindex="-1">
    <p class="page-kicker">${escapeHtml(explanation.concept)}</p>
    <h2 id="explanation-title">Por que a alternativa ${escapeHtml(question.correctAlternative)} está correta?</h2>
    <div class="correct-answer"><strong>Alternativa ${escapeHtml(question.correctAlternative)}</strong>${correctAnswer.text ? `<p>${escapeHtml(correctAnswer.text)}</p>` : ""}${correctAnswer.file ? `<img src="${escapeHtml(correctAnswer.file)}" alt="Resposta correta, alternativa ${question.correctAlternative}">` : ""}</div>
    <ol>${explanation.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol>
    <p class="takeaway"><strong>Guarde esta ideia:</strong> ${escapeHtml(explanation.takeaway)}</p>
  </section>`;
}

function renderQuizFooter(question) {
  if (!quiz.checked) {
    return `<footer class="quiz-footer"><div class="quiz-footer-inner">${quiz.practice ? '<button class="text-button" data-action="skip-question">Pular questão</button>' : ""}<button class="button" data-action="check" ${quiz.selected ? "" : "disabled"}>Verificar</button></div></footer>`;
  }
  const correct = quiz.selected === question.correctAlternative;
  return `
    <footer class="quiz-footer ${correct ? "success" : "error"}">
      <div class="quiz-footer-inner">
        <div class="feedback-copy" role="status"><strong>${correct ? "Mandou bem! +10 XP" : `Resposta correta: ${question.correctAlternative}`}</strong><span>Confira a resolução comentada antes de continuar.</span></div>
        <button class="button ${correct ? "" : "danger"}" data-action="next-question">${quiz.practice ? "Próxima questão" : quiz.index === quiz.questions.length - 1 ? "Finalizar" : "Continuar"}</button>
      </div>
    </footer>
  `;
}

function selectAnswer(letter) {
  if (!quiz || quiz.checked || quiz.ended) return;
  quiz.selected = letter;
  renderQuestion();
}

function checkAnswer() {
  if (!quiz?.selected || quiz.checked || quiz.ended) return;
  const question = quiz.questions[quiz.index];
  const correct = quiz.selected === question.correctAlternative;
  stopQuestionTimer();
  recordAttempt(question, correct);
  quiz.checked = true;
  if (quiz.practice) { quiz.answeredCount += 1; quiz.totalDurationMs += quiz.elapsedMs; }
  state.answered.push(question.id);
  if (correct) {
    quiz.correct += 1;
    state.xp += 10;
    state.todayXp += 10;
    state.missed = state.missed.filter((id) => id !== question.id);
  } else {
    if (!quiz.practice) state.hearts = Math.max(0, state.hearts - 1);
    if (!state.missed.includes(question.id)) state.missed.push(question.id);
  }
  saveState();
  renderQuestion();
  const explanation = modal.querySelector(".explanation");
  explanation.focus({ preventScroll: true });
  explanation.scrollIntoView({ block: "start", behavior: "smooth" });
}

function nextQuestion() {
  if (!quiz?.checked || quiz.ended) return;
  if (quiz.practice) { advancePractice(); return; }
  if (quiz.index < quiz.questions.length - 1) {
    quiz.index += 1;
    quiz.selected = null;
    quiz.checked = false;
    resetQuestionTimer();
    renderQuestion();
    modal.querySelector("h1").focus({ preventScroll: true });
    modal.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  finishLesson();
}

function finishLesson() {
  if (!quiz || quiz.ended) return;
  quiz.ended = true;
  const lesson = quiz.lesson;
  const isCourseLesson = lessons.some((item) => item.id === lesson.id);
  const earnedBonus = isCourseLesson && !state.completed.includes(lesson.id);
  if (earnedBonus) {
    state.completed.push(lesson.id);
    state.xp += 20;
    state.todayXp += 20;
  }
  markStudyDay();
  const accuracy = Math.round((quiz.correct / quiz.questions.length) * 100);
  saveState();
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="finish-card">
        <div class="finish-burst">${accuracy >= 80 ? "🏆" : "⚛️"}</div>
        <h1>Lição concluída!</h1>
        <p>${accuracy >= 80 ? "Excelente domínio desta rodada." : "Boa prática. Seus erros já entraram na revisão."}</p>
        <div class="finish-stats">
          <div class="finish-stat"><strong>${accuracy}%</strong><span>Precisão</span></div>
          <div class="finish-stat"><strong>+${quiz.correct * 10 + (earnedBonus ? 20 : 0)}</strong><span>XP ganho</span></div>
        </div>
        <button class="button" data-action="finish">Voltar à trilha</button>
      </div>
    </div>
  `;
}

function closeQuiz() {
  modal.hidden = true;
  modal.innerHTML = "";
  document.body.style.overflow = "";
  shell.inert = false;
  quiz = null;
  introModuleId = null;
  const introId = returnFocus?.dataset?.intro;
  renderPage(!introId);
  const focusTarget = introId ? app.querySelector(`[data-intro="${introId}"]`) : app.querySelector("h1");
  if (focusTarget) { focusTarget.tabIndex = focusTarget.matches("button") ? 0 : -1; focusTarget.focus({ preventScroll: true }); }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

document.addEventListener("click", (event) => {
  const view = event.target.closest("[data-view]");
  if (view) {
    event.preventDefault();
    activeView = view.dataset.view;
    history.replaceState(null, "", `#${activeView}`);
    renderPage();
    return;
  }
  const lessonButton = event.target.closest("[data-lesson]");
  if (lessonButton) startLesson(lessonButton.dataset.lesson);
  const introButton = event.target.closest("[data-intro]");
  if (introButton) openIntroduction(introButton.dataset.intro);
  const answer = event.target.closest("[data-answer]");
  if (answer) selectAnswer(answer.dataset.answer);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "continue") startLesson(nextLesson().id);
  if (action === "practice") startPractice();
  if (action === "reset-filters") { state.practiceFilters[data.id] = defaultPracticeFilters(); saveState(); renderPractice(); }
  if (action === "end-practice") endPractice();
  if (action === "skip-question") skipPracticeQuestion();
  if (action === "view-performance") { activeView = "desempenho"; history.replaceState(null, "", "#desempenho"); closeQuiz(); }
  if (action === "favorite" && quiz && !quiz.ended) {
    const id = quiz.questions[quiz.index].id;
    state.favorites = state.favorites.includes(id) ? state.favorites.filter(item => item !== id) : [...state.favorites, id];
    saveState(); renderQuestion(); modal.querySelector('[data-action="favorite"]').focus({ preventScroll: true });
  }
  if (action === "close-intro") closeQuiz();
  if (action === "complete-intro") completeIntroduction();
  if (action === "close-quiz") {
    closeQuiz();
    showToast("Respostas salvas. Conclua a lição para avançar na trilha.");
  }
  if (action === "check") checkAnswer();
  if (action === "next-question") nextQuestion();
  if (action === "finish") closeQuiz();
});

document.addEventListener("keydown", (event) => {
  if (modal.hidden) return;
  if (event.key === "Escape") { if (quiz?.practice && !quiz.ended) endPractice(); else closeQuiz(); return; }
  if (event.key !== "Tab") return;
  const focusable = [...modal.querySelectorAll('button:not(:disabled), a[href], summary, [tabindex="0"]')];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
    event.preventDefault(); last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first?.focus();
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "stats-period") { statsPeriod = event.target.value; renderPerformance(); app.querySelector("#stats-period").focus({ preventScroll: true }); return; }
  if (event.target.id === "stats-mode") { statsMode = event.target.value; renderPerformance(); app.querySelector("#stats-mode").focus({ preventScroll: true }); return; }
  if (event.target.id === "unit-select") {
    const unit = app.querySelector(`#unit-${event.target.value}`);
    if (unit) { unit.scrollIntoView({ block: "start", behavior: "smooth" }); unit.querySelector("h2").focus({ preventScroll: true }); }
    return;
  }
  if (event.target.id !== "course-select") return;
  setCourse(event.target.value);
  if (!["praticar", "desempenho"].includes(activeView)) activeView = "aprender";
  history.replaceState(null, "", `#${activeView}`);
  renderPage();
  app.querySelector("#course-select").focus({ preventScroll: true });
});

document.addEventListener("submit", (event) => {
  if (event.target.id !== "practice-filters") return;
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.target));
  state.practiceFilters[data.id] = { ...defaultPracticeFilters(), ...values };
  saveState(); renderPractice();
  app.querySelector(".practice-launch").scrollIntoView({ block: "nearest", behavior: "smooth" });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopQuestionTimer(); else startQuestionTimer();
});

window.addEventListener("hashchange", () => {
  activeView = location.hash.slice(1) || "aprender";
  renderPage();
});

async function init() {
  app.innerHTML = `<div class="loading"><div><div class="loader"></div>Carregando sua trilha…</div></div>`;
  try {
    const response = await fetch(DATA_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error("Não foi possível carregar as matérias.");
    catalog = await response.json();
    state.missed = state.missed.filter((id) => catalog.questions.some((question) => question.id === id));
    setCourse(state.activeCourse);
    renderPage();
  } catch (error) {
    app.innerHTML = `<div class="notice" style="margin-top:40px"><strong>Falha ao iniciar.</strong><br>${escapeHtml(error.message)} Recarregue a página ou verifique se o site está sendo servido por HTTP.</div>`;
  }
}

init();
