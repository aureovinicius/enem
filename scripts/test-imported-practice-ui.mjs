import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { buildPracticeReport } from "../dist/practice-session.js";

const base = JSON.parse(readFileSync("dist/data/courses.json", "utf8"));
const source = readFileSync("dist/app.js", "utf8").replace(/^import .*practice-session.*\n/m, "").replace(/\ninit\(\);\s*$/, "");
const storageKey = "fisio-progress-v1";
const areas = ["ciencias-natureza", "ciencias-humanas", "linguagens", "matematica"];

function imported(id, areaId, subjectId = `${areaId}-sem-classificacao`) {
  return {
    id, areaId, subjectId, subjectTitle: subjectId.includes("sem-classificacao") ? "Disciplina não classificada" : subjectId,
    moduleId: "acervo-api", moduleTitle: "Assunto não classificado", competency: null, skill: null,
    title: `ENEM 2098 · Questão ${id}`, index: 91, year: 2098,
    context: `Enunciado de teste ${id}.`, alternativesIntroduction: "Qual alternativa corresponde ao enunciado?",
    alternatives: ["A", "B", "C", "D", "E"].map(letter => ({ letter, text: `Texto da alternativa ${letter}` })),
    correctAlternative: "B", explanation: null, sourceUrl: "https://enem.dev/exams/2098/questions/91", imported: true,
  };
}

function fixture() {
  const catalog = structuredClone(base);
  catalog.practiceQuestions = [
    imported("import-cn", "ciencias-natureza"), imported("import-ch", "ciencias-humanas"),
    imported("import-lc", "linguagens"), imported("import-mt", "matematica", "matematica"),
    imported("import-en", "linguagens", "ingles"), imported("import-es", "linguagens", "espanhol"),
  ];
  for (const course of catalog.courses) {
    course.practiceQuestionIds = [...course.questionIds, ...catalog.practiceQuestions.filter(q =>
      areas.includes(course.id) ? q.areaId === course.id : ["ingles", "espanhol"].includes(course.id) && q.subjectId === course.id
    ).map(q => q.id)];
  }
  return catalog;
}

function harness(saved = { activeCourse: "ciencias-natureza" }, suppliedCatalog = fixture()) {
  const nodes = new Map();
  const events = new Map();
  const storage = new Map([[storageKey, JSON.stringify(saved)]]);
  const node = () => ({ innerHTML: "", textContent: "", hidden: true, dataset: {}, style: {},
    setAttribute() {}, removeAttribute() {}, focus() {}, matches() { return false; }, scrollIntoView() {}, scrollTo() {},
    querySelector() { return node(); }, querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {} } });
  const context = vm.createContext({
    document: { hidden: false, body: { style: {} }, activeElement: node(),
      querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
      querySelectorAll() { return []; }, addEventListener(type, callback) { events.set(type, [...(events.get(type) || []), callback]); } },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    location: { hash: "#praticar" }, history: { replaceState() {} }, window: { addEventListener() {}, scrollTo() {} },
    Intl, Date, structuredClone, buildPracticeReport, setTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  });
  vm.runInContext(source, context);
  context.inputCatalog = suppliedCatalog;
  vm.runInContext("catalog = inputCatalog; setCourse(state.activeCourse);", context);
  const run = code => vm.runInContext(code, context);
  return { nodes, run, context, json: code => JSON.parse(run(`JSON.stringify(${code})`)), saved: () => JSON.parse(storage.get(storageKey)),
    click(attribute, value) {
      const key = attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      const target = { dataset: { [key]: value }, closest(selector) { return selector === `[${attribute}]` ? this : null; } };
      for (const callback of events.get("click") || []) callback({ target, preventDefault() {} });
    },
  };
}

function startImported(app) {
  app.run("state.practiceFilters[data.id] = { year: '2098' }; startPractice()");
}

test("practice additions leave every trail, lesson and reviewed question unchanged", () => {
  const catalog = fixture();
  const legacy = structuredClone(catalog);
  delete legacy.practiceQuestions;
  for (const course of legacy.courses) delete course.practiceQuestionIds;
  const before = harness(undefined, legacy);
  const after = harness(undefined, catalog);
  for (const course of catalog.courses) {
    before.run(`setCourse(${JSON.stringify(course.id)})`);
    after.run(`setCourse(${JSON.stringify(course.id)})`);
    assert.deepEqual(after.json("data.questions"), before.json("data.questions"), course.id);
    assert.deepEqual(after.json("lessons.map(l => ({id:l.id,questions:l.questions.map(q=>q.id)}))"), before.json("lessons.map(l => ({id:l.id,questions:l.questions.map(q=>q.id)}))"), course.id);
    assert.equal(after.run("lessons.some(l => l.questions.some(q => q.imported))"), false);
  }
  assert.equal(after.run("allCatalogQuestions().length"), catalog.questions.length + 6);
});

test("the complete imported pool is accessible through broad areas and the two language courses", () => {
  const app = harness();
  for (const [course, importedIds] of [
    ["ciencias-natureza", ["import-cn"]], ["ciencias-humanas", ["import-ch"]],
    ["linguagens", ["import-lc", "import-en", "import-es"]], ["matematica", ["import-mt"]],
    ["ingles", ["import-en"]], ["espanhol", ["import-es"]], ["fisica", []], ["portugues", []],
  ]) {
    app.run(`setCourse(${JSON.stringify(course)})`);
    assert.deepEqual(app.json("practiceQuestions().filter(q=>q.imported).map(q=>q.id)"), importedIds, course);
  }
  app.run("setCourse('fisica'); renderPractice()");
  for (const area of areas) assert.ok(app.nodes.get("#app").innerHTML.includes(`data-practice-area="${area}"`));
  app.click("data-practice-area", "ciencias-humanas");
  assert.equal(app.run("data.id"), "ciencias-humanas");
  assert.equal(app.run("activeView"), "praticar");
  assert.match(app.nodes.get("#app").innerHTML, /questões comentadas na trilha/);
});

test("year, topic and unclassified competency filters include only matching imported items", () => {
  const app = harness();
  app.run("renderPractice()");
  const html = app.nodes.get("#app").innerHTML;
  assert.match(html, /<option value="2098"/);
  assert.match(html, /Competência não classificada/);
  assert.doesNotMatch(html, /Competência (?:null|undefined|0)</);
  for (const filters of [
    { year: "2098" }, { competency: "unknown" }, { module: "acervo-api" },
    { topic: "ciencias-natureza-sem-classificacao:acervo-api" }, { subject: "ciencias-natureza-sem-classificacao" },
  ]) assert.deepEqual(app.json(`filteredPracticeQuestions(${JSON.stringify(filters)}).map(q=>q.id)`), ["import-cn"]);
  assert.deepEqual(app.json("filteredPracticeQuestions({year:'2098',competency:'1'}).map(q=>q.id)"), []);
  assert.deepEqual(app.json("filteredPracticeQuestions({year:'2098',difficulty:'known'}).map(q=>q.id)"), []);
  app.run("state.practiceFilters[data.id] = {module:'acervo-api'}; setCourse(data.id)");
  assert.equal(app.run("practiceFilters().module"), "acervo-api");
});

test("integrated curated questions keep distinct trail-unit and original-topic filters", () => {
  const app = harness();
  const q = app.json("practiceQuestions().find(q=>!q.imported)");
  assert.equal(app.run(`questionMatches(practiceQuestions().find(q=>q.id===${JSON.stringify(q.id)}), {module:${JSON.stringify(q.moduleId)}, topic:${JSON.stringify(`${q.subjectId}:${q.originalModuleId}`)}})`), true);
  assert.equal(app.run(`questionMatches(practiceQuestions().find(q=>q.id===${JSON.stringify(q.id)}), {module:'acervo-api'})`), false);
});

for (const answer of ["A", "B"]) test(`an imported answer ${answer} shows its key and an honest missing-resolution notice`, () => {
  const app = harness();
  startImported(app);
  assert.doesNotMatch(app.nodes.get("#lesson-modal").innerHTML, /Alternativa correta: B/);
  app.run(`selectAnswer('${answer}'); checkAnswer()`);
  const html = app.nodes.get("#lesson-modal").innerHTML;
  assert.match(html, /class="explanation"/);
  assert.match(html, /Alternativa correta: B/);
  assert.match(html, /ainda não possui resolução comentada revisada/);
  assert.match(html, /https:\/\/enem\.dev\/exams\/2098\/questions\/91/);
  assert.doesNotMatch(html, /Por que a alternativa|Guarde esta ideia|Confira a resolução comentada antes/);
  assert.equal(app.run("state.attempts[0].correct"), answer === "B");
  assert.equal(app.run("state.xp"), answer === "B" ? 10 : 0);
});

test("imported sessions can resume after reload and continue drawing from the same pool", () => {
  const app = harness();
  startImported(app);
  app.run("selectAnswer('B'); checkpointPractice()");
  const reloaded = harness(app.saved());
  reloaded.run("resumeSavedPractice()");
  assert.equal(reloaded.run("quiz.questions[0].id"), "import-cn");
  assert.equal(reloaded.run("quiz.selected"), "B");
  assert.equal(reloaded.run("quiz.paused"), true);
  reloaded.run("resumePractice(); checkAnswer(); nextQuestion()");
  assert.equal(reloaded.run("quiz.questions[quiz.index].id"), "import-cn");
  assert.equal(reloaded.run("quiz.cycle"), 2);
  assert.equal(reloaded.run("state.attempts.length"), 1);
});

test("reports, history, review and overall performance retain imported responses", () => {
  const app = harness();
  startImported(app);
  app.run("selectAnswer('A'); checkAnswer(); endPractice()");
  let html = app.nodes.get("#lesson-modal").innerHTML;
  assert.match(html, /<small>Respostas verificadas<\/small><strong>1<\/strong>/);
  assert.match(html, /data-session-question="import-cn"/);
  assert.match(html, /Assunto não classificado/);
  app.run("reviewSessionQuestion('import-cn')");
  assert.match(app.nodes.get("#lesson-modal").innerHTML, /ainda não possui resolução comentada revisada/);
  app.run("renderPerformance()");
  html = app.nodes.get("#app").innerHTML;
  assert.match(html, /ENEM 2098 · Questão 91/);
  assert.match(html, /Assunto não classificado/);
  assert.equal(app.run("courseAttempts().length"), 1);
  assert.match(app.run("practiceHistoryMarkup()"), /1 resposta/);
  assert.deepEqual(app.json("filteredPracticeQuestions({status:'wrong'}).filter(q=>q.imported).map(q=>q.id)"), ["import-cn"]);
});

test("initial loading preserves pending errors from imported questions", async () => {
  const app = harness({ activeCourse: "ciencias-natureza", missed: ["import-cn", "removed-item"] });
  app.context.fetch = async () => ({ ok: true, json: async () => fixture() });
  await app.run("init()");
  assert.deepEqual(app.json("state.missed"), ["import-cn"]);
});

test("the reviewed explanation remains unchanged while an untrusted source cannot create a link", () => {
  const app = harness();
  const question = app.json("data.questions[0]");
  assert.match(app.run("renderExplanation(data.questions[0])"), /Por que a alternativa/);
  assert.ok(app.run("renderExplanation(data.questions[0])").includes(app.run("renderMathText(data.questions[0].explanation.steps[0])")));
  app.run("catalog.practiceQuestions[0].sourceUrl = 'javascript:alert(1)'");
  assert.doesNotMatch(app.run("renderExplanation(catalog.practiceQuestions[0])"), /href=/);
  assert.equal(app.run("data.questions[0].explanation.concept"), question.explanation.concept);
});
