import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const data = JSON.parse(readFileSync("dist/data/physics-questions.json", "utf8"));
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
  context.inputData = data;
  vm.runInContext("data = inputData; makeLessons();", context);
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
