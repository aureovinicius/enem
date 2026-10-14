import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { buildPracticeReport } from "../dist/practice-session.js";
import { createRequire } from "node:module";
const katex = createRequire(import.meta.url)("../dist/vendor/katex/katex.min.js");

const data = JSON.parse(readFileSync("dist/data/physics-questions.json", "utf8"));
const catalog = JSON.parse(readFileSync("dist/data/courses.json", "utf8"));
const source = readFileSync("dist/app.js", "utf8").replace(/^import .*practice-session.*\n/m, "").replace(/\ninit\(\);\s*$/, "");

function appHarness(saved) {
  const nodes = new Map();
  const node = () => ({ innerHTML: "", hidden: true, dataset: {}, setAttribute() {}, focus() {}, matches() { return false; }, scrollIntoView() {}, scrollTo() {}, querySelector() { return node(); }, classList: { add() {}, remove() {} } });
  const storage = new Map(saved ? [["fisio-progress-v1", JSON.stringify(saved)]] : []);
  const context = vm.createContext({
    document: { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, querySelectorAll() { return []; }, addEventListener() {}, body: { style: {} }, activeElement: node() },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    location: { hash: "" }, window: { katex, addEventListener() {}, scrollTo() {} }, history: { replaceState() {} },
    Intl, Date, setTimeout() {}, setInterval() { return 1; }, clearInterval() {}, structuredClone, buildPracticeReport,
  });
  vm.runInContext(source, context);
  context.inputCatalog = catalog;
  vm.runInContext("catalog = inputCatalog; setCourse(state.activeCourse);", context);
  return { run: (code) => vm.runInContext(code, context), nodes, storage };
}

test("every active question has a specific resolution, valid answer and a conceptual introduction", () => {
  assert.equal(data.total, data.questions.length);
  assert.equal(data.modules.length, 5);
  for (const module of data.modules) {
    assert.ok(module.introduction.title);
    assert.ok(module.introduction.sections.length >= 3);
    assert.ok(module.introduction.example.steps.length >= 2);
    assert.ok(module.introduction.pitfall);
  }
  const uniqueSteps = new Set();
  for (const question of data.questions) {
    assert.ok(question.alternatives.some((a) => a.letter === question.correctAlternative), question.id);
    assert.ok(question.explanation?.concept, question.id);
    assert.ok(question.explanation.steps.length >= 2, question.id);
    assert.ok(question.explanation.steps.every((step) => typeof step === "string" && step.length > 30), question.id);
    assert.ok(question.explanation.takeaway.length > 25, question.id);
    const steps = JSON.stringify(question.explanation.steps);
    assert.ok(!uniqueSteps.has(steps), `Repeated generic explanation: ${question.id}`);
    uniqueSteps.add(steps);
  }
});

test("review exclusions are traceable and never enter lessons or practice", () => {
  const report = JSON.parse(readFileSync("data/learning/review-report.json", "utf8"));
  const all = Object.assign({}, ...readdirSync("data/learning").filter((f) => f.startsWith("explanations-")).map((f) => JSON.parse(readFileSync(`data/learning/${f}`, "utf8"))));
  assert.equal(report.published + report.excluded.length, report.candidates);
  for (const excluded of report.excluded) {
    assert.ok(excluded.reason);
    assert.ok(!data.questions.some((q) => q.id === excluded.id));
  }
  for (const question of data.questions) assert.ok(all[question.id] && !all[question.id].excludeReason);
});

test("five introduction topics are accessible and reading progress survives reload", () => {
  const app = appHarness({ xp: 140, completed: ["mecanica-1"] });
  app.run("renderLearn()");
  assert.equal((app.nodes.get("#app").innerHTML.match(/data-intro=/g) || []).length, 5);
  for (const module of data.modules) {
    app.run(`openIntroduction(${JSON.stringify(module.id)})`);
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes(module.introduction.title));
    app.run("completeIntroduction()");
  }
  const saved = JSON.parse(app.storage.get("fisio-progress-v1"));
  assert.equal(saved.introductionsRead.length, 5);
  assert.equal(saved.xp, 140);
  assert.deepEqual(saved.completed, ["mecanica-1"]);
  const reloaded = appHarness(saved);
  reloaded.run("renderLearn()");
  assert.equal((reloaded.nodes.get("#app").innerHTML.match(/Lida · Revisar conceitos/g) || []).length, 5);
});

for (const correct of [true, false]) {
  test(`resolution appears only after checking a ${correct ? "correct" : "wrong"} answer, including in practice`, () => {
    const app = appHarness();
    app.run("startLesson(null, data.questions.slice(0, 2))");
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
    app.run(correct ? "selectAnswer(quiz.questions[0].correctAlternative)" : "selectAnswer(quiz.questions[0].alternatives.find(a => a.letter !== quiz.questions[0].correctAlternative).letter)");
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
    app.run("checkAnswer()");
    const rendered = app.nodes.get("#lesson-modal").innerHTML;
    assert.ok(rendered.includes(`Por que a alternativa ${data.questions[0].correctAlternative}`));
    assert.ok(rendered.includes(app.run("renderMathText(quiz.questions[0].explanation.steps[0])")));
    assert.equal(app.run("state.answered.length"), 1);
    app.run("checkAnswer()");
    assert.equal(app.run("state.answered.length"), 1);
    app.run("nextQuestion()");
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
  });
}

test("question context is displayed before its bold prompt", () => {
  const app = appHarness();
  app.run("startLesson(null, [data.questions.find(question => question.context)])");
  const rendered = app.nodes.get("#lesson-modal").innerHTML;
  const contextIndex = rendered.indexOf('class="question-context"');
  const promptIndex = rendered.indexOf('<h1 tabindex="-1">');
  assert.ok(contextIndex >= 0);
  assert.ok(promptIndex > contextIndex);
});

test("practice can target pending errors without adding unrelated questions", () => {
  const missed = data.questions.slice(0, 2).map(q => q.id);
  const app = appHarness({ missed, practiceFilters: { fisica: { status: "wrong" } } });
  app.run("startPractice()");
  const chosen = JSON.parse(app.run("JSON.stringify([...quiz.questions.map(q => q.id), ...quiz.queue])"));
  assert.deepEqual(new Set(chosen), new Set(missed));
  assert.equal(app.run("quiz.practice"), true);
});

test("all thirteen courses have complete introductions, explanations and unique question references", () => {
  assert.deepEqual(catalog.courses.map((c) => c.id), ["fisica", "quimica", "biologia", "matematica", "geografia", "historia", "portugues", "literatura", "ingles", "espanhol", "ciencias-natureza", "ciencias-humanas", "linguagens"]);
  assert.equal(catalog.total, catalog.questions.length);
  assert.equal(new Set(catalog.questions.map((q) => q.id)).size, catalog.total);
  const explanations = new Set();
  const originals = JSON.parse(readFileSync("data/enem/all-questions.json", "utf8")).questions;
  for (const q of catalog.questions) {
    const original = originals.find((o) => `${o.year}-${o.index}${o.language ? `-${o.language}` : ""}` === q.id && o.discipline === q.areaId);
    assert.ok(original, q.id);
    assert.equal(q.correctAlternative, original.correctAlternative);
    assert.deepEqual(q.alternatives.map((a) => [a.letter, a.text, a.isCorrect]), original.alternatives.map((a) => [a.letter, a.text, a.isCorrect]));
    assert.ok(q.explanation.concept && q.explanation.takeaway, q.id);
    assert.ok(q.explanation.steps.length >= 2 && q.explanation.steps.every((s) => s.length > 25), q.id);
    const steps = JSON.stringify(q.explanation.steps);
    assert.ok(!explanations.has(steps), `Generic duplicate ${q.id}`);
    explanations.add(steps);
    const c = catalog.matrix.areas[q.areaId].competencies.find((c) => c.number === q.competency);
    assert.ok(c.skills.some((s) => s.number === q.skill), q.id);
    for (const asset of JSON.stringify(q).match(/\/assets\/questions\/\d+\/\d+\/[^\s"\\)]+\.(?:png|jpg|jpeg|webp|gif)/gi) || []) {
      assert.ok(readFileSync(`dist${asset}`).byteLength > 0, asset);
    }
  }
  const moduleIds = new Set();
  for (const c of catalog.courses) {
    assert.equal(c.questionIds.length, c.total);
    assert.equal(new Set(c.questionIds).size, c.total);
    assert.ok(c.questionIds.every((id) => catalog.questions.some((q) => q.id === id)));
    for (const m of c.modules) {
      assert.ok(!moduleIds.has(m.id));
      moduleIds.add(m.id);
      assert.ok(m.introduction.sections.length >= 3 && m.introduction.example.steps.length >= 2 && m.introduction.pitfall);
    }
  }
  assert.equal(moduleIds.size, catalog.courses.reduce((total, course) => total + course.modules.length, 0));
});

test("Natureza is exactly the union of Physics, Chemistry and Biology without duplicating records", () => {
  const scienceCourses = catalog.courses.filter((c) => ["fisica", "quimica", "biologia"].includes(c.id));
  const union = new Set(scienceCourses.flatMap((c) => c.questionIds));
  const nature = catalog.courses.find((c) => c.id === "ciencias-natureza");
  assert.deepEqual(new Set(nature.questionIds), union);
  assert.equal(union.size, scienceCourses.reduce((total, c) => total + c.total, 0));
  assert.ok(nature.questionIds.every((id) => catalog.questions.find((q) => q.id === id).areaId === "ciencias-natureza"));
});

test("Humanas combines both subjects and complementary Philosophy and Sociology without duplicate records", () => {
  const humanities = catalog.courses.find(c => c.id === "ciencias-humanas");
  assert.equal(humanities.modules.length, 6);
  assert.equal(humanities.total, 200);
  const expected = new Set();
  for (const id of ["geografia", "historia"]) {
    const course = catalog.courses.find(c => c.id === id);
    assert.equal(course.total, 80);
    for (const questionId of course.questionIds) expected.add(questionId);
  }
  const complementary = catalog.questions.filter(q => ["filosofia", "sociologia"].includes(q.subjectId));
  assert.equal(complementary.length, 40);
  assert.deepEqual(new Set(complementary.map(q => q.subjectTitle)), new Set(["Filosofia", "Sociologia"]));
  for (const q of complementary) expected.add(q.id);
  assert.deepEqual(new Set(humanities.questionIds), expected);
  assert.ok(humanities.questionIds.every(id => catalog.questions.find(q => q.id === id).areaId === "ciencias-humanas"));
  assert.equal(catalog.total, 1140);
});

test("Humanas practice uses its competency topics and displays CH references and explanations", () => {
  const course = catalog.courses.find(c => c.id === "ciencias-humanas");
  for (const module of course.modules) {
    const app = appHarness({activeCourse: course.id, practiceFilters: {[course.id]: {module: module.id, competency: String(module.competency)}}});
    app.run("startPractice()");
    assert.ok(app.run("quiz.questions.length > 0"), module.id);
    const ids = JSON.parse(app.run("JSON.stringify([...quiz.questions.map(q => q.id), ...quiz.queue])"));
    const expected = catalog.questions.filter(q => q.areaId === "ciencias-humanas" && q.competency === module.competency).map(q => q.id);
    assert.deepEqual(new Set(ids), new Set(expected));
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes(`CH · C${module.competency}`));
    app.run("selectAnswer(quiz.questions[0].correctAlternative); checkAnswer()");
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
    assert.equal(app.run("state.attempts.length"), 1);
  }
});

test("Geography and History share error review and statistics with Humanas while lesson progress stays separate", () => {
  for (const subject of ["geografia", "historia"]) {
    const q = catalog.questions.find(q => q.subjectId === subject);
    const app = appHarness({activeCourse: subject});
    app.run(`state.practiceFilters[data.id] = {query: ${JSON.stringify(q.id)}}; startPractice(); selectAnswer(quiz.questions[0].alternatives.find(a => !a.isCorrect).letter); checkAnswer()`);
    assert.equal(app.run("courseAttempts().length"), 1);
    app.run("closeQuiz(); setCourse('ciencias-humanas')");
    assert.equal(app.run("courseAttempts().length"), 1);
    assert.equal(app.run("performanceMetrics(courseAttempts()).wrong"), 1);
    app.run("state.practiceFilters[data.id] = {status:'wrong'}; startPractice()");
    assert.equal(app.run("quiz.questions[0].id"), q.id);
    app.run("selectAnswer(quiz.questions[0].correctAlternative); checkAnswer(); closeQuiz()");
    assert.equal(app.run("state.missed.length"), 0);
    assert.equal(app.run("completedLessons()"), 0);
    assert.equal(app.run("performanceMetrics(courseAttempts()).accuracy"), 50);
    app.run(`setCourse(${JSON.stringify(subject)}); renderPerformance()`);
    assert.equal(app.run("courseAttempts().length"), 2);
    assert.ok(app.nodes.get("#app").innerHTML.includes(q.moduleTitle));
    app.run("setCourse('ciencias-natureza')");
    assert.equal(app.run("courseAttempts().length"), 0);
  }
});

test("Math, Natureza and Humanas cover every official competence and present its exact skills", () => {
  for (const id of ["matematica", "ciencias-natureza", "ciencias-humanas"]) {
    const course = catalog.courses.find((c) => c.id === id);
    const references = catalog.matrix.areas[id].competencies;
    assert.equal(course.modules.length, references.length);
    assert.deepEqual(course.modules.map((m) => m.competency), references.map((c) => c.number));
    assert.deepEqual(references.flatMap((c) => c.skills.map((s) => s.number)), Array.from({ length: 30 }, (_, i) => i + 1));
    const app = appHarness({ activeCourse: id });
    for (const m of course.modules) {
      assert.deepEqual(m.reference, references.find((c) => c.number === m.competency));
      const count = app.run(`data.questions.filter(q => q.moduleId === ${JSON.stringify(m.id)}).length`);
      assert.ok(count >= 5, `${id} C${m.competency}`);
    }
    app.run("renderLearn()");
    assert.ok(app.nodes.get("#app").innerHTML.includes("Associação") || app.nodes.get("#app").innerHTML.includes("associação"));
    assert.equal((app.nodes.get("#app").innerHTML.match(/ver matriz e habilidades/g) || []).length, course.modules.length);
  }
});

test("switching course preserves old progress and every question is reachable in lessons", () => {
  const app = appHarness({ xp: 200, completed: ["mecanica-1"], introductionsRead: ["mecanica"] });
  assert.equal(app.run("completedLessons()"), 1);
  for (const c of catalog.courses) {
    app.run(`setCourse(${JSON.stringify(c.id)}); renderLearn()`);
    assert.equal(app.run("state.xp"), 200);
    assert.equal(app.run("lessons.filter(l => l.index === 0 && isUnlocked(l)).length"), c.modules.length);
    const ids = JSON.parse(app.run("JSON.stringify(lessons.flatMap(l => l.questions.map(q => q.id)))"));
    assert.deepEqual(new Set(ids), new Set(c.questionIds));
    assert.equal(ids.length, c.total);
    assert.equal(app.run("completedLessons()"), c.id === "fisica" ? 1 : 0);
    for (const m of c.modules) {
      app.run(`openIntroduction(${JSON.stringify(m.id)}); completeIntroduction()`);
    }
  }
  const saved = JSON.parse(app.storage.get("fisio-progress-v1"));
  assert.equal(saved.activeCourse, "linguagens");
  assert.deepEqual(saved.completed, ["mecanica-1"]);
  assert.equal(saved.introductionsRead.length, catalog.courses.reduce((total, course) => total + course.modules.length, 0));
  const reloaded = appHarness(saved);
  assert.equal(reloaded.run("data.id"), "linguagens");
  assert.equal(reloaded.run("state.xp"), 200);
});

test("review is shared between science and Natureza while filters remain course-specific", () => {
  const physicsId = catalog.courses[0].questionIds[0];
  const chemId = catalog.courses[1].questionIds[0];
  const mathId = catalog.courses[3].questionIds[0];
  const app = appHarness({ missed: [physicsId, chemId, mathId], practiceFilters: { fisica: {status: "wrong"}, "ciencias-natureza": {status: "wrong"}, matematica: {status: "wrong"} } });
  app.run("startPractice()");
  assert.equal(app.run("quiz.questions[0].id"), physicsId);
  app.run("closeQuiz(); setCourse('ciencias-natureza'); startPractice()");
  const ids = JSON.parse(app.run("JSON.stringify([...quiz.questions.map(q => q.id), ...quiz.queue])"));
  assert.deepEqual(new Set(ids), new Set([physicsId, chemId]));
  const answered = app.run("quiz.questions[0].id");
  app.run("selectAnswer(quiz.questions[0].correctAlternative); checkAnswer()");
  assert.equal(app.run(`state.missed.includes(${JSON.stringify(answered)})`), false);
  assert.equal(app.run(`state.missed.includes(${JSON.stringify(mathId)})`), true);
  app.run("closeQuiz(); setCourse('matematica'); startPractice()");
  assert.equal(app.run("quiz.questions[0].id"), mathId);
});

test("all courses show explanations after correct or wrong answers and persist separate lesson completion", () => {
  const app = appHarness();
  for (const c of catalog.courses) {
    app.run(`setCourse(${JSON.stringify(c.id)}); startLesson(lessons.find(l => l.index === 0 && l.questions.length >= 2).id)`);
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
    app.run("selectAnswer(quiz.questions[0].alternatives.find(a => a.letter !== quiz.questions[0].correctAlternative).letter); checkAnswer()");
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Por que a alternativa"));
    app.run("nextQuestion(); selectAnswer(quiz.questions[1].correctAlternative); checkAnswer()");
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Por que a alternativa"));
    app.run("while (quiz.index < quiz.questions.length - 1) { nextQuestion(); selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); } nextQuestion();");
    assert.equal(app.run("completedLessons()"), 1);
    app.run("closeQuiz()");
  }
  assert.equal(app.run("state.completed.length"), catalog.courses.length);
});

test("the expanded math course keeps the seven previously completed lessons intact", () => {
  // Published before expansion: these questions and lesson IDs must remain stable.
  const previousLessons = {
    "mat-c1-1": ["2009-178", "2013-163", "2016-168", "2022-142", "2022-140"],
    "mat-c2-1": ["2009-154", "2009-177", "2019-157", "2019-166", "2023-172"],
    "mat-c3-1": ["2013-170", "2019-158", "2019-162", "2022-139", "2023-171"],
    "mat-c4-1": ["2009-160", "2009-162", "2013-159", "2019-153", "2023-167"],
    "mat-c5-1": ["2009-151", "2009-155", "2019-168", "2022-146", "2023-175"],
    "mat-c6-1": ["2009-143", "2019-172", "2019-178", "2023-139", "2023-166"],
    "mat-c7-1": ["2009-145", "2013-150", "2019-160", "2019-173", "2023-180"],
  };
  const completed = Object.keys(previousLessons);
  const app = appHarness({ activeCourse: "matematica", completed, xp: 490, introductionsRead: ["mat-c1"], missed: ["2013-163"] });
  for (const [id, ids] of Object.entries(previousLessons)) {
    const actual = JSON.parse(app.run(`JSON.stringify(lessons.find(l => l.id === ${JSON.stringify(id)}).questions.map(q => q.id))`));
    assert.deepEqual(actual, ids, id);
  }
  assert.equal(app.run("completedLessons()"), 7);
  assert.equal(app.run("state.xp"), 490);
  assert.equal(app.run("nextLesson().id"), "mat-c1-2");
  assert.equal(app.run("lessons.filter(l => l.index === 1 && isUnlocked(l)).length"), 7);
  assert.equal(app.run("lessons.some(l => l.index > 1 && isUnlocked(l))"), false);
  const saved = JSON.parse(app.storage.get("fisio-progress-v1"));
  assert.deepEqual(saved.completed, completed);
  assert.deepEqual(saved.introductionsRead, ["mat-c1"]);
  assert.deepEqual(saved.missed, ["2013-163"]);
  const reloaded = appHarness(saved);
  assert.equal(reloaded.run("nextLesson().id"), "mat-c1-2");
});

test("math expansion provides four complete lessons in each competence", () => {
  const app = appHarness({ activeCourse: "matematica" });
  assert.equal(app.run("data.total"), 140);
  assert.equal(app.run("lessons.length"), 28);
  for (let competence = 1; competence <= 7; competence++) {
    const sizes = JSON.parse(app.run(`JSON.stringify(lessons.filter(l => l.module.competency === ${competence}).map(l => l.questions.length))`));
    assert.deepEqual(sizes, [5, 5, 5, 5]);
  }
  assert.equal(app.run("data.questions.every(q => q.alternatives.length === 5)"), true);
});

test("every previously published lesson retains its questions and position after expansion", () => {
  const previous = JSON.parse(readFileSync("scripts/fixtures/lessons-before-practice.json", "utf8"));
  const correction = JSON.parse(readFileSync("data/courses/math-replacement.json", "utf8"));
  const app = appHarness();
  for (const courseId of Object.keys(previous).filter(id => id !== "portugues")) {
    assert.ok(catalog.courses.some(course => course.id === courseId), `Missing published course: ${courseId}`);
    app.run(`setCourse(${JSON.stringify(courseId)})`);
    for (const [module, groups] of Object.entries(previous[courseId])) {
      for (const [index, ids] of groups.entries()) {
        const id = `${module}-${index + 1}`;
        const actual = JSON.parse(app.run(`JSON.stringify(lessons.find(l => l.id === ${JSON.stringify(id)}).questions.map(q => q.id))`));
        assert.deepEqual(actual, ids.map(id => id === correction.oldId ? correction.replacement.id : id), id);
      }
    }
  }
});

test("expanded sciences contain 90 reviewed questions each without changing old lesson boundaries", () => {
  for (const courseId of ['quimica', 'biologia']) {
    const app = appHarness({ activeCourse: courseId });
    assert.equal(app.run('data.total'), 90);
    assert.equal(app.run('lessons.length'), 20);
    for (const module of catalog.courses.find(c => c.id === courseId).modules) {
      assert.deepEqual(JSON.parse(app.run(`JSON.stringify(lessons.filter(l => l.module.id === ${JSON.stringify(module.id)}).map(l => l.questions.length))`)), [5,3,5,5]);
    }
  }
});

test("TRI joins preserve official answers and scale while unavailable items remain explicit", () => {
  const tri = JSON.parse(readFileSync('data/reference/tri-parameters.json', 'utf8'));
  const valid = catalog.questions.filter(q => q.tri);
  assert.equal(valid.filter(q => ["matematica", "ciencias-natureza"].includes(q.areaId)).length, 431);
  assert.ok(valid.filter(q => q.areaId === "ciencias-humanas").length > 0);
  assert.equal(catalog.tri.matched, valid.length);
  assert.deepEqual([...new Set(tri.years.map(y => y.year))].sort(), Array.from({length:15},(_,i)=>2009+i));
  for (const q of catalog.questions) {
    if (!q.tri) {
      assert.ok(q.triUnavailable?.reason, q.id);
      assert.equal(q.triUnavailable.officialAnswer, q.correctAlternative, q.id);
      continue;
    }
    assert.deepEqual(q.tri, tri.questions[q.id]);
    assert.equal(q.tri.officialAnswer, q.correctAlternative, q.id);
    assert.equal(q.tri.year, q.year, q.id);
    assert.equal(q.tri.questionNumber, q.index, q.id);
    assert.ok(Math.abs(q.tri.difficultyScore - (500 + 100 * q.tri.b)) < 0.000001, q.id);
    if (["matematica", "ciencias-natureza"].includes(q.areaId)) assert.ok(q.tri.matchMethod.includes('booklet_content'), q.id);
    else {
      assert.equal(q.tri.area, q.areaId === "linguagens" ? "LC" : "CH", q.id);
      assert.equal(q.tri.color, "AZUL", q.id);
      assert.equal(q.tri.application, "regular", q.id);
      assert.ok(q.tri.matchMethod.includes('individual_answer'), q.id);
    }
    assert.ok(q.tri.sourceUrl.startsWith('https://download.inep.gov.br/'), q.id);
  }
  assert.ok(!catalog.questions.some(q => q.id === '2023-164'));
  assert.ok(catalog.questions.some(q => q.id === '2017-165'));
});

test("continuous practice respects intersecting filters and goes beyond five answers", () => {
  const app = appHarness({ activeCourse: "matematica", hearts: 3, practiceFilters: { matematica: { module: "mat-c1", competency: "1", status: "all" } } });
  app.run("startPractice()");
  for (let i = 0; i < 22; i++) {
    assert.equal(app.run("quiz.questions[quiz.index].moduleId"), "mat-c1");
    app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); checkAnswer(); nextQuestion()");
  }
  assert.equal(app.run("state.attempts.length"), 22);
  assert.equal(app.run("quiz.answeredCount"), 22);
  assert.equal(app.run("quiz.cycle"), 2);
  assert.equal(app.run("new Set(quiz.questions.slice(0,20).map(q=>q.id)).size"), 20);
  assert.equal(app.run("quiz.questions[19].id === quiz.questions[20].id"), false);
  assert.equal(app.run("state.hearts"), undefined);
  assert.equal(app.run("state.completed.length"), 0);
});

test("unanswered practice exhausts without repeats, and skip creates no attempt", () => {
  const first = catalog.courses.find(c => c.id === "matematica").questionIds[0];
  const app = appHarness({activeCourse:"matematica",practiceFilters:{matematica:{query:first,status:"unanswered"}}});
  app.run("startPractice(); skipPracticeQuestion()");
  assert.equal(app.run("state.attempts.length"), 0);
  assert.equal(app.run("quiz.skipped"), 1);
  app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); nextQuestion()");
  assert.equal(app.run("quiz.ended"), true);
  assert.equal(app.run("quiz.answeredCount"), 1);
  assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Seleção concluída"));
  app.run("closeQuiz(); startPractice()");
  assert.equal(app.run("quiz"), null);
});

test("difficulty, year, keyword and response filters handle missing TRI distinctly", () => {
  const app = appHarness({ activeCourse: "matematica" });
  app.run("data.questions[0] = {...data.questions[0], tri:{difficultyScore:499}}; data.questions[1] = {...data.questions[1], tri:{difficultyScore:600}}; data.questions[2] = {...data.questions[2], tri:null};");
  assert.equal(app.run("questionMatches(data.questions[0],{difficulty:'low'})"), true);
  assert.equal(app.run("questionMatches(data.questions[1],{difficulty:'low'})"), false);
  assert.equal(app.run("questionMatches(data.questions[2],{difficulty:'low'})"), false);
  assert.equal(app.run("questionMatches(data.questions[2],{difficulty:'unknown'})"), true);
  assert.equal(app.run("questionMatches(data.questions[0],{year:'2099'})"), false);
  assert.equal(app.run("questionMatches(data.questions[0],{query:data.questions[0].id})"), true);
  assert.equal(app.run("questionMatches(data.questions[0],{status:'answered'})"), false);
  app.run("state.favorites.push(data.questions[0].id)");
  assert.equal(app.run("questionMatches(data.questions[0],{status:'favorites'})"), true);
});

test("statistics record verified answers once, survive reload and never infer legacy accuracy", () => {
  const app = appHarness({activeCourse:"matematica",answered:["2009-178","2009-178"],xp:20,hearts:1});
  app.run("startPractice(); quiz.timerStartedAt = Date.now() - 5000; selectAnswer(quiz.questions[0].correctAlternative); checkAnswer(); checkAnswer(); nextQuestion(); selectAnswer(quiz.questions[1].alternatives.find(a=>a.letter!==quiz.questions[1].correctAlternative).letter); checkAnswer();");
  assert.equal(app.run("state.hearts"),undefined);
  assert.equal(app.run("state.legacyAnsweredCount"),2);
  assert.equal(app.run("performanceMetrics(courseAttempts()).accuracy"),50);
  assert.equal(app.run("performanceMetrics(courseAttempts()).total"),2);
  assert.ok(app.run("state.attempts[0].durationMs >= 5000"));
  app.run("endPractice(); closeQuiz(); renderPerformance()");
  assert.ok(app.nodes.get("#app").innerHTML.includes("2 respostas anteriores"));
  const saved=JSON.parse(app.storage.get("fisio-progress-v1"));
  const reloaded=appHarness(saved);
  assert.equal(reloaded.run("performanceMetrics(courseAttempts()).accuracy"),50);
  assert.equal(reloaded.run("courseAttempts('all','lesson').length"),0);
  assert.equal(reloaded.run("courseAttempts('all','practice').length"),2);
  reloaded.run("setCourse('fisica')");
  assert.equal(reloaded.run("courseAttempts().length"),0);
});

test("question timer excludes hidden time and explanation reading", () => {
  const app=appHarness();
  app.run("startPractice(); quiz.timerStartedAt=Date.now()-1200; document.hidden=true; stopQuestionTimer(); startQuestionTimer()");
  assert.equal(app.run("quiz.timerStartedAt"),null);
  assert.ok(app.run("quiz.elapsedMs >= 1200"));
  app.run("document.hidden=false; startQuestionTimer(); selectAnswer(quiz.questions[0].correctAlternative); checkAnswer()");
  const elapsed=app.run("state.attempts[0].durationMs");
  app.run("startQuestionTimer(); stopQuestionTimer()");
  assert.equal(app.run("state.attempts[0].durationMs"),elapsed);
  assert.equal(app.run("quiz.timerStartedAt"),null);
});

test("date and mode filters separate periods and preserve Natureza shared statistics", () => {
  const q = catalog.questions.find(q=>q.subjectId==='quimica');
  const app=appHarness({activeCourse:"quimica",attempts:[{questionId:q.id,correct:false,answer:'A',at:'2000-01-01T15:00:00Z',day:'2000-01-01',durationMs:1000,mode:'practice'}]});
  assert.equal(app.run("courseAttempts('7').length"),0);
  assert.equal(app.run("courseAttempts('all').length"),1);
  app.run("setCourse('ciencias-natureza')");
  assert.equal(app.run("courseAttempts('all').length"),1);
  app.run("setCourse('matematica')");
  assert.equal(app.run("courseAttempts('all').length"),0);
});

test("legacy hearts are removed without resetting saved study progress", () => {
  const saved = {
    activeCourse: "matematica", hearts: 0, xp: 230, streak: 4,
    completed: ["mat-c1-1"], introductionsRead: ["mat-c1"],
    answered: ["2009-178"], missed: ["2009-178"], favorites: ["2009-178"],
    practiceFilters: { matematica: { status: "wrong" } },
    attempts: [{ questionId: "2009-178", correct: false, answer: "A", at: "2026-10-01T15:00:00Z", day: "2026-10-01", durationMs: 1200, mode: "lesson" }],
  };
  const app = appHarness(saved);
  const migrated = JSON.parse(app.storage.get("fisio-progress-v1"));
  assert.equal(Object.hasOwn(migrated, "hearts"), false);
  for (const key of Object.keys(saved).filter(key => key !== "hearts")) {
    assert.deepEqual(migrated[key], saved[key], key);
  }
  assert.equal(app.run("isUnlocked(lessons[1])"), true);
  app.run("startLesson(lessons[1].id)");
  assert.equal(app.run("quiz.errors"), 0);
});

for (const errors of [0, 3]) {
  test(`a complete lesson with ${errors} errors passes and earns its completion bonus once`, () => {
    const app = appHarness({ activeCourse: "matematica" });
    app.run("startLesson(lessons[0].id)");
    assert.equal(app.run("isUnlocked(lessons[1])"), false);
    for (let i = 0; i < 5; i++) {
      app.run(i < errors
        ? "selectAnswer(quiz.questions[quiz.index].alternatives.find(a => a.letter !== quiz.questions[quiz.index].correctAlternative).letter)"
        : "selectAnswer(quiz.questions[quiz.index].correctAlternative)");
      app.run("checkAnswer(); checkAnswer(); nextQuestion()");
    }
    assert.equal(app.run("quiz.errors"), errors);
    assert.equal(app.run("quiz.passed"), true);
    assert.equal(app.run("quiz.ended"), true);
    assert.equal(app.run("state.attempts.length"), 5);
    assert.equal(app.run("state.completed.includes(lessons[0].id)"), true);
    assert.equal(app.run("isUnlocked(lessons[1])"), true);
    assert.equal(app.run("state.xp"), (5 - errors) * 10 + 20);
    app.run("finishLesson(); nextQuestion(); checkAnswer()");
    assert.equal(app.run("state.xp"), (5 - errors) * 10 + 20);
    assert.equal(app.run("state.completed.length"), 1);
    assert.equal(app.run("state.attempts.length"), 5);
  });
}

test("the fourth error keeps its explanation visible before failing early without unlocking or bonus", () => {
  const app = appHarness({ activeCourse: "matematica" });
  app.run("startLesson(lessons[0].id)");
  for (let i = 0; i < 4; i++) {
    app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(a => a.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); checkAnswer()");
    if (i < 3) app.run("nextQuestion()");
  }
  assert.equal(app.run("quiz.errors"), 4);
  assert.equal(app.run("quiz.index"), 3);
  assert.equal(app.run("Boolean(quiz.ended)"), false);
  assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
  assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Ver resultado"));
  app.run("nextQuestion()");
  assert.equal(app.run("quiz.passed"), false);
  assert.equal(app.run("quiz.ended"), true);
  assert.equal(app.run("quiz.index"), 3);
  assert.equal(app.run("state.attempts.length"), 4);
  assert.equal(app.run("state.completed.length"), 0);
  assert.equal(app.run("isUnlocked(lessons[1])"), false);
  assert.equal(app.run("state.xp"), 0);
  assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes('data-action="restart-lesson"'));
  app.run("nextQuestion(); finishLesson(); selectAnswer('A'); checkAnswer()");
  assert.equal(app.run("state.attempts.length"), 4);
});

test("restarting a failed lesson resets only the attempt and preserves answers and earned XP", () => {
  const app = appHarness({ activeCourse: "matematica" });
  app.run("startLesson(lessons[0].id); selectAnswer(quiz.questions[0].correctAlternative); checkAnswer(); nextQuestion()");
  for (let i = 0; i < 4; i++) {
    app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(a => a.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); nextQuestion()");
  }
  const questionIds = app.run("JSON.stringify(quiz.questions.map(q => q.id))");
  assert.equal(app.run("quiz.passed"), false);
  assert.equal(app.run("state.xp"), 10);
  app.run("restartLesson()");
  assert.equal(app.run("JSON.stringify(quiz.questions.map(q => q.id))"), questionIds);
  assert.equal(app.run("quiz.lesson.id"), "mat-c1-1");
  assert.equal(app.run("quiz.errors"), 0);
  assert.equal(app.run("quiz.correct"), 0);
  assert.equal(app.run("quiz.index"), 0);
  assert.equal(app.run("quiz.checked"), false);
  assert.equal(app.run("quiz.selected"), null);
  assert.equal(app.run("Boolean(quiz.ended)"), false);
  assert.equal(app.run("state.attempts.length"), 5);
  assert.equal(app.run("state.answered.length"), 5);
  assert.equal(app.run("state.xp"), 10);
  for (let i = 0; i < 5; i++) app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); nextQuestion()");
  assert.equal(app.run("quiz.passed"), true);
  assert.equal(app.run("state.attempts.length"), 10);
  assert.equal(app.run("state.completed.length"), 1);
  assert.equal(app.run("state.xp"), 80);
});

test("empty and unfinished lessons cannot be completed or award a bonus", () => {
  const app = appHarness({ activeCourse: "matematica" });
  app.run("startLesson(null, []); finishLesson()");
  assert.equal(app.run("quiz"), null);
  app.run("startLesson(lessons[0].id); finishLesson(); nextQuestion()");
  assert.equal(app.run("Boolean(quiz.ended)"), false);
  assert.equal(app.run("state.xp"), 0);
  app.run("selectAnswer(quiz.questions[0].correctAlternative); checkAnswer(); finishLesson()");
  assert.equal(app.run("Boolean(quiz.ended)"), false);
  assert.equal(app.run("state.completed.length"), 0);
  assert.equal(app.run("state.xp"), 10);
  assert.equal(app.run("isUnlocked(lessons[1])"), false);
});

test("many practice errors never exhaust attempts or complete a course lesson", () => {
  const app = appHarness({ activeCourse: "matematica" });
  app.run("startPractice()");
  for (let i = 0; i < 30; i++) {
    app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(a => a.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); finishLesson(); nextQuestion()");
  }
  assert.equal(app.run("quiz.practice"), true);
  assert.equal(app.run("Boolean(quiz.ended)"), false);
  assert.equal(app.run("quiz.answeredCount"), 30);
  assert.equal(app.run("state.attempts.length"), 30);
  assert.equal(app.run("state.completed.length"), 0);
  assert.equal(app.run("state.xp"), 0);
  assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="quiz-errors"'));
  app.run("restartLesson()");
  assert.equal(app.run("quiz.answeredCount"), 30);
});

test("failure on an already completed lesson preserves its completion and does not renew the bonus", () => {
  const app = appHarness({ activeCourse: "matematica", completed: ["mat-c1-1"], xp: 200 });
  app.run("startLesson(lessons[0].id)");
  for (let i = 0; i < 4; i++) app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(a => a.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); nextQuestion()");
  assert.equal(app.run("quiz.passed"), false);
  assert.equal(app.run("state.completed.includes('mat-c1-1')"), true);
  assert.equal(app.run("isUnlocked(lessons[1])"), true);
  assert.equal(app.run("state.xp"), 200);
  app.run("restartLesson()");
  for (let i = 0; i < 5; i++) app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); nextQuestion()");
  assert.equal(app.run("quiz.passed"), true);
  assert.equal(app.run("state.completed.length"), 1);
  assert.equal(app.run("state.xp"), 250);
});

test("Linguagens covers seven subjects in nine competency units with 500 unique questions", () => {
  const area = catalog.courses.find(c => c.id === 'linguagens');
  const counts = {portugues:300, literatura:100, ingles:30, espanhol:30, arte:14, 'educacao-fisica':14, 'tecnologia-informacao':12};
  assert.equal(area.total, 500);
  assert.equal(area.modules.length, 9);
  assert.notEqual(area.integratedBy, 'subject');
  assert.deepEqual(area.modules.map(m => m.competency), [1,2,3,4,5,6,7,8,9]);
  assert.deepEqual(new Set(area.questionIds), new Set(catalog.questions.filter(q => q.areaId === 'linguagens').map(q => q.id)));
  for (const [id, count] of Object.entries(counts)) {
    assert.equal(catalog.questions.filter(q => q.subjectId === id).length, count, id);
    const individual = catalog.courses.find(c => c.id === id);
    if (individual) assert.equal(individual.total, count, id);
  }
  const skills = catalog.matrix.areas.linguagens.competencies.flatMap(c => c.skills.map(s => s.number));
  assert.deepEqual(skills, Array.from({length:30}, (_, i) => i + 1));
  for (const module of area.modules) {
    assert.equal(module.reference.number, module.competency);
    const app = appHarness({activeCourse:'linguagens', practiceFilters:{linguagens:{module:module.id, competency:String(module.competency)}}});
    app.run('startPractice()');
    const pool = JSON.parse(app.run('JSON.stringify([quiz.questions[0].id, ...quiz.queue])'));
    const expected = catalog.questions.filter(q => q.areaId === 'linguagens' && q.competency === module.competency);
    assert.ok(expected.length >= 5);
    assert.deepEqual(new Set(pool), new Set(expected.map(q => q.id)));
    assert.ok(app.nodes.get('#lesson-modal').innerHTML.includes(`LC · C${module.competency}`));
    app.run('selectAnswer(quiz.questions[0].correctAlternative); checkAnswer(); closeQuiz()');
    assert.equal(app.run('courseAttempts().length'), 1);
    assert.equal(app.run('completedLessons()'), 0);
  }
});

test("Linguagens migration preserves completed question groups and history without granting XP", () => {
  const area = catalog.courses.find(c => c.id === 'linguagens');
  const legacy = area.legacyLessonLayout;
  for (const [module, groups] of Object.entries(legacy)) {
    for (const [index, ids] of groups.entries()) {
      const oldId = `${module}-${index + 1}`;
      const app = appHarness({activeCourse:'linguagens', completed:[oldId], xp:123, answered:ids, missed:[ids[0]], favorites:[ids[0]], practiceFilters:{linguagens:{module, year:'2023'}}});
      const migrated = JSON.parse(app.run('JSON.stringify(lessons.filter(l => state.completed.includes(l.id)).flatMap(l => l.questions.map(q => q.id)))'));
      assert.deepEqual(new Set(migrated), new Set(ids), oldId);
      assert.equal(app.run('state.xp'), 123);
      assert.equal(app.run('lessons.filter(l => state.completed.includes(l.id)).every(isUnlocked)'), true);
      assert.equal(app.run('practiceFilters().module'), '');
      assert.equal(app.run('practiceFilters().year'), '2023');
      assert.deepEqual(JSON.parse(app.run('JSON.stringify(state.missed)')), [ids[0]]);
      const saved = JSON.parse(app.storage.get('fisio-progress-v1'));
      const reloaded = appHarness(saved);
      assert.equal(reloaded.run('state.completed.length'), saved.completed.length);
    }
  }
  assert.equal(Object.keys(area.legacyLessonCredits).length > 0, true);
});

test("subject selector is alphabetical in Portuguese without changing the active course", () => {
  const app = appHarness({activeCourse:'linguagens'});
  const ids = [...app.run('courseSwitcher()').matchAll(/<option value="([^"]+)"/g)].map(m => m[1]);
  const expected = [...catalog.courses].sort((a,b) => a.title.localeCompare(b.title, 'pt-BR', {sensitivity:'base'})).map(c => c.id);
  assert.deepEqual(ids, expected);
  assert.equal(app.run('data.id'), 'linguagens');
});

test("English and Spanish items with the same year and number never share answers, TRI or review state", () => {
  const en = catalog.questions.find(q => q.id === '2023-3-ingles');
  const es = catalog.questions.find(q => q.id === '2023-3-espanhol');
  assert.equal(en.index, es.index);
  assert.notEqual(en.correctAlternative, es.correctAlternative);
  assert.notEqual(en.tri.itemCode, es.tri.itemCode);
  for (const q of [en, es]) {
    assert.equal(q.language, q.subjectId);
    assert.equal(q.tri.language, q.language);
    assert.equal(q.tri.area, 'LC');
  }
  const app = appHarness({activeCourse:'ingles', practiceFilters:{ingles:{query:en.id}}});
  app.run('startPractice(); selectAnswer(quiz.questions[0].alternatives.find(a => !a.isCorrect).letter); checkAnswer(); closeQuiz()');
  assert.deepEqual(JSON.parse(app.run('JSON.stringify(state.missed)')), [en.id]);
  app.run("setCourse('espanhol')");
  assert.equal(app.run('courseAttempts().length'), 0);
  assert.equal(app.run('filteredPracticeQuestions({status:"wrong"}).length'), 0);
  app.run("setCourse('linguagens')");
  assert.equal(app.run('courseAttempts().length'), 1);
  assert.deepEqual(JSON.parse(app.run('JSON.stringify(filteredPracticeQuestions({status:"wrong"}).map(q => q.id))')), [en.id]);
});

test("language reading passages remain complete and separate from the question heading", () => {
  const originals = JSON.parse(readFileSync('data/enem/all-questions.json', 'utf8')).questions;
  const app = appHarness();
  for (const q of catalog.questions.filter(q => q.areaId === 'linguagens')) {
    const original = originals.find(o => o.year === q.year && o.index === q.index && o.language === q.language);
    assert.ok(q.context, q.id);
    const compact = value => value.replace(/https:\/\/enem.dev\/(\d+)\/questions\//g, '/assets/questions/$1/').replace(/\s+/g, ' ').trim();
    assert.equal(compact([q.context, q.alternativesIntroduction].join(' ')), compact([original.context || '', original.alternativesIntroduction].join(' ')), q.id);
    const html = app.run(`renderMarkdown(${JSON.stringify(q.context)}, true)`);
    assert.ok(!html.includes('math-fallback'), q.id);
    assert.ok(!html.includes('\\['), q.id);
    assert.equal(q.tri?.language || null, q.language || null, q.id);
  }
});

test('Portuguese splits the same 300 questions into eight focused topics and short lessons', () => {
  const c = catalog.courses.find(c => c.id === 'portugues');
  const before = JSON.parse(readFileSync('scripts/fixtures/lessons-before-practice.json', 'utf8')).portugues;
  assert.equal(c.modules.length, 8);
  assert.deepEqual(new Set(c.questionIds), new Set(Object.values(before).flat(2)));
  for (const m of c.modules) {
    const qs = catalog.questions.filter(q => q.subjectId === 'portugues' && q.moduleId === m.id);
    assert.ok(qs.length >= 15 && qs.length <= 65);
    assert.ok(qs.every(q => m.skills.includes(q.skill)));
    assert.ok(c.lessonLayout[m.id].every(ids => ids.length >= 3 && ids.length <= 5));
  }
  const app = appHarness({activeCourse:'portugues'});
  app.run('renderLearn()');
  assert.equal((app.nodes.get('#app').innerHTML.match(/data-study-unit=/g) || []).length, 8);
  assert.equal((app.nodes.get('#app').innerHTML.match(/class="study-detail unit"/g) || []).length, 1);
});

test('all old Portuguese completions migrate fully and idempotently without awarding XP', () => {
  const c = catalog.courses.find(c => c.id === 'portugues');
  const old = [...new Set(Object.values(c.legacyQuestionCredits))];
  const saved = {activeCourse:'portugues',completed:old,xp:777,missed:[c.questionIds[0]],favorites:[c.questionIds[1]],introductionsRead:['pt-leitura']};
  const app = appHarness(saved);
  assert.equal(app.run('studiedQuestionIds().size'), 300);
  assert.equal(app.run('completedLessons() === lessons.length'), true);
  assert.equal(app.run('state.xp'), 777);
  assert.equal(app.run('state.introductionsRead.length'), 1);
  const stored = JSON.parse(app.storage.get('fisio-progress-v1'));
  const again = appHarness(stored);
  assert.deepEqual(JSON.parse(again.run('JSON.stringify(state.completed)')), stored.completed);
  assert.deepEqual(JSON.parse(again.run('JSON.stringify(state.missed)')), saved.missed);
  assert.deepEqual(JSON.parse(again.run('JSON.stringify(state.favorites)')), saved.favorites);
  again.run('renderLearn()');
  assert.ok(again.nodes.get('#app').innerHTML.includes('Unidade concluída'));
  assert.ok(!again.nodes.get('#app').innerHTML.includes('Continuar lição'));
});

test('partial Portuguese migration preserves every earned question credit and skips only those credits', () => {
  const c = catalog.courses.find(c => c.id === 'portugues');
  const oldIds = [...new Set(Object.values(c.legacyQuestionCredits))];
  for (const oldId of [oldIds[0], oldIds.at(-1)]) {
    const expected = Object.entries(c.legacyQuestionCredits).filter(([,id]) => id === oldId).map(([q]) => q);
    const app = appHarness({activeCourse:'portugues',completed:[oldId],xp:100,practiceFilters:{portugues:{module:'pt-leitura',year:'2023'}}});
    assert.deepEqual(new Set(JSON.parse(app.run('JSON.stringify([...studiedQuestionIds()])'))), new Set(expected));
    assert.equal(app.run('practiceFilters().module'), '');
    assert.equal(app.run('practiceFilters().year'), '2023');
    const partial = app.run('lessons.find(l => lessonCredits(l).length > 0 && lessonCredits(l).length < l.questions.length)?.id');
    assert.ok(partial);
    app.run(`startLesson(${JSON.stringify(partial)})`);
    const selected = JSON.parse(app.run('JSON.stringify(quiz.questions.map(q => q.id))'));
    assert.ok(selected.every(id => !expected.includes(id)));
    app.run('while (!quiz.ended) { selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); nextQuestion(); }');
    assert.equal(app.run('state.xp'), 100 + selected.length * 10);
    assert.equal(app.run(`state.completed.includes(${JSON.stringify(partial)})`), true);
    assert.equal(app.run('studiedQuestionIds().size'), expected.length + selected.length);
  }
});

test('practice answers never become Portuguese lesson credits', () => {
  const c = catalog.courses.find(c => c.id === 'portugues');
  const app = appHarness({activeCourse:'portugues',answered:c.questionIds,xp:3000});
  assert.equal(app.run('studiedQuestionIds().size'), 0);
  assert.equal(app.run('completedLessons()'), 0);
});

test('Portuguese topic selection persists and introduction starts that topic before its next lesson', () => {
  const app = appHarness({activeCourse:'portugues'});
  app.run('selectStudyUnit("pt-variacao"); openIntroduction("pt-variacao")');
  assert.ok(app.nodes.get('#lesson-modal').innerHTML.includes('Concluir leitura e iniciar lição'));
  assert.ok(!app.nodes.get('#lesson-modal').innerHTML.includes('<div class="formula"></div>'));
  app.run('completeIntroduction()');
  assert.equal(app.run('quiz.lesson.module.id'), 'pt-variacao');
  assert.equal(app.run('quiz.questions.length'), 5);
  app.run('while (!quiz.ended) { selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); nextQuestion(); }');
  assert.ok(app.nodes.get('#lesson-modal').innerHTML.includes('Próxima lição'));
  assert.equal(app.run('pendingUnitLesson("pt-variacao").index'), 1);
  const saved = JSON.parse(app.storage.get('fisio-progress-v1'));
  const again = appHarness(saved);
  assert.equal(again.run('selectedStudyModule().id'), 'pt-variacao');
  again.run('practiceUnit("pt-variacao")');
  assert.equal(again.run('filteredPracticeQuestions().length'), 53);
  assert.equal(again.run('filteredPracticeQuestions().every(q => q.moduleId === "pt-variacao")'), true);
});
