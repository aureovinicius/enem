import { buildPracticeReport } from "./practice-session.js?v=pwa-15-comments-04";

const DATA_URL = "/data/courses.json?v=pwa-15-comments-04";
const STORAGE_KEY = "fisio-progress-v1";
const DAILY_GOAL = 50;
const MAX_LESSON_ERRORS = 3;

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
let practiceTick = null;
let sessionReport = null;
let sessionBreakdown = "topic";

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
    completed: [],
    introductionsRead: [],
    answered: [],
    missed: [],
    activeCourse: "fisica",
    attempts: [],
    favorites: [],
    practiceFilters: {},
    studyUnits: {},
    statsSince: new Date().toISOString(),
    legacyAnsweredCount: 0,
    practiceSessions: [],
    pendingPractice: null,
  };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    delete saved.hearts; // Attempts now have their own error limit; keep all study progress.
    for (const key of ["completed", "introductionsRead", "answered", "missed", "favorites"]) {
      saved[key] = Array.isArray(saved[key]) ? saved[key].filter(x => typeof x === "string") : [];
    }
    if (!saved.studyUnits || typeof saved.studyUnits !== "object" || Array.isArray(saved.studyUnits)) saved.studyUnits = {};
    saved.attempts = Array.isArray(saved.attempts) ? saved.attempts.filter(a => a && typeof a.questionId === "string" && typeof a.correct === "boolean" && Number.isFinite(Date.parse(a.at))) : [];
    saved.practiceSessions = Array.isArray(saved.practiceSessions) ? saved.practiceSessions.filter(validPracticeSession).slice(-20) : [];
    if (!saved.pendingPractice || !validPracticeSession(saved.pendingPractice.session)) saved.pendingPractice = null;
    if (!saved.attempts.length && !saved.legacyAnsweredCount) saved.legacyAnsweredCount = saved.answered.length;
    if (!saved.practiceFilters || typeof saved.practiceFilters !== "object" || Array.isArray(saved.practiceFilters)) saved.practiceFilters = {};
    if (saved.dailyDay !== localDay()) {
      saved.todayXp = 0;
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

function renderMathText(value = "", formatPlain = escapeHtml) {
  const source = String(value);
  const expressions = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
  let html = "";
  let end = 0;
  for (const match of source.matchAll(expressions)) {
    html += formatPlain(source.slice(end, match.index));
    const display = match[2] !== undefined;
    const tex = match[1] ?? match[2];
    try {
      const math = window.katex.renderToString(tex, {
        displayMode: display, output: "htmlAndMathml", throwOnError: true,
        trust: false, strict: "ignore", maxExpand: 1000, maxSize: 12,
      });
      html += `<span class="math-${display ? "display" : "inline"}">${math}</span>`;
    } catch {
      // Keep content readable if a formula or the optional renderer is unavailable.
      html += `<code class="math-fallback">${escapeHtml(tex)}</code>`;
    }
    end = match.index + match[0].length;
  }
  return html + formatPlain(source.slice(end));
}

function renderPlainMarkdown(value) {
  const escaped = escapeHtml(value).replace(/\\([\[\]])/g, "$1");
  const withImages = escaped.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+(?:&quot;[\s\S]*?&quot;|&#039;[\s\S]*?&#039;))?\)/g, (_, alt, url) => {
    const safeUrl = url.startsWith("/assets/questions/") || url.startsWith("https://enem.dev/")
      ? url
      : "";
    return safeUrl ? `<img src="${safeUrl}" alt="${alt || "Imagem da questão"}" loading="lazy">` : "";
  });
  return withImages
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n\n+/g, "</p><p>")
    .replace(/\n/g, "<br>");
}

function renderMarkdown(value = "", proseOnly = false) {
  // The question source escapes quotation omissions as Markdown brackets.
  const prose = proseOnly ? String(value).replace(/\\([\[\]])/g, "$1") : String(value).replace(/\\\[\s*(…|\.{3})\s*\\\]/g, "[$1]");
  return `<p>${renderMathText(prose, renderPlainMarkdown)}</p>`;
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
  return state.completed.includes(lesson.id) || lesson.index === 0 || state.completed.includes(lessons[lesson.globalIndex - 1]?.id);
}

function allCatalogQuestions() {
  return [...catalog.questions, ...(catalog.practiceQuestions || [])];
}

function practiceQuestions(course = data) {
  const originals = new Map(allCatalogQuestions().map(question => [question.id, question]));
  const trail = new Map((course.questions || []).map(question => [question.id, question]));
  return (course.practiceQuestionIds || course.questionIds).map(id => {
    const original = originals.get(id);
    if (!original) return null;
    // Keep the trail's unit filter and the original subject/topic filter distinct.
    return { ...(trail.get(id) || original), originalModuleId: original.moduleId };
  }).filter(Boolean);
}

function setCourse(courseId) {
  const course = catalog.courses.find((c) => c.id === courseId) || catalog.courses[0];
  const byId = new Map(catalog.questions.map((q) => [q.id, q]));
  data = { ...course, questions: course.questionIds.map((id) => {
    const question = byId.get(id);
    if (!course.integrated) return question;
    const module = course.modules.find((m) => course.integratedBy === "subject" ? m.subjectId === question.subjectId : m.competency === question.competency);
    return { ...question, moduleId: module.id, moduleTitle: module.title };
  }) };
  state.activeCourse = course.id;
  makeLessons();
  for (const [currentId, oldId] of Object.entries(course.legacyLessonCredits || {})) {
    if (state.completed.includes(oldId) && !state.completed.includes(currentId)) state.completed.push(currentId);
  }
  for (const lesson of lessons) {
    if (lessonCredits(lesson).length === lesson.questions.length && !state.completed.includes(lesson.id)) state.completed.push(lesson.id);
  }
  const filters = state.practiceFilters[course.id];
  if (filters?.module && !course.modules.some(m => m.id === filters.module) && !practiceQuestions().some(q => q.moduleId === filters.module)) filters.module = "";
  saveState();
}

function completedLessons() {
  return lessons.filter((lesson) => state.completed.includes(lesson.id)).length;
}

function courseSwitcher() {
  return `<div class="course-switcher"><label for="course-select">Matéria</label><select id="course-select" aria-label="Matéria">${[...catalog.courses].sort((a, b) => a.title.localeCompare(b.title, "pt-BR", { sensitivity: "base" })).map((course) => `<option value="${course.id}" ${course.id === data.id ? "selected" : ""}>${course.emoji} ${escapeHtml(course.title)}</option>`).join("")}</select><span>${data.total} questões comentadas na trilha · ${practiceQuestions().length} na prática</span></div>`;
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
  `;
}

function renderRail() {
  const goal = Math.min(100, (state.todayXp / DAILY_GOAL) * 100);
  const completed = completedLessons();
  const course = Math.round((data.studyGuide ? studiedQuestionIds().size / data.total : completed / Math.max(lessons.length, 1)) * 100);
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
      <p>${data.studyGuide ? `${studiedQuestionIds().size} de ${data.total} questões em lições concluídas.` : `${completed} de ${lessons.length} lições concluídas.`}</p>
      <div class="progress-row"><span>${escapeHtml(data.title)}</span><span>${course}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${course}%;background:var(--green)"></div></div>
      <button class="button" data-action="continue">${data.studyGuide ? "Estudar tema" : "Continuar"}</button>
    </section>
    <section class="rail-card">
      <h3>Questões reais</h3>
      <p class="tiny">${data.total} questões comentadas na trilha de ${escapeHtml(data.title)}. ${practiceQuestions().length} questões disponíveis para prática; itens importados podem ter somente o gabarito.</p>
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

function lessonCredits(lesson) {
  return lesson.questions.filter(q => state.completed.includes(data.legacyQuestionCredits?.[q.id]));
}

function studiedQuestionIds() {
  return new Set(lessons.flatMap(lesson => state.completed.includes(lesson.id)
    ? lesson.questions.map(q => q.id) : lessonCredits(lesson).map(q => q.id)));
}

function selectedStudyModule() {
  return data.modules.find(m => m.id === state.studyUnits[data.id]) || nextLesson().module;
}

function pendingUnitLesson(moduleId) {
  return lessons.find(l => l.module.id === moduleId && !state.completed.includes(l.id) && isUnlocked(l));
}

function selectStudyUnit(moduleId) {
  if (!data.modules.some(m => m.id === moduleId)) return;
  state.studyUnits[data.id] = moduleId;
  saveState(); renderLearn();
  app.querySelector('.study-detail h2')?.focus({ preventScroll: true });
  app.querySelector('.study-detail')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function practiceUnit(moduleId) {
  if (!data.modules.some(m => m.id === moduleId)) return;
  state.practiceFilters[data.id] = { ...defaultPracticeFilters(), module: moduleId };
  activeView = 'praticar'; history.replaceState(null, '', '#praticar');
  saveState(); renderPage();
}

function renderPortugueseTrail() {
  const module = selectedStudyModule();
  const unitLessons = lessons.filter(l => l.module.id === module.id);
  const next = pendingUnitLesson(module.id);
  const introRead = state.introductionsRead.includes(module.id);
  const studied = studiedQuestionIds();
  const currentQuestions = data.questions.filter(q => q.moduleId === module.id);
  const unitStudied = currentQuestions.filter(q => studied.has(q.id)).length;
  const complete = !next;
  const [color, dark] = module.color;
  const nextLabel = !introRead ? 'Ler introdução' : next ? `Continuar lição ${next.index + 1} de ${unitLessons.length}` : 'Revisar introdução';
  app.innerHTML = `
    ${pageHeader('Trilha de Língua Portuguesa', 'Leia com mais confiança.', escapeHtml(data.description))}
    <section class="study-overview" aria-label="Progresso da trilha">
      <div><strong>${studied.size} de ${data.total}</strong><span>questões em lições concluídas</span></div>
      <div><strong>${data.modules.length} temas</strong><span>lições de até 5 questões</span></div>
      <progress max="${data.total}" value="${studied.size}" aria-label="Questões concluídas na trilha de Português"></progress>
    </section>
    <section class="study-map" aria-labelledby="study-map-title">
      <div class="section-heading"><div><p class="page-kicker">Seu mapa de estudo</p><h2 id="study-map-title">Escolha seu foco</h2></div></div>
      <p class="study-help">Siga a ordem sugerida ou escolha um tema. Seu avanço é salvo em cada unidade.</p>
      <div class="study-grid">${data.modules.map((m, i) => {
        const qs = data.questions.filter(q => q.moduleId === m.id);
        const done = qs.filter(q => studied.has(q.id)).length;
        return `<button class="study-unit ${m.id === module.id ? 'selected' : ''}" data-study-unit="${m.id}" aria-pressed="${m.id === module.id}">
          <span class="study-unit-top"><span aria-hidden="true">${m.emoji}</span><span>Tema ${i + 1}</span>${done === qs.length ? '<span class="study-done">✓ Concluído</span>' : ''}</span>
          <strong>${escapeHtml(m.title)}</strong><span>${done}/${qs.length} questões concluídas</span>
          <progress max="${qs.length}" value="${done}" aria-label="Progresso de ${escapeHtml(m.title)}"></progress>
        </button>`;
      }).join('')}</div>
    </section>
    <section class="study-detail unit" id="unit-${module.id}" style="--unit-color:${color};--unit-dark:${dark}" aria-labelledby="study-unit-title">
      <div class="unit-banner"><div class="unit-title-wrap"><span class="unit-emoji">${module.emoji}</span><div><h2 id="study-unit-title" tabindex="-1">${escapeHtml(module.title)}</h2><p>${escapeHtml(module.description)}</p></div></div><span class="unit-count">${unitStudied}/${currentQuestions.length} questões</span></div>
      <div class="study-next"><div><p class="page-kicker">${complete ? 'Unidade concluída' : 'Seu próximo passo'}</p><h3>${!introRead ? 'Comece pelos conceitos' : next ? `Lição ${next.index + 1}: coloque em prática` : 'Continue consolidando o que aprendeu'}</h3><p>${!introRead ? `${module.introduction.duration} para entender as ideias e ver um exemplo resolvido.` : next ? `${counted(next.questions.length - lessonCredits(next).length, 'questão', 'questões')} para concluir esta lição. Até ${MAX_LESSON_ERRORS} erros; ao reiniciar, as chances se renovam.` : 'Revise a introdução ou resolva questões aleatórias deste tema.'}</p></div>
        <div class="study-actions"><button class="button" ${!introRead || !next ? `data-intro="${module.id}"` : `data-lesson="${next.id}"`}>${nextLabel}</button><button class="button secondary" data-practice-unit="${module.id}">Praticar este tema</button></div>
      </div>
      <button class="intro-card" data-intro="${module.id}" aria-label="Introdução conceitual de ${escapeHtml(module.title)}"><span class="intro-icon" aria-hidden="true">☰</span><span><strong>${introRead ? 'Revisar conceitos' : 'Introdução conceitual'}</strong><span>${escapeHtml(module.introduction.summary)}</span><small>${introRead ? '✓ Leitura concluída' : module.introduction.duration + ' de leitura'}</small></span><span aria-hidden="true">↗</span></button>
      <div class="study-lessons" aria-label="Lições de ${escapeHtml(module.title)}">${unitLessons.map(l => {
        const done = state.completed.includes(l.id);
        const credits = lessonCredits(l).length;
        const unlocked = isUnlocked(l);
        return `<button class="study-lesson ${done ? 'done' : ''}" ${unlocked ? `data-lesson="${l.id}"` : 'disabled'} aria-label="Lição ${l.index + 1}${done ? ', concluída, revisar' : unlocked ? '' : ', bloqueada'}"><span class="study-lesson-icon" aria-hidden="true">${done ? '✓' : unlocked ? '▶' : '🔒'}</span><span><strong>Lição ${l.index + 1}</strong><small>${done ? 'Concluída · Revisar' : credits ? `${credits}/${l.questions.length} questões já concluídas` : counted(l.questions.length, 'questão', 'questões')}</small></span><span>${!unlocked ? 'Conclua a anterior' : done ? 'Revisar' : 'Estudar'}</span></button>`;
      }).join('')}</div>
    </section>`;
}

function renderLearn() {
  if (data.studyGuide) { renderPortugueseTrail(); return; }
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
    <div class="curriculum-note"><strong>${escapeHtml(data.areaTitle)}</strong><span>${data.modules.every(m => m.competency) ? `${data.modules.length} unidades organizadas pelas competências da matriz do INEP.` : "Unidades organizadas por tema, com competência e habilidade indicadas em cada questão."} Comece por qualquer unidade e avance pelas lições.</span>${data.integrationNote ? `<span>${escapeHtml(data.integrationNote)}</span>` : ""}</div>
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
              <span><strong>Introdução conceitual</strong><span>${renderMathText(module.introduction.summary)}</span><small>${state.introductionsRead.includes(module.id) ? "✓ Lida · Revisar conceitos" : `${module.introduction.duration} de leitura · Comece por aqui`}</small></span>
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
                    <div class="lesson-label"><strong>${lesson.title}</strong><span>${complete ? "Concluída" : unlocked ? counted(lesson.questions.length, "questão", "questões") : "Complete a anterior"}</span></div>
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
  return { module: "", subject: "", topic: "", year: "", competency: "", difficulty: "", status: "all", query: "" };
}

function practiceFilters() {
  return { ...defaultPracticeFilters(), ...state.practiceFilters[data.id] };
}

function difficultyScore(question) {
  return Number.isFinite(question.tri?.difficultyScore) ? question.tri.difficultyScore : null;
}

function questionMatches(question, filters) {
  if (filters.module && question.moduleId !== filters.module) return false;
  if (filters.subject && question.subjectId !== filters.subject) return false;
  if (filters.topic) {
    if (`${question.subjectId}:${question.originalModuleId || question.moduleId}` !== filters.topic) return false;
  }
  if (filters.year && String(question.year) !== String(filters.year)) return false;
  if (filters.competency === "unknown" ? question.competency != null : filters.competency && String(question.competency) !== String(filters.competency)) return false;
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
  return practiceQuestions().filter(q => questionMatches(q, filters));
}

function filterOptions(values, selected, allLabel) {
  return `<option value="">${allLabel}</option>${values.map(([value, label]) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}`;
}

function renderPractice() {
  const filters = practiceFilters();
  const questions = practiceQuestions();
  const pool = filteredPracticeQuestions(filters);
  const withTri = pool.filter(q => difficultyScore(q) !== null).length;
  const years = [...new Set(questions.map(q => q.year))].sort((a, b) => b - a);
  const competencies = [...new Set(questions.map(q => q.competency).filter(Number.isInteger))].sort((a, b) => a - b).map(c => [c, `Competência ${c}`]);
  if (questions.some(q => q.competency == null)) competencies.push(["unknown", "Competência não classificada"]);
  const subjects = [...new Map(questions.map(q => [q.subjectId, q.subjectTitle])).entries()].sort((a,b) => a[1].localeCompare(b[1], "pt-BR"));
  const ids = new Set(questions.map(q => q.id));
  const topics = [...new Map(allCatalogQuestions().filter(q => ids.has(q.id)).map(q => [`${q.subjectId}:${q.moduleId}`, `${q.subjectTitle} · ${q.moduleTitle}`])).entries()].sort((a,b) => a[1].localeCompare(b[1], "pt-BR"));
  const modules = data.modules.map(m => [m.id, m.title]);
  if (questions.some(q => q.moduleId === "acervo-api")) modules.push(["acervo-api", "Assunto não classificado"]);
  const areaCourses = catalog.courses.filter(c => ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"].includes(c.id));
  const metrics = performanceMetrics(courseAttempts());
  app.innerHTML = `
    ${pageHeader("Sessões de prática", "Seu treino, seu ritmo.", "Escolha os filtros, inicie o cronômetro e resolva questões no seu ritmo. Ao encerrar, receba um relatório com seus resultados e próximos passos.")}
    ${catalog.practiceQuestions?.length ? `<section class="notice"><strong>Acervo de provas por ano</strong><p>Acesse as questões importadas pelas grandes áreas e use o filtro de ano. As trilhas mantêm a seleção comentada. Novos itens têm enunciado, alternativas e gabarito; resolução, disciplina específica, assunto e competência só aparecem quando há classificação disponível.</p><div class="study-actions">${areaCourses.map(course => `<button class="button secondary" data-practice-area="${course.id}" aria-pressed="${data.id === course.id}">${escapeHtml(course.title)}</button>`).join("")}</div></section>` : ""}
    ${state.pendingPractice ? `<section class="practice-launch"><p class="page-kicker">Sessão salva</p><h2>Continue de onde parou</h2><p>${escapeHtml(state.pendingPractice.session.courseTitle)} · ${counted(state.pendingPractice.session.records.filter(r => r.outcome === "answered").length, "resposta")} · ${formatDuration(state.pendingPractice.session.activeMs)} de estudo ativo. Os filtros desta sessão serão preservados.</p><button class="button" data-action="resume-saved-practice">Retomar sessão</button></section>` : ""}
    <div class="practice-overview"><span><strong>${metrics.total}</strong> respostas registradas</span><span><strong>${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}</strong> de acerto</span><a href="#desempenho" data-view="desempenho">Ver desempenho ↗</a></div>
    <form id="practice-filters" class="filter-card">
      <div class="section-heading"><div><p class="page-kicker">Monte sua seleção</p><h2>Filtros de questões</h2></div><button type="button" class="text-button" data-action="reset-filters">Limpar filtros</button></div>
      <div class="filter-grid">
        <label>${data.integrated ? "Unidade da trilha" : "Assunto"}<select name="module">${filterOptions(modules, filters.module, "Todos os assuntos")}</select></label>
        ${data.integrated ? `<label>Disciplina<select name="subject">${filterOptions(subjects, filters.subject, "Todas as disciplinas")}</select></label><label>Assunto da disciplina<select name="topic">${filterOptions(topics, filters.topic, "Todos os assuntos originais")}</select></label>` : ""}
        <label>Ano<select name="year">${filterOptions(years.map(y => [y, y]), filters.year, "Todos os anos")}</select></label>
        <label>Competência<select name="competency">${filterOptions(competencies, filters.competency, "Todas as competências")}</select></label>
        <label>Dificuldade TRI<select name="difficulty">${filterOptions([["known", "Com dificuldade oficial"], ["low", "Até 500"], ["medium", "Acima de 500 até 650"], ["high", "Acima de 650"], ["unknown", "Sem parâmetro disponível"]], filters.difficulty, "Todas as dificuldades")}</select></label>
        <label>Minha resolução<select name="status">${[["all", "Todas as questões"], ["unanswered", "Ainda não respondi"], ["wrong", "Erros para revisar"], ["answered", "Já respondi"], ["favorites", "Favoritas"]].map(([value, label]) => `<option value="${value}" ${value === filters.status ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label>Palavra-chave ou código<input name="query" type="search" maxlength="120" value="${escapeHtml(filters.query)}" placeholder="Ex.: energia, célula, 2022-142"></label>
      </div>
      <button class="button secondary" type="submit">Aplicar filtros</button>
      <p class="filter-help">A matéria é escolhida no seletor acima. Ao filtrar disciplina, assunto ou competência, os itens sem essa classificação ficam de fora. Quanto maior a dificuldade TRI, mais difícil o item. Os intervalos numéricos são filtros do Enem, sem classificação oficial em fácil, médio ou difícil. A ausência de parâmetro não significa dificuldade baixa.</p>
    </form>
    <section class="practice-launch" aria-live="polite"><div><p class="page-kicker">Seleção atual</p><h2>${pool.length} ${pool.length === 1 ? "questão encontrada" : "questões encontradas"}</h2><p>${pool.length ? `${withTri} com dificuldade oficial vinculada. Sorteio sem repetição até percorrer a seleção.` : "Nenhuma questão corresponde a estes filtros. Amplie o ano, o assunto ou a situação de resolução."}</p></div><button class="button" data-action="practice" ${pool.length && !state.pendingPractice ? "" : "disabled"}>Iniciar sessão de prática <span aria-hidden="true">→</span></button>${state.pendingPractice ? '<p>Retome e encerre a sessão salva antes de iniciar outra.</p>' : ""}</section>
    <div class="notice">Sem limite de erros ou de questões. O cronômetro pausa ao ocultar esta aba ou ao pausar a sessão. As respostas são salvas a cada correção; o andamento, a cada cinco segundos.</div>
    ${practiceHistoryMarkup()}
  `;
}

function courseAttempts(period = "all", mode = "all") {
  const ids = new Set(practiceQuestions().map(q => q.id));
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
  const questions = practiceQuestions();
  const questionById = new Map(questions.map(q => [q.id, q]));
  const modules = [...data.modules];
  if (questions.some(q => q.moduleId === "acervo-api")) modules.push({ id: "acervo-api", title: "Assunto não classificado" });
  const rows = modules.map(module => ({ module, ...performanceMetrics(attempts.filter(a => questionById.get(a.questionId)?.moduleId === module.id)) }));
  const days = Array.from({ length: 7 }, (_, index) => new Date(new Date(`${localDay()}T12:00:00Z`).getTime() - (6 - index) * 86400000).toISOString().slice(0, 10));
  const daily = days.map(day => ({ day, ...performanceMetrics(attempts.filter(a => a.day === day)) }));
  const max = Math.max(1, ...daily.map(d => d.total));
  app.innerHTML = `
    ${pageHeader("Estatísticas", "Veja sua evolução.", "Acompanhe suas respostas e descubra os assuntos que merecem mais atenção.")}
    <div class="stats-controls"><label>Período<select id="stats-period">${[["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"], ["all", "Todo o histórico"]].map(([v, l]) => `<option value="${v}" ${statsPeriod === v ? "selected" : ""}>${l}</option>`).join("")}</select></label><label>Modo<select id="stats-mode">${[["all", "Todos os modos"], ["practice", "Prática"], ["lesson", "Lições"]].map(([v, l]) => `<option value="${v}" ${statsMode === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    ${storageWarning ? '<div class="notice">O navegador não conseguiu salvar o histórico. Os dados desta sessão estão apenas na memória; libere espaço para preservá-los.</div>' : ""}
    <div class="metric-grid">
      ${[[metrics.total, "Respostas", `${metrics.unique} ${metrics.unique === 1 ? "questão distinta" : "questões distintas"}`], [`${metrics.accuracy === null ? "—" : `${metrics.accuracy}%`}`, "Taxa de acerto", `${counted(metrics.correct, "acerto")} · ${counted(metrics.wrong, "erro")}`], [formatDuration(metrics.duration), "Tempo respondendo", `${formatDuration(metrics.average)} por resposta`], [questions.filter(q => state.missed.includes(q.id)).length, "Erros para revisar", "Situação atual da matéria"]].map(([n, title, detail]) => `<article class="metric-card"><strong>${n}</strong><h2>${title}</h2><p>${detail}</p></article>`).join("")}
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
  return `<details class="tri-details"><summary>Dificuldade TRI <strong>${score.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</strong> <span>INEP · ${question.year}</span></summary><p>Quanto maior o valor, maior a dificuldade do item. Este valor não representa pontos ganhos ao acertar nem uma previsão de nota.</p><p>${renderMathText(String.raw`\(b\)`)} original (escala 0,1): ${escapeHtml(question.tri.b)}. Conversão para a escala do ENEM: ${renderMathText(String.raw`\(500 + 100b\)`)}. Item ${escapeHtml(question.tri.itemCode)} · Prova ${escapeHtml(question.tri.examCode)}.</p><a class="source-link" href="${escapeHtml(question.tri.sourceUrl)}" target="_blank" rel="noreferrer">Consultar parâmetros oficiais ↗</a> · <a class="source-link" href="${escapeHtml(catalog.tri.scale.methodologyUrl)}" target="_blank" rel="noreferrer">Metodologia do INEP ↗</a></details>`;
}

function markStudyDay() {
  const today = localDay();
  if (state.lastStudyDay === today) return;
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
  state.streak = state.lastStudyDay === yesterday ? state.streak + 1 : 1;
  state.lastStudyDay = today;
}

function validPracticeSession(session) {
  return session && typeof session.id === "string" && typeof session.courseId === "string"
    && typeof session.courseTitle === "string" && Number.isFinite(Date.parse(session.startedAt))
    && Number.isFinite(session.activeMs) && session.activeMs >= 0 && Array.isArray(session.records)
    && session.records.every(r => r && typeof r.questionId === "string" && ["answered", "skipped", "unfinished"].includes(r.outcome)
      && Number.isFinite(r.durationMs) && r.durationMs >= 0 && (r.outcome !== "answered" || typeof r.correct === "boolean"));
}

function formatPercent(value) {
  return `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatClock(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":");
}

function sessionElapsed() {
  return quiz.session.activeMs + (quiz.sessionTimerStartedAt === null ? 0 : Math.max(0, Date.now() - quiz.sessionTimerStartedAt));
}

function questionElapsed() {
  return quiz.elapsedMs + (quiz.timerStartedAt === null ? 0 : Math.max(0, Date.now() - quiz.timerStartedAt));
}

function updatePracticeClocks() {
  if (!quiz?.practice || quiz.ended) return;
  const sessionClock = modal.querySelector("[data-session-clock]");
  const questionClock = modal.querySelector("[data-question-clock]");
  if (sessionClock) sessionClock.textContent = formatClock(sessionElapsed());
  if (questionClock) questionClock.textContent = formatClock(questionElapsed());
}

function startSessionTimer() {
  if (!quiz?.practice || quiz.ended || quiz.paused || document.hidden) return;
  if (quiz.sessionTimerStartedAt === null) quiz.sessionTimerStartedAt = Date.now();
  if (practiceTick === null) practiceTick = setInterval(() => {
    updatePracticeClocks();
    if (quiz?.practice && Date.now() - quiz.lastCheckpointAt >= 5000) checkpointPractice();
  }, 1000);
}

function stopSessionTimer() {
  if (quiz?.practice && quiz.sessionTimerStartedAt !== null) {
    quiz.session.activeMs = sessionElapsed();
    quiz.sessionTimerStartedAt = null;
  }
  if (practiceTick !== null) { clearInterval(practiceTick); practiceTick = null; }
}

function checkpointPractice() {
  if (!quiz?.practice || quiz.ended) return;
  stopQuestionTimer();
  stopSessionTimer();
  state.pendingPractice = {
    session: structuredClone(quiz.session), queue: [...quiz.queue], questionIds: quiz.questions.map(q => q.id),
    index: quiz.index, selected: quiz.selected, checked: quiz.checked, elapsedMs: quiz.elapsedMs,
    cycle: quiz.cycle, questionRecorded: quiz.questionRecorded,
  };
  quiz.lastCheckpointAt = Date.now();
  saveState();
  startQuestionTimer();
  startSessionTimer();
}

function practiceTimerMarkup() {
  return `<div class="practice-session-bar"><div class="session-clock"><small>Sessão · tempo ativo</small><strong data-session-clock aria-live="off">${formatClock(sessionElapsed())}</strong></div><div class="session-clock"><small>${quiz.checked ? "Tempo desta resposta" : "Nesta questão"}</small><strong data-question-clock aria-live="off">${formatClock(questionElapsed())}</strong></div><button class="button secondary" data-action="pause-practice">Pausar sessão</button><p class="session-timer-note">O tempo da resposta para na correção. O tempo da sessão inclui a leitura das justificativas.</p></div>`;
}

function pausePractice() {
  if (!quiz?.practice || quiz.ended) return;
  quiz.paused = true;
  checkpointPractice();
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "instant" });
}

function resumePractice() {
  if (!quiz?.practice || quiz.ended) return;
  quiz.paused = false;
  startQuestionTimer();
  startSessionTimer();
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "instant" });
}

function resumeSavedPractice() {
  const saved = state.pendingPractice;
  if (!saved) return;
  const course = catalog.courses.find(c => c.id === saved.session.courseId);
  const ids = new Set(course?.practiceQuestionIds || course?.questionIds || []);
  if (!course || !Array.isArray(saved.questionIds) || !saved.questionIds.length || !saved.questionIds.every(id => ids.has(id))
    || !Array.isArray(saved.queue) || !saved.queue.every(id => ids.has(id)) || saved.index !== saved.questionIds.length - 1
    || !Number.isFinite(saved.elapsedMs) || saved.elapsedMs < 0 || !Number.isInteger(saved.cycle) || saved.cycle < 1) {
    state.pendingPractice = null; saveState(); renderPractice();
    showToast("A seleção salva mudou. Suas respostas anteriores continuam no desempenho; inicie uma nova sessão.");
    return;
  }
  stopQuestionTimer(); stopSessionTimer();
  setCourse(course.id);
  const byId = new Map(practiceQuestions().map(q => [q.id, q]));
  const answered = saved.session.records.filter(r => r.outcome === "answered");
  quiz = {
    practice: true, session: structuredClone(saved.session), filters: { ...defaultPracticeFilters(), ...saved.session.filters },
    queue: [...saved.queue], questions: saved.questionIds.map(id => byId.get(id)), index: saved.index,
    selected: saved.selected, checked: saved.checked === true, questionRecorded: saved.questionRecorded === true,
    elapsedMs: saved.elapsedMs, timerStartedAt: null, sessionTimerStartedAt: null, paused: true,
    cycle: saved.cycle, answeredCount: answered.length, correct: answered.filter(r => r.correct).length,
    skipped: saved.session.records.filter(r => r.outcome === "skipped").length,
    totalDurationMs: answered.reduce((n, r) => n + r.durationMs, 0), lastCheckpointAt: Date.now(),
    lesson: { title: "Sessão de prática", module: { title: data.title } },
  };
  sessionReport = null;
  activeView = "praticar";
  history.replaceState(null, "", "#praticar");
  openModal("Sessão de prática");
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
}

function appendSessionRecord(outcome, correct = null) {
  if (!quiz?.practice || quiz.questionRecorded) return;
  quiz.session.records.push({ questionId: quiz.questions[quiz.index].id, answer: outcome === "answered" ? quiz.selected : null,
    correct, outcome, durationMs: Math.round(quiz.elapsedMs), at: new Date().toISOString() });
  quiz.questionRecorded = true;
}

function sessionDate(session) {
  return new Date(session.startedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function practiceHistoryMarkup() {
  const sessions = state.practiceSessions.filter(s => s.courseId === data.id).slice().reverse();
  return `<section class="practice-session-history"><div class="section-heading"><h2>Sessões recentes</h2><span class="tiny">Salvas neste navegador</span></div>${sessions.length ? sessions.map(s => {
    const report = buildPracticeReport(s, { ...catalog, questions: allCatalogQuestions() });
    return `<button class="session-history-item" data-session-report="${escapeHtml(s.id)}"><span><strong>${escapeHtml(sessionDate(s))}</strong><small>${counted(report.total, "resposta")} · ${report.accuracy === null ? "Sem respostas" : `${formatPercent(report.accuracy)} de acerto`}</small></span><span>${formatDuration(report.activeMs)} <span aria-hidden="true">↗</span></span></button>`;
  }).join("") : '<p class="session-empty">Ao encerrar sua primeira sessão, o relatório ficará disponível aqui.</p>'}<p class="tiny">Guardamos as últimas 20 sessões entre todas as matérias. O histórico geral de respostas permanece em Desempenho.</p></section>`;
}

function sessionFiltersLabel(session) {
  const f = session.filters || {};
  const course = catalog.courses.find(c => c.id === session.courseId);
  const labels = [session.courseTitle];
  if (f.module) labels.push(course?.modules.find(m => m.id === f.module)?.title || (f.module === "acervo-api" ? "Assunto não classificado" : f.module));
  if (f.subject) labels.push(allCatalogQuestions().find(q => q.subjectId === f.subject)?.subjectTitle || f.subject);
  if (f.topic) labels.push(allCatalogQuestions().find(q => `${q.subjectId}:${q.moduleId}` === f.topic)?.moduleTitle || f.topic);
  if (f.year) labels.push(`ENEM ${f.year}`);
  if (f.competency) labels.push(f.competency === "unknown" ? "Competência não classificada" : `Competência ${f.competency}`);
  if (f.difficulty) labels.push(({known:"Com TRI",unknown:"Sem TRI",low:"TRI até 500",medium:"TRI de 500 a 650",high:"TRI acima de 650"})[f.difficulty] || f.difficulty);
  if (f.status && f.status !== "all") labels.push(({unanswered:"Não respondidas",answered:"Já respondidas",wrong:"Erros para revisar",favorites:"Favoritas"})[f.status] || f.status);
  if (f.query) labels.push(`Busca: ${f.query}`);
  return labels.join(" · ");
}

function renderSessionReport(session, dimension = "topic") {
  sessionReport = session;
  sessionBreakdown = ["area", "subject", "topic", "competency"].includes(dimension) ? dimension : "topic";
  const report = buildPracticeReport(session, { ...catalog, questions: allCatalogQuestions() });
  const dimensions = [["area", "Área"], ["subject", "Disciplina"], ["topic", "Assunto"], ["competency", "Competência"]];
  const rows = report.groups[sessionBreakdown];
  modal.setAttribute("aria-label", "Relatório da sessão de prática");
  modal.innerHTML = `<div class="session-dashboard">
    <header class="session-report-header"><p class="page-kicker">Seu treino em perspectiva · ${escapeHtml(sessionDate(session))}</p><h1 tabindex="-1">${session.exhausted ? "Seleção concluída!" : "Sessão concluída"}</h1><p>${escapeHtml(sessionFiltersLabel(session))}</p><div class="session-report-actions"><button class="button" data-action="finish">Voltar aos filtros</button><button class="button secondary" data-action="view-performance">Ver desempenho geral</button></div></header>
    ${storageWarning ? '<p class="notice">Não foi possível salvar no navegador. Este relatório está disponível enquanto a página permanecer aberta.</p>' : ""}
    <div class="session-summary-grid">${[
      [formatDuration(report.activeMs), "Tempo de estudo", "Tempo ativo, incluindo as justificativas"],
      [report.total ? formatDuration(report.averageMs) : "—", "Média por resposta", "Da abertura da questão até a correção"],
      [report.accuracy === null ? "—" : formatPercent(report.accuracy), "Aproveitamento", `${counted(report.correct, "acerto")} · ${counted(report.wrong, "erro")}`],
      [report.total, "Respostas verificadas", `${counted(report.unique, "questão distinta", "questões distintas")} · ${counted(report.skipped, "pulada")}`],
    ].map(([value,label,detail]) => `<article class="session-metric"><small>${label}</small><strong>${value}</strong><p>${detail}</p></article>`).join("")}</div>
    ${!report.total ? '<div class="session-empty"><h2>Esta sessão terminou sem respostas verificadas.</h2><p>O tempo foi registrado. Responda e verifique questões na próxima sessão para comparar seu desempenho.</p></div>' : ""}
    <div class="session-report-grid">
      <section class="session-report-card session-report-wide"><h2>Desempenho nesta sessão</h2><p>Acertos sobre respostas verificadas. Questões puladas ou não concluídas não contam como erros. Cada tentativa conta, inclusive repetições.</p>
        <div class="session-breakdown-tabs" role="group" aria-label="Agrupar desempenho">${dimensions.map(([key,title]) => `<button data-session-dimension="${key}" aria-pressed="${sessionBreakdown === key}">${title}</button>`).join("")}</div>
        ${rows.length ? `<div class="session-table-scroll" tabindex="0" role="region" aria-label="Tabela de desempenho por ${dimensions.find(d => d[0] === sessionBreakdown)[1].toLowerCase()}"><table class="session-breakdown-table"><thead><tr><th scope="col">${dimensions.find(d => d[0] === sessionBreakdown)[1]}</th><th scope="col">Respostas</th><th scope="col">Acertos</th><th scope="col">Erros</th><th scope="col">Aproveitamento</th><th scope="col">Tempo médio</th></tr></thead><tbody>${rows.map(row => `<tr><th scope="row">${escapeHtml(row.title)}</th><td>${row.total}</td><td>${row.correct}</td><td>${row.wrong}</td><td><strong>${formatPercent(row.accuracy)}</strong><div class="session-accuracy-track" aria-hidden="true"><span style="width:${row.accuracy}%"></span></div></td><td>${formatDuration(row.averageMs)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="session-empty">Ainda não há respostas para comparar.</p>'}
      </section>
      <section class="session-report-card"><h2>Análise e próximos passos</h2>${report.total ? `<p><strong>${counted(report.correct, "acerto")} em ${counted(report.total, "resposta")}</strong>, com ${counted(report.unique, "questão distinta", "questões distintas")} e média de ${formatDuration(report.averageMs)} por resposta.</p>` : ""}<p>Sugestões baseadas apenas nesta sessão. Amostras pequenas indicam pontos a explorar, sem estimar sua nota no ENEM.</p><ol class="session-recommendations">${report.recommendations.map((item,index) => `<li><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p>${item.subjectId || item.areaId ? `<button class="text-button" data-session-focus="${index}">Preparar próximo treino →</button>` : ""}</li>`).join("")}</ol></section>
      <section class="session-report-card"><h2>As 5 questões mais demoradas</h2><p>${report.slowest.length < 5 ? `Você respondeu ${report.unique} ${report.unique === 1 ? "questão distinta" : "questões distintas"}; todas aparecem abaixo. ` : ""}Tempo até a correção, somado se a questão foi repetida.</p>${report.slowest.length ? `<ol class="session-slowest-list">${report.slowest.map(item => `<li><div><strong class="session-question-title">${escapeHtml(item.title)}</strong><p class="session-question-meta">${escapeHtml(item.subjectTitle)} · ${escapeHtml(item.moduleTitle)}<br>${counted(item.attempts, "tentativa")} · ${counted(item.correct, "acerto")} · ${counted(item.wrong, "erro")}</p><button class="text-button" data-session-question="${escapeHtml(item.questionId)}">Revisar questão</button></div><strong class="session-question-time">${formatDuration(item.durationMs)}</strong></li>`).join("")}</ol>` : '<p class="session-empty">A lista aparece depois de verificar respostas.</p>'}</section>
      <section class="session-report-card session-report-wide"><h2>Como seu tempo foi distribuído</h2><p><strong>${formatDuration(report.answerMs)}</strong> respondendo · <strong>${formatDuration(report.reviewMs)}</strong> em gabaritos, justificativas e navegação · <strong>${formatDuration(report.skippedMs)}</strong> em ${counted(report.skipped, "questão pulada", "questões puladas")} · <strong>${formatDuration(report.unfinishedMs)}</strong> em ${counted(report.unfinished, "questão não concluída", "questões não concluídas")}.</p><p>O cronômetro conta somente o tempo com a aba visível e a sessão ativa. Pausas e tempo com o app fechado ficam de fora. Os recortes refletem apenas as questões praticadas com estes filtros. Disciplina específica, assunto e competência não classificados são identificados como indisponíveis; não são inferidos a partir do resultado.</p></section>
    </div></div>`;
}

function openSessionReport(id) {
  const session = state.practiceSessions.find(s => s.id === id);
  if (!session) return;
  openModal("Relatório da sessão de prática");
  renderSessionReport(session);
  modal.querySelector("h1").focus({ preventScroll: true });
}

function reviewSessionQuestion(id) {
  if (!sessionReport?.records.some(r => r.questionId === id && r.outcome === "answered")) return;
  const question = allCatalogQuestions().find(q => q.id === id);
  if (!question) return;
  modal.setAttribute("aria-label", "Revisão da sessão");
  modal.innerHTML = `<div class="quiz-shell"><div class="quiz-topbar"><button class="text-button" data-action="back-session-report">← Voltar ao relatório</button></div><div class="question-wrap"><p class="page-kicker">ENEM ${question.year} · Questão ${question.index} · ${escapeHtml(question.subjectTitle)}</p>${question.context ? `<div class="question-context">${renderMarkdown(question.context, question.areaId === "linguagens")}</div>` : ""}<h1 tabindex="-1">${renderMathText(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1><div class="answers">${question.alternatives.map(a => `<div class="answer ${a.letter === question.correctAlternative ? "correct" : ""}"><span class="answer-letter">${a.letter}</span><span class="answer-text">${a.file ? `<img src="${escapeHtml(a.file)}" alt="Alternativa ${a.letter}" style="max-width:100%;max-height:180px">` : renderMathText(a.text || "")}</span></div>`).join("")}</div>${renderExplanation(question)}</div></div>`;
  modal.scrollTo({ top: 0, behavior: "instant" });
  modal.querySelector("h1").focus({ preventScroll: true });
}

function focusSessionRecommendation(index) {
  if (!sessionReport) return;
  const recommendation = buildPracticeReport(sessionReport, { ...catalog, questions: allCatalogQuestions() }).recommendations[index];
  if (!recommendation) return;
  const course = catalog.courses.find(c => c.id === recommendation.subjectId) || catalog.courses.find(c => c.id === recommendation.areaId);
  if (!course) return;
  closeQuiz();
  setCourse(course.id);
  state.practiceFilters[course.id] = { ...defaultPracticeFilters(),
    module: !course.integrated && course.modules.some(m => m.id === recommendation.moduleId) ? recommendation.moduleId : "",
    subject: course.integrated ? recommendation.subjectId || "" : "",
    topic: course.integrated && recommendation.moduleId && recommendation.subjectId ? `${recommendation.subjectId}:${recommendation.moduleId}` : "",
    competency: recommendation.competency ? String(recommendation.competency) : "",
  };
  saveState();
  activeView = "praticar";
  history.replaceState(null, "", "#praticar");
  renderPage();
  app.querySelector("h1").focus({ preventScroll: true });
}

function stopQuestionTimer() {
  if (!quiz || quiz.checked || quiz.timerStartedAt === null) return;
  quiz.elapsedMs += Math.max(0, Date.now() - quiz.timerStartedAt);
  quiz.timerStartedAt = null;
}

function startQuestionTimer() {
  if (quiz && !quiz.checked && !quiz.ended && !quiz.paused && !document.hidden && quiz.timerStartedAt === null) quiz.timerStartedAt = Date.now();
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
  const byId = new Map(practiceQuestions().map(q => [q.id, q]));
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
  if (!quiz?.practice || quiz.ended) return;
  stopQuestionTimer();
  stopSessionTimer();
  if (!quiz.checked) appendSessionRecord("unfinished");
  quiz.ended = true;
  quiz.session.endedAt = new Date().toISOString();
  quiz.session.exhausted = exhausted;
  state.practiceSessions = [...state.practiceSessions.filter(s => s.id !== quiz.session.id), structuredClone(quiz.session)].slice(-20);
  state.pendingPractice = null;
  saveState();
  renderSessionReport(quiz.session);
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "instant" });
}

function skipPracticeQuestion() {
  if (!quiz?.practice || quiz.checked || quiz.ended || quiz.paused) return;
  stopQuestionTimer();
  appendSessionRecord("skipped");
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
  quiz.questionRecorded = false;
  resetQuestionTimer();
  checkpointPractice();
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
  const years = [...new Set(allCatalogQuestions().map(q => q.year))].sort((a, b) => a - b);
  app.innerHTML = `
    ${pageHeader("Projeto aberto", "Sobre o Enem", "Uma experiência gamificada, com identidade própria, para transformar provas anteriores em prática diária.")}
    <div class="about-grid">
      <article class="info-card"><div class="big-number">${allCatalogQuestions().length.toLocaleString("pt-BR")}</div><h3>questões disponíveis</h3><p>Seleção comentada e acervo importado, sem duplicar questões. Edições de ${years[0]} a ${years.at(-1)} disponíveis na prática por área e ano.</p></article>
      <article class="info-card"><div class="big-number">${allCatalogQuestions().filter(q => q.explanation?.steps?.length).length.toLocaleString("pt-BR")}</div><h3>questões comentadas únicas</h3><p>Resoluções próprias nas trilhas e no modo prática, com raciocínio e justificativa da alternativa correta. Cada questão é contada uma única vez. Novos comentários são publicados em lotes após conferência do conteúdo.</p></article>
      <article class="info-card"><div class="big-number">${years.length}</div><h3>anos de prova</h3><p>As questões mantêm o ano, o número, o enunciado, as alternativas e o gabarito da fonte.</p></article>
      <article class="info-card"><div class="big-number">100%</div><h3>progresso local</h3><p>XP, sequência, respostas e lições concluídas ficam salvos apenas neste navegador.</p></article>
    </div>
    <div class="notice"><strong>Instalar o Enem:</strong> abra este site no Chrome ou Edge e escolha a opção de instalar aplicativo no menu do navegador. No iPhone ou iPad, use Compartilhar → Adicionar à Tela de Início. Depois, o Enem abre em uma janela própria. Em navegadores compatíveis, as questões e os comentários são guardados após o primeiro carregamento; imagens ainda não carregadas precisam de conexão. O progresso continua salvo neste dispositivo.</div>
    <div class="notice"><strong>Áreas e competências:</strong> Matemática, Ciências da Natureza e Ciências Humanas seguem a organização da <a class="source-link" href="${catalog.matrix.source}" target="_blank" rel="noreferrer">matriz de referência do INEP</a>. Os títulos didáticos, introduções e vínculos entre questões e habilidades são editoriais. A seleção atual não contém exercícios de todas as habilidades. <a class="source-link" href="/data/enem-matriz-de-referencia.pdf" download>Baixar matriz local (PDF)</a>.</div>
    <div class="notice"><strong>Acervo integral preservado:</strong> os ${catalog.rawTotal.toLocaleString("pt-BR")} registros da API permanecem disponíveis no <a class="source-link" href="/data/all-questions.json" download>snapshot completo em JSON</a>. A prática reúne a seleção comentada e questões importadas com alternativas e gabarito válidos. Itens sem resolução revisada são identificados na correção; questões incompletas, anuladas ou inconsistentes não são usadas para avaliar respostas. Os novos itens ficam na prática, sem alterar as trilhas.</div>
    <div class="notice"><strong>Dificuldade TRI oficial:</strong> ${allCatalogQuestions().filter(q => q.tri).length.toLocaleString("pt-BR")} das ${allCatalogQuestions().length.toLocaleString("pt-BR")} questões disponíveis têm parâmetros vinculados aos <a class="source-link" href="${escapeHtml(catalog.tri.sourceIndexUrl)}" target="_blank" rel="noreferrer">arquivos de itens do INEP, de 2009 a 2023</a>. A API de questões não fornece esses parâmetros. O vínculo confere ano, caderno, numeração e gabarito. Itens sem parâmetro válido são identificados como indisponíveis. A dificuldade exibida usa ${renderMathText(String.raw`\(500 + 100b\)`)}; não é uma previsão da nota do aluno.</div>
    <div class="notice"><strong>Fonte:</strong> <a class="source-link" href="https://enem.dev" target="_blank" rel="noreferrer">enem.dev</a>, projeto comunitário sem vínculo com INEP ou MEC. O código da API de origem é GPL-2.0. As introduções e resoluções são conteúdo didático próprio do Enem, não comentários oficiais do INEP. O Enem não é afiliado ao Duolingo.</div>
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
        <h1 class="page-title" tabindex="-1">${renderMathText(intro.title)}</h1>
        <p class="page-subtitle">${renderMathText(intro.summary)}</p>
        ${referenceMarkup(module)}
        ${intro.sections.map((section, index) => `<section class="concept-section"><span class="concept-number">0${index + 1}</span><div><h2>${renderMathText(section.title)}</h2><p>${renderMathText(section.text)}</p>${section.formula ? `<div class="formula">${renderMathText(section.formula)}</div>` : ""}${section.notation ? `<p class="notation">${renderMathText(section.notation)}</p>` : ""}</div></section>`).join("")}
        <section class="worked-example"><p class="page-kicker">Aplicando a ideia</p><h2>${renderMathText(intro.example.title)}</h2><ol>${intro.example.steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol></section>
        <div class="notice"><strong>Evite esta confusão</strong><br>${renderMathText(intro.pitfall)}</div>
        <div class="intro-actions"><button class="button" data-action="complete-intro">${data.studyGuide && pendingUnitLesson(moduleId) ? "Concluir leitura e iniciar lição" : state.introductionsRead.includes(moduleId) ? "Voltar à unidade" : "Concluir introdução"}</button></div>
      </article>
    </div>`;
  modal.querySelector("h1").focus();
}

function completeIntroduction() {
  const next = data.studyGuide ? pendingUnitLesson(introModuleId) : null;
  if (!state.introductionsRead.includes(introModuleId)) {
    state.introductionsRead.push(introModuleId);
    saveState();
  }
  closeQuiz();
  if (next) startLesson(next.id);
}

function startLesson(lessonId, customQuestions) {
  const lesson = lessons.find((item) => item.id === lessonId) || {
    id: `practice-${Date.now()}`,
    title: "Prática personalizada",
    module: { title: "Revisão", id: "mecanica" },
    questions: customQuestions,
  };
  if (data.studyGuide && lessons.some(l => l.id === lesson.id)) state.studyUnits[data.id] = lesson.module.id;
  quiz = {
    lesson,
    questions: customQuestions || (data.studyGuide && !state.completed.includes(lesson.id) ? lesson.questions.filter(q => !state.completed.includes(data.legacyQuestionCredits?.[q.id])) : lesson.questions),
    index: 0,
    selected: null,
    checked: false,
    correct: 0,
    errors: 0,
    practice: false,
  };
  if (!quiz.questions?.length) { quiz = null; return; }
  resetQuestionTimer();
  openModal(data.studyGuide && !customQuestions ? `${lesson.module.title} · Lição ${lesson.index + 1} de ${lessons.filter(l => l.module.id === lesson.module.id).length}` : lesson.title);
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
}

function restartLesson() {
  if (!quiz || quiz.practice) return;
  startLesson(quiz.lesson.id, quiz.questions);
}

function startPractice() {
  if (state.pendingPractice) { resumeSavedPractice(); return; }
  const filters = practiceFilters();
  const pool = shuffle(filteredPracticeQuestions(filters));
  if (!pool.length) { showToast("Nenhuma questão corresponde aos filtros. Ajuste sua seleção."); return; }
  quiz = {
    practice: true, filters: { ...filters }, queue: pool.slice(1).map(q => q.id), cycle: 1,
    lesson: { title: "Prática contínua", module: { title: data.title } },
    questions: [pool[0]], index: 0, selected: null, checked: false, correct: 0,
    answeredCount: 0, skipped: 0, totalDurationMs: 0,
    paused: false, questionRecorded: false, sessionTimerStartedAt: null, lastCheckpointAt: Date.now(),
    session: { id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, courseId: data.id, courseTitle: data.title,
      startedAt: new Date().toISOString(), endedAt: null, activeMs: 0, filters: { ...filters }, records: [] },
  };
  sessionReport = null;
  resetQuestionTimer();
  startSessionTimer();
  checkpointPractice();
  openModal("Sessão de prática");
  renderQuestion();
  modal.querySelector("h1").focus({ preventScroll: true });
}

function renderQuestion() {
  if (quiz.practice && quiz.paused) {
    modal.innerHTML = `<div class="quiz-shell"><section class="practice-pause-card"><p class="page-kicker">Seu tempo está preservado</p><h1 tabindex="-1">Sessão pausada</h1><p>${escapeHtml(quiz.session.courseTitle)} · ${counted(quiz.answeredCount, "resposta verificada", "respostas verificadas")}</p><div class="session-clock"><small>Tempo ativo</small><strong>${formatClock(sessionElapsed())}</strong></div><p>A questão e suas respostas estão salvas. O cronômetro só continua quando você retomar.</p><div class="session-report-actions"><button class="button" data-action="resume-practice">Continuar sessão</button><button class="button secondary" data-action="save-practice-exit">Salvar e sair</button><button class="text-button" data-action="end-practice">Encerrar e ver relatório</button></div></section></div>`;
    return;
  }
  const question = quiz.questions[quiz.index];
  const progress = ((quiz.index + (quiz.checked ? 1 : 0)) / quiz.questions.length) * 100;
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="quiz-topbar">
        ${quiz.practice ? `<button class="text-button" data-action="end-practice">Encerrar sessão</button><span class="session-counter">${counted(quiz.answeredCount, "respondida")} · ${counted(quiz.correct, "acerto")}</span><span class="session-round">Rodada ${quiz.cycle}</span>` : `<button class="icon-button" data-action="close-quiz" aria-label="Fechar lição">×</button><div class="quiz-progress" aria-label="Progresso da lição"><span style="width:${progress}%"></span></div><div class="quiz-errors" role="status" aria-label="${counted(quiz.errors, "erro")} nesta tentativa; limite de ${MAX_LESSON_ERRORS}">Erros ${quiz.errors}/${MAX_LESSON_ERRORS}</div>`}
      </div>
      ${quiz.practice ? practiceTimerMarkup() : ""}
      ${quiz.practice ? "" : `<p class="lesson-rule">Até ${MAX_LESSON_ERRORS} erros para concluir. Ao reiniciar a lição, a contagem volta a zero.</p>`}
      <div class="question-wrap">
        <div class="question-meta"><span>${escapeHtml(question.subjectTitle || data.title)} · ${escapeHtml(question.moduleTitle || quiz.lesson.module.title)}</span><span>ENEM ${question.year} · Questão ${question.index}</span></div>
        <div class="question-tools">${triMarkup(question)}<button class="text-button favorite-button" data-action="favorite" aria-pressed="${state.favorites.includes(question.id)}">${state.favorites.includes(question.id) ? "★ Favorita" : "☆ Favoritar"}</button></div>
        ${question.skill ? `<div class="question-skill"><strong>${({matematica: "MT", "ciencias-natureza": "CN", "ciencias-humanas": "CH", linguagens: "LC"})[question.areaId]} · C${question.competency} · H${question.skill}</strong><span>${escapeHtml(catalog.matrix.areas[question.areaId].competencies.find(c => c.number === question.competency).skills.find(s => s.number === question.skill).description)}</span><small>Associação editorial à matriz do INEP</small></div>` : ""}
        ${question.context ? `<div class="question-context" lang="${question.language === "ingles" ? "en" : question.language === "espanhol" ? "es" : "pt-BR"}">${renderMarkdown(question.context, question.areaId === "linguagens")}</div>` : ""}
        <h1 tabindex="-1">${renderMathText(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1>
        <div class="answers">
          ${question.alternatives.map((alternative) => {
            let status = quiz.selected === alternative.letter ? "selected" : "";
            if (quiz.checked && alternative.letter === question.correctAlternative) status = "correct";
            else if (quiz.checked && quiz.selected === alternative.letter) status = "wrong";
            const body = alternative.file
              ? `<img src="${escapeHtml(alternative.file)}" alt="Alternativa ${alternative.letter}" style="max-width:100%;max-height:180px">`
              : renderMathText(alternative.text || "Alternativa com imagem");
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
  if (!explanation?.concept || !Array.isArray(explanation.steps) || !explanation.steps.length) {
    return `<section class="explanation" aria-labelledby="explanation-title" tabindex="-1">
      <p class="page-kicker">Gabarito da questão</p>
      <h2 id="explanation-title">Alternativa correta: ${escapeHtml(question.correctAlternative)}</h2>
      <div class="correct-answer"><strong>Alternativa ${escapeHtml(question.correctAlternative)}</strong>${correctAnswer?.text ? `<p>${renderMathText(correctAnswer.text)}</p>` : ""}${correctAnswer?.file ? `<img src="${escapeHtml(correctAnswer.file)}" alt="Resposta correta, alternativa ${escapeHtml(question.correctAlternative)}">` : ""}</div>
      <p>Esta questão foi importada do acervo enem.dev e ainda não possui resolução comentada revisada no app. O gabarito informa a alternativa correta; a justificativa será exibida quando estiver disponível.</p>
      ${/^https:\/\/(?:api\.)?enem\.dev(?:\/|$)/.test(question.sourceUrl || "") ? `<a class="source-link" href="${escapeHtml(question.sourceUrl)}" target="_blank" rel="noreferrer">Consultar questão na fonte ↗</a>` : ""}
    </section>`;
  }
  return `<section class="explanation" aria-labelledby="explanation-title" tabindex="-1">
    <p class="page-kicker">${renderMathText(explanation.concept)}</p>
    <h2 id="explanation-title">Por que a alternativa ${escapeHtml(question.correctAlternative)} está correta?</h2>
    <div class="correct-answer"><strong>Alternativa ${escapeHtml(question.correctAlternative)}</strong>${correctAnswer.text ? `<p>${renderMathText(correctAnswer.text)}</p>` : ""}${correctAnswer.file ? `<img src="${escapeHtml(correctAnswer.file)}" alt="Resposta correta, alternativa ${question.correctAlternative}">` : ""}</div>
    <ol>${explanation.steps.map((step) => `<li>${renderMathText(step)}</li>`).join("")}</ol>
    <p class="takeaway"><strong>Guarde esta ideia:</strong> ${renderMathText(explanation.takeaway)}</p>
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
        <div class="feedback-copy" role="status"><strong>${correct ? "Mandou bem! +10 XP" : `Resposta correta: ${question.correctAlternative}`}</strong><span>${!quiz.practice && quiz.errors > MAX_LESSON_ERRORS ? "Limite de erros excedido. Leia a resolução antes de reiniciar." : question.explanation?.steps?.length ? "Confira a resolução comentada antes de continuar." : "Gabarito disponível; resolução comentada ainda não revisada."}</span></div>
        <button class="button ${correct ? "" : "danger"}" data-action="next-question">${quiz.practice ? "Próxima questão" : quiz.errors > MAX_LESSON_ERRORS ? "Ver resultado" : quiz.index === quiz.questions.length - 1 ? "Finalizar" : "Continuar"}</button>
      </div>
    </footer>
  `;
}

function selectAnswer(letter) {
  if (!quiz || quiz.checked || quiz.ended || quiz.paused) return;
  quiz.selected = letter;
  if (quiz.practice) checkpointPractice();
  renderQuestion();
}

function checkAnswer() {
  if (!quiz?.selected || quiz.checked || quiz.ended || quiz.paused) return;
  const question = quiz.questions[quiz.index];
  const correct = quiz.selected === question.correctAlternative;
  stopQuestionTimer();
  recordAttempt(question, correct);
  if (quiz.practice) appendSessionRecord("answered", correct);
  quiz.checked = true;
  if (quiz.practice) { quiz.answeredCount += 1; quiz.totalDurationMs += quiz.elapsedMs; }
  state.answered.push(question.id);
  if (correct) {
    quiz.correct += 1;
    state.xp += 10;
    state.todayXp += 10;
    state.missed = state.missed.filter((id) => id !== question.id);
  } else {
    if (!quiz.practice) quiz.errors += 1;
    if (!state.missed.includes(question.id)) state.missed.push(question.id);
  }
  saveState();
  if (quiz.practice) checkpointPractice();
  renderQuestion();
  const explanation = modal.querySelector(".explanation");
  explanation.focus({ preventScroll: true });
  explanation.scrollIntoView({ block: "start", behavior: "smooth" });
}

function nextQuestion() {
  if (!quiz?.checked || quiz.ended || quiz.paused) return;
  if (quiz.practice) { advancePractice(); return; }
  if (quiz.errors > MAX_LESSON_ERRORS) { finishLesson(); return; }
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
  if (!quiz || quiz.practice || quiz.ended || !quiz.checked) return;
  const passed = quiz.errors <= MAX_LESSON_ERRORS;
  if (passed && quiz.index !== quiz.questions.length - 1) return;
  quiz.ended = true;
  quiz.passed = passed;
  const lesson = quiz.lesson;
  const isCourseLesson = lessons.some((item) => item.id === lesson.id);
  const newlyCompleted = passed && isCourseLesson && !state.completed.includes(lesson.id);
  const earnedBonus = newlyCompleted && lessonCredits(lesson).length === 0;
  if (newlyCompleted) state.completed.push(lesson.id);
  if (earnedBonus) {
    state.xp += 20;
    state.todayXp += 20;
  }
  const following = data.studyGuide && passed ? pendingUnitLesson(lesson.module.id) : null;
  markStudyDay();
  const accuracy = Math.round((quiz.correct / (quiz.index + 1)) * 100);
  saveState();
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="finish-card">
        <div class="finish-burst" aria-hidden="true">${passed ? accuracy >= 80 ? "🏆" : "⚛️" : "↻"}</div>
        <h1 tabindex="-1">${passed ? "Lição concluída!" : "Limite de erros excedido"}</h1>
        <p>${passed ? `Aprovado com ${counted(quiz.errors, "erro")}.` : `Você cometeu ${quiz.errors} erros; o limite é ${MAX_LESSON_ERRORS}. Reinicie para tentar novamente com a contagem zerada.`}</p>
        ${passed ? "" : '<p>Suas respostas e os XP por acerto foram salvos. Esta tentativa não conclui a lição nem libera a próxima.</p>'}
        <div class="finish-stats">
          <div class="finish-stat"><strong>${accuracy}%</strong><span>Precisão</span></div>
          <div class="finish-stat"><strong>+${quiz.correct * 10 + (earnedBonus ? 20 : 0)}</strong><span>XP ganho</span></div>
        </div>
        ${passed ? "" : '<button class="button" data-action="restart-lesson">Reiniciar lição</button>'}
        ${data.studyGuide && passed ? `<p>${following ? "Seu progresso nesta unidade foi salvo." : "Unidade concluída! Escolha o próximo tema quando quiser."}</p>${following ? `<button class="button" data-lesson="${following.id}">Próxima lição</button>` : ""}` : ""}
        <button class="${passed && !following ? "button" : "text-button finish-back"}" data-action="finish">${data.studyGuide ? "Voltar aos temas" : "Voltar à trilha"}</button>
      </div>
    </div>
  `;
  modal.querySelector("h1").focus({ preventScroll: true });
  modal.scrollTo({ top: 0, behavior: "smooth" });
}

function closeQuiz(preservePractice = false) {
  if (quiz?.practice && !quiz.ended) {
    if (preservePractice) { quiz.paused = true; checkpointPractice(); }
    else endPractice();
  }
  stopQuestionTimer();
  stopSessionTimer();
  modal.hidden = true;
  modal.innerHTML = "";
  document.body.style.overflow = "";
  shell.inert = false;
  quiz = null;
  sessionReport = null;
  introModuleId = null;
  const introId = returnFocus?.dataset?.intro;
  renderPage(!introId && !data.studyGuide);
  const focusTarget = data.studyGuide && activeView === "aprender" ? app.querySelector(".study-detail h2") : introId ? app.querySelector(`[data-intro="${introId}"]`) : app.querySelector("h1");
  if (focusTarget) { focusTarget.tabIndex = focusTarget.matches("button") ? 0 : -1; focusTarget.focus({ preventScroll: true }); }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

document.addEventListener("click", (event) => {
  const practiceArea = event.target.closest("[data-practice-area]");
  if (practiceArea && ["matematica", "ciencias-natureza", "ciencias-humanas", "linguagens"].includes(practiceArea.dataset.practiceArea)) {
    setCourse(practiceArea.dataset.practiceArea);
    activeView = "praticar";
    history.replaceState(null, "", "#praticar");
    renderPage();
    app.querySelector("#course-select").focus({ preventScroll: true });
    return;
  }
  const reportLink = event.target.closest("[data-session-report]");
  if (reportLink) { openSessionReport(reportLink.dataset.sessionReport); return; }
  const dimensionButton = event.target.closest("[data-session-dimension]");
  if (dimensionButton && sessionReport) {
    renderSessionReport(sessionReport, dimensionButton.dataset.sessionDimension);
    modal.querySelector(`[data-session-dimension="${sessionBreakdown}"]`).focus({ preventScroll: true });
    return;
  }
  const reviewButton = event.target.closest("[data-session-question]");
  if (reviewButton) { reviewSessionQuestion(reviewButton.dataset.sessionQuestion); return; }
  const focusButton = event.target.closest("[data-session-focus]");
  if (focusButton) { focusSessionRecommendation(Number(focusButton.dataset.sessionFocus)); return; }
  const view = event.target.closest("[data-view]");
  if (view) {
    event.preventDefault();
    activeView = view.dataset.view;
    history.replaceState(null, "", `#${activeView}`);
    renderPage();
    return;
  }
  const studyButton = event.target.closest("[data-study-unit]");
  if (studyButton) { selectStudyUnit(studyButton.dataset.studyUnit); return; }
  const practiceButton = event.target.closest("[data-practice-unit]");
  if (practiceButton) { practiceUnit(practiceButton.dataset.practiceUnit); return; }
  const lessonButton = event.target.closest("[data-lesson]");
  if (lessonButton) startLesson(lessonButton.dataset.lesson);
  const introButton = event.target.closest("[data-intro]");
  if (introButton) openIntroduction(introButton.dataset.intro);
  const answer = event.target.closest("[data-answer]");
  if (answer) selectAnswer(answer.dataset.answer);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "continue") {
    if (data.studyGuide) {
      const module = selectedStudyModule();
      const next = pendingUnitLesson(module.id);
      if (!state.introductionsRead.includes(module.id) || !next) openIntroduction(module.id); else startLesson(next.id);
    } else startLesson(nextLesson().id);
  }
  if (action === "practice") startPractice();
  if (action === "pause-practice") pausePractice();
  if (action === "resume-practice") resumePractice();
  if (action === "resume-saved-practice") resumeSavedPractice();
  if (action === "save-practice-exit") closeQuiz(true);
  if (action === "back-session-report" && sessionReport) { renderSessionReport(sessionReport, sessionBreakdown); modal.scrollTo({ top: 0, behavior: "instant" }); modal.querySelector("h1").focus({ preventScroll: true }); }
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
  if (action === "restart-lesson") restartLesson();
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
  if (document.hidden) { stopQuestionTimer(); stopSessionTimer(); checkpointPractice(); }
  else { startQuestionTimer(); startSessionTimer(); updatePracticeClocks(); }
});

window.addEventListener("pagehide", () => {
  if (quiz?.practice && !quiz.ended) { quiz.paused = true; checkpointPractice(); }
  else stopQuestionTimer();
});
window.addEventListener("pageshow", () => {
  if (quiz?.practice && quiz.paused && !quiz.ended && !modal.hidden) renderQuestion();
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
    const available = new Set(allCatalogQuestions().map(question => question.id));
    state.missed = state.missed.filter(id => available.has(id));
    setCourse(state.activeCourse);
    renderPage();
  } catch (error) {
    app.innerHTML = `<div class="notice" style="margin-top:40px"><strong>Falha ao iniciar.</strong><br>${escapeHtml(error.message)} Recarregue a página ou verifique se o site está sendo servido por HTTP.</div>`;
  }
}

init();
