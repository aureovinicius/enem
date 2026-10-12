const DATA_URL = "/data/physics-questions.json";
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

let data;
let lessons = [];
let activeView = location.hash.slice(1) || "aprender";
let quiz = null;

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
    answered: [],
    missed: [],
  };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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
    const lessonCount = Math.max(1, Math.min(4, Math.ceil(questions.length / 5)));
    return Array.from({ length: lessonCount }, (_, index) => {
      const start = index * 5;
      const lessonQuestions = questions.slice(start, start + 5);
      const lesson = {
        id: `${module.id}-${index + 1}`,
        module,
        moduleIndex,
        index,
        globalIndex: globalIndex++,
        title: ["Fundamentos", "Aplicações", "Desafio ENEM", "Domínio"][index],
        questions: lessonQuestions.length ? lessonQuestions : questions.slice(0, 5),
      };
      return lesson;
    });
  });
}

function isUnlocked(lesson) {
  return lesson.globalIndex === 0 || state.completed.includes(lessons[lesson.globalIndex - 1]?.id);
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
  const course = Math.round((state.completed.length / Math.max(lessons.length, 1)) * 100);
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
      <p>${state.completed.length} de ${lessons.length} lições concluídas.</p>
      <div class="progress-row"><span>Física</span><span>${course}%</span></div>
      <div class="progress-track"><div class="progress-fill" style="width:${course}%;background:var(--green)"></div></div>
      <button class="button" data-action="continue">Continuar</button>
    </section>
    <section class="rail-card">
      <h3>Questões reais</h3>
      <p class="tiny">${data.total} questões indexadas como Física, de 2009 a 2023.</p>
      <p class="tiny" style="margin-top:9px"><a class="source-link" href="https://enem.dev" target="_blank" rel="noreferrer">Fonte: enem.dev ↗</a></p>
    </section>
  `;
}

function pageHeader(kicker, title, subtitle) {
  return `
    <div class="mobile-stats">${statMarkup()}</div>
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
    ${pageHeader("Trilha de Física", "Do conceito à prova.", "Avance em lições curtas, ganhe XP e pratique com questões reais do ENEM.")}
    <div class="course-toolbar">
      <div class="course-pill"><span class="course-dot"></span> Física · ENEM</div>
      <button class="button" data-lesson="${next.id}">Continuar trilha</button>
    </div>
    <div class="path">
      ${grouped.map(({ module, lessons: moduleLessons }, moduleIndex) => {
        const [color, dark] = modulePalette[module.id] || modulePalette.mecanica;
        const completed = moduleLessons.filter((lesson) => state.completed.includes(lesson.id)).length;
        return `
          <section class="unit" style="--unit-color:${color};--unit-dark:${dark}">
            <div class="unit-banner">
              <div class="unit-title-wrap">
                <span class="unit-emoji">${module.emoji}</span>
                <div><h2>Unidade ${moduleIndex + 1} · ${module.title}</h2><p>${moduleDescriptions[module.id]}</p></div>
              </div>
              <span class="unit-count">${completed}/${moduleLessons.length} lições</span>
            </div>
            <div class="lesson-path">
              ${moduleLessons.map((lesson) => {
                const complete = state.completed.includes(lesson.id);
                const unlocked = isUnlocked(lesson);
                const current = unlocked && !complete && lesson.id === next.id;
                const icon = complete ? "✓" : unlocked ? ["▸", "◆", "★", "♛"][lesson.index] : "🔒";
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

function renderPractice() {
  const missed = state.missed.length;
  app.innerHTML = `
    ${pageHeader("Revisão inteligente", "Treine seus pontos fracos.", "O modo prática prioriza questões que você errou e completa a sessão com novos desafios.")}
    <section class="feature-card">
      <div>
        <span class="course-pill"><span class="course-dot"></span> Sessão de 5 questões</span>
        <h2 style="margin-top:18px">Prática personalizada</h2>
        <p>${missed ? `Você tem ${missed} ${missed === 1 ? "questão" : "questões"} para revisar.` : "Sem erros pendentes. Vamos misturar questões de toda a trilha."}</p>
        <button class="button blue" data-action="practice">Começar prática</button>
      </div>
      <div class="practice-visual" aria-hidden="true"><div class="practice-atom">⚛</div></div>
    </section>
    <div class="notice">Dica: revisar um erro logo depois da tentativa ajuda a consolidar o caminho de resolução, não só a alternativa correta.</div>
  `;
}

function renderAchievements() {
  const achievements = [
    ["🚀", "Primeira órbita", "Conclua sua primeira lição.", state.completed.length >= 1],
    ["🔥", "Em chamas", "Mantenha uma sequência de 3 dias.", state.streak >= 3],
    ["⚡", "Alta tensão", "Acumule 200 XP.", state.xp >= 200],
    ["🎯", "Precisão", "Responda 20 questões.", state.answered.length >= 20],
    ["🏅", "Meio caminho", "Conclua metade da trilha.", state.completed.length >= Math.ceil(lessons.length / 2)],
    ["🧠", "Mestre da Física", "Conclua toda a trilha.", state.completed.length >= lessons.length],
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
      <article class="info-card"><div class="big-number">${data.total}</div><h3>questões de Física</h3><p>Um índice auditável seleciona questões de Ciências da Natureza por evidências no texto.</p></article>
      <article class="info-card"><div class="big-number">15</div><h3>anos de prova</h3><p>As questões mantêm o ano, o número, o enunciado, as alternativas e o gabarito original.</p></article>
      <article class="info-card"><div class="big-number">100%</div><h3>progresso local</h3><p>XP, sequência, corações e lições concluídas ficam salvos apenas neste navegador.</p></article>
    </div>
    <div class="notice"><strong>Fonte:</strong> <a class="source-link" href="https://enem.dev" target="_blank" rel="noreferrer">enem.dev</a>, projeto comunitário sem vínculo com INEP ou MEC. O código da API de origem é GPL-2.0. O Fisio não é afiliado ao Duolingo.</div>
  `;
}

function renderPage() {
  document.querySelectorAll("[data-view]").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === activeView);
  });
  if (activeView === "praticar") renderPractice();
  else if (activeView === "conquistas") renderAchievements();
  else if (activeView === "sobre") renderAbout();
  else renderLearn();
  renderRail();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shuffle(items) {
  return [...items].sort(() => Math.random() - 0.5);
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
  };
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  renderQuestion();
}

function startPractice() {
  const missed = state.missed
    .map((id) => data.questions.find((question) => question.id === id))
    .filter(Boolean);
  const filler = shuffle(data.questions.filter((question) => !state.missed.includes(question.id)));
  startLesson(null, shuffle([...missed, ...filler]).slice(0, 5));
}

function renderQuestion() {
  const question = quiz.questions[quiz.index];
  const progress = ((quiz.index + (quiz.checked ? 1 : 0)) / quiz.questions.length) * 100;
  modal.innerHTML = `
    <div class="quiz-shell">
      <div class="quiz-topbar">
        <button class="icon-button" data-action="close-quiz" aria-label="Fechar lição">×</button>
        <div class="quiz-progress" aria-label="Progresso da lição"><span style="width:${progress}%"></span></div>
        <div class="quiz-hearts">♥ ${state.hearts}</div>
      </div>
      <div class="question-wrap">
        <div class="question-meta"><span>${escapeHtml(question.moduleTitle || quiz.lesson.module.title)}</span><span>ENEM ${question.year} · Questão ${question.index}</span></div>
        <h1>${escapeHtml(question.alternativesIntroduction || "Qual é a alternativa correta?")}</h1>
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
      </div>
      ${renderQuizFooter(question)}
    </div>
  `;
}

function renderQuizFooter(question) {
  if (!quiz.checked) {
    return `<footer class="quiz-footer"><div class="quiz-footer-inner"><button class="button" data-action="check" ${quiz.selected ? "" : "disabled"}>Verificar</button></div></footer>`;
  }
  const correct = quiz.selected === question.correctAlternative;
  return `
    <footer class="quiz-footer ${correct ? "success" : "error"}">
      <div class="quiz-footer-inner">
        <div class="feedback-copy"><strong>${correct ? "Mandou bem! +10 XP" : `Resposta correta: ${question.correctAlternative}`}</strong><span>${correct ? "Seu raciocínio está no caminho certo." : "Revise o enunciado e tente reconhecer a ideia física central."}</span></div>
        <button class="button ${correct ? "" : "danger"}" data-action="next-question">${quiz.index === quiz.questions.length - 1 ? "Finalizar" : "Continuar"}</button>
      </div>
    </footer>
  `;
}

function selectAnswer(letter) {
  if (quiz.checked) return;
  quiz.selected = letter;
  renderQuestion();
}

function checkAnswer() {
  if (!quiz.selected || quiz.checked) return;
  const question = quiz.questions[quiz.index];
  const correct = quiz.selected === question.correctAlternative;
  quiz.checked = true;
  state.answered.push(question.id);
  if (correct) {
    quiz.correct += 1;
    state.xp += 10;
    state.todayXp += 10;
    state.missed = state.missed.filter((id) => id !== question.id);
  } else {
    state.hearts = Math.max(0, state.hearts - 1);
    if (!state.missed.includes(question.id)) state.missed.push(question.id);
  }
  saveState();
  renderQuestion();
}

function nextQuestion() {
  if (quiz.index < quiz.questions.length - 1) {
    quiz.index += 1;
    quiz.selected = null;
    quiz.checked = false;
    renderQuestion();
    modal.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  finishLesson();
}

function finishLesson() {
  const lesson = quiz.lesson;
  const isCourseLesson = lessons.some((item) => item.id === lesson.id);
  if (isCourseLesson && !state.completed.includes(lesson.id)) {
    state.completed.push(lesson.id);
    state.xp += 20;
    state.todayXp += 20;
  }
  const today = localDay();
  if (state.lastStudyDay !== today) {
    const yesterday = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(Date.now() - 36 * 60 * 60 * 1000));
    state.streak = state.lastStudyDay === yesterday ? state.streak + 1 : 1;
    state.lastStudyDay = today;
  }
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
          <div class="finish-stat"><strong>+${quiz.correct * 10 + (isCourseLesson ? 20 : 0)}</strong><span>XP ganho</span></div>
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
  quiz = null;
  renderPage();
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
  const answer = event.target.closest("[data-answer]");
  if (answer) selectAnswer(answer.dataset.answer);
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (action === "continue") startLesson(nextLesson().id);
  if (action === "practice") startPractice();
  if (action === "close-quiz") {
    closeQuiz();
    showToast("Seu progresso da lição não foi salvo.");
  }
  if (action === "check") checkAnswer();
  if (action === "next-question") nextQuestion();
  if (action === "finish") closeQuiz();
});

window.addEventListener("hashchange", () => {
  activeView = location.hash.slice(1) || "aprender";
  renderPage();
});

async function init() {
  app.innerHTML = `<div class="loading"><div><div class="loader"></div>Carregando sua trilha…</div></div>`;
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error("Não foi possível carregar a base de Física.");
    data = await response.json();
    makeLessons();
    renderPage();
  } catch (error) {
    app.innerHTML = `<div class="notice" style="margin-top:40px"><strong>Falha ao iniciar.</strong><br>${escapeHtml(error.message)} Recarregue a página ou verifique se o site está sendo servido por HTTP.</div>`;
  }
}

init();
