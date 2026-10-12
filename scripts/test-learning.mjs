import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const data = JSON.parse(readFileSync("dist/data/physics-questions.json", "utf8"));
const catalog = JSON.parse(readFileSync("dist/data/courses.json", "utf8"));
const source = readFileSync("dist/app.js", "utf8").replace(/\ninit\(\);\s*$/, "");

function appHarness(saved) {
  const nodes = new Map();
  const node = () => ({ innerHTML: "", hidden: true, dataset: {}, setAttribute() {}, focus() {}, matches() { return false; }, scrollIntoView() {}, scrollTo() {}, querySelector() { return node(); }, classList: { add() {}, remove() {} } });
  const storage = new Map(saved ? [["fisio-progress-v1", JSON.stringify(saved)]] : []);
  const context = vm.createContext({
    document: { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); }, querySelectorAll() { return []; }, addEventListener() {}, body: { style: {} }, activeElement: node() },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    location: { hash: "" }, window: { addEventListener() {}, scrollTo() {} }, history: { replaceState() {} },
    Intl, Date, setTimeout() {}, structuredClone,
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
    assert.ok(rendered.includes(app.run("escapeHtml(quiz.questions[0].explanation.steps[0])")));
    assert.equal(app.run("state.answered.length"), 1);
    app.run("checkAnswer()");
    assert.equal(app.run("state.answered.length"), 1);
    app.run("nextQuestion()");
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
  });
}

test("practice starts with pending errors before filling with new questions", () => {
  const missed = data.questions.slice(0, 2).map((question) => question.id);
  const app = appHarness({ missed });
  app.run("startPractice()");
  const chosen = JSON.parse(app.run("JSON.stringify(quiz.questions.map(q => q.id))"));
  assert.equal(chosen.length, 5);
  assert.ok(missed.every((id) => chosen.slice(0, 2).includes(id)));
});

test("all five courses have complete introductions, explanations and unique question references", () => {
  assert.deepEqual(catalog.courses.map((c) => c.id), ["fisica", "quimica", "biologia", "matematica", "ciencias-natureza"]);
  assert.equal(catalog.total, catalog.questions.length);
  assert.equal(new Set(catalog.questions.map((q) => q.id)).size, catalog.total);
  const explanations = new Set();
  const originals = JSON.parse(readFileSync("data/enem/all-questions.json", "utf8")).questions;
  for (const q of catalog.questions) {
    const original = originals.find((o) => `${o.year}-${o.index}` === q.id && o.discipline === q.areaId);
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
  assert.equal(moduleIds.size, 30);
});

test("Natureza is exactly the union of Physics, Chemistry and Biology without duplicating records", () => {
  const scienceCourses = catalog.courses.filter((c) => ["fisica", "quimica", "biologia"].includes(c.id));
  const union = new Set(scienceCourses.flatMap((c) => c.questionIds));
  const nature = catalog.courses.find((c) => c.id === "ciencias-natureza");
  assert.deepEqual(new Set(nature.questionIds), union);
  assert.equal(union.size, scienceCourses.reduce((total, c) => total + c.total, 0));
  assert.ok(nature.questionIds.every((id) => catalog.questions.find((q) => q.id === id).areaId === "ciencias-natureza"));
});

test("Math and Natureza cover every official competence and present its exact skills", () => {
  for (const id of ["matematica", "ciencias-natureza"]) {
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
  assert.equal(saved.activeCourse, "ciencias-natureza");
  assert.deepEqual(saved.completed, ["mecanica-1"]);
  assert.equal(saved.introductionsRead.length, 30);
  const reloaded = appHarness(saved);
  assert.equal(reloaded.run("data.id"), "ciencias-natureza");
  assert.equal(reloaded.run("state.xp"), 200);
});

test("review is shared between a science subject and Natureza while remaining filtered by course", () => {
  const physicsId = catalog.courses[0].questionIds[0];
  const chemId = catalog.courses[1].questionIds[0];
  const mathId = catalog.courses[3].questionIds[0];
  const app = appHarness({ missed: [physicsId, chemId, mathId] });
  app.run("startPractice()");
  assert.equal(app.run("quiz.questions[0].id"), physicsId);
  assert.equal(app.run("quiz.questions.some(q => q.subjectId !== 'fisica')"), false);
  app.run("closeQuiz(); setCourse('ciencias-natureza'); startPractice()");
  const first = JSON.parse(app.run("JSON.stringify(quiz.questions.slice(0, 2).map(q => q.id))"));
  assert.deepEqual(new Set(first), new Set([physicsId, chemId]));
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
    app.run(`setCourse(${JSON.stringify(c.id)}); startLesson(lessons[0].id)`);
    assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
    app.run("selectAnswer(quiz.questions[0].alternatives.find(a => a.letter !== quiz.questions[0].correctAlternative).letter); checkAnswer()");
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Por que a alternativa"));
    app.run("nextQuestion(); selectAnswer(quiz.questions[1].correctAlternative); checkAnswer()");
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes("Por que a alternativa"));
    app.run("while (quiz.index < quiz.questions.length - 1) { nextQuestion(); selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); } nextQuestion();");
    assert.equal(app.run("completedLessons()"), 1);
    app.run("closeQuiz()");
  }
  assert.equal(app.run("state.completed.length"), 5);
});
