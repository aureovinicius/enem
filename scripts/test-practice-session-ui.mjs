import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import { buildPracticeReport } from "../dist/practice-session.js";

const katex = createRequire(import.meta.url)("../dist/vendor/katex/katex.min.js");
const catalog = JSON.parse(readFileSync("dist/data/courses.json", "utf8"));
const source = readFileSync("dist/app.js", "utf8")
  .replace(/^import\s+\{[\s\S]*?\}\s+from\s+["'][^"']+["'];?\s*/m, "")
  .replace(/\ninit\(\);\s*$/, "");
const storageKey = "fisio-progress-v1";
const initialTime = Date.parse("2026-10-14T15:00:00.000Z");

function appHarness(saved, now = initialTime) {
  let clock = now;
  let timerId = 0;
  let sessionId = 0;
  const nodes = new Map();
  const events = new Map();
  const windowEvents = new Map();
  const intervals = new Map();
  const storage = new Map(saved ? [[storageKey, JSON.stringify(saved)]] : []);
  const node = () => ({
    innerHTML: "", textContent: "", hidden: true, dataset: {}, style: {}, scrollTop: 0,
    setAttribute() {}, removeAttribute() {}, focus() {}, matches() { return false; },
    scrollIntoView() {}, scrollTo(options) { this.scrollTop = options.top || 0; },
    querySelector() { return node(); }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, toggle() {} },
  });
  const listen = (target, type, callback) => target.set(type, [...(target.get(type) || []), callback]);
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock])); }
    static now() { return clock; }
  }
  class FormDataFixture {
    constructor(form) { this.values = Object.entries(form.values); }
    [Symbol.iterator]() { return this.values[Symbol.iterator](); }
  }
  const document = {
    hidden: false, visibilityState: "visible", body: { style: {} }, activeElement: node(),
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    querySelectorAll() { return []; }, addEventListener(type, callback) { listen(events, type, callback); },
  };
  const context = vm.createContext({
    document,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    location: { hash: "#praticar" }, history: { replaceState() {} },
    window: { katex, addEventListener(type, callback) { listen(windowEvents, type, callback); }, scrollTo() {} },
    setTimeout() { return ++timerId; }, clearTimeout() {},
    setInterval(callback) { intervals.set(++timerId, callback); return timerId; }, clearInterval(id) { intervals.delete(id); },
    Intl, Date: ClockDate, FormData: FormDataFixture, structuredClone, buildPracticeReport,
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++sessionId).padStart(12, "0")}` },
  });
  vm.runInContext(source, context);
  context.inputCatalog = catalog;
  vm.runInContext("catalog = inputCatalog; setCourse(state.activeCourse);", context);
  const run = code => vm.runInContext(code, context);
  return {
    nodes, storage, run,
    json: code => JSON.parse(run(`JSON.stringify(${code})`)),
    saved: () => JSON.parse(storage.get(storageKey)),
    tick(ms) { clock += ms; },
    flushIntervals() { for (const callback of [...intervals.values()]) callback(); },
    event(type, detail = {}) { for (const callback of events.get(type) || []) callback({ preventDefault() {}, ...detail }); },
    visibility(hidden) {
      document.hidden = hidden;
      document.visibilityState = hidden ? "hidden" : "visible";
      for (const callback of events.get("visibilitychange") || []) callback();
    },
    click(attribute, value) {
      const key = attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, char) => char.toUpperCase());
      const target = { dataset: { [key]: value }, closest(selector) { return selector === `[${attribute}]` ? this : null; } };
      for (const callback of events.get("click") || []) callback({ target, preventDefault() {} });
    },
  };
}

function answerCorrect(app) {
  app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer()");
}

test("starting a practice session records its course and filters without awarding progress", () => {
  const app = appHarness({ activeCourse: "matematica", practiceFilters: { matematica: { module: "mat-c1", competency: "1" } } });
  app.run("startPractice()");
  assert.equal(app.run("quiz.session.courseId"), "matematica");
  assert.equal(app.run("quiz.session.filters.module"), "mat-c1");
  assert.equal(app.run("quiz.session.filters.competency"), "1");
  assert.ok(app.run("quiz.session.id"));
  assert.equal(app.run("quiz.session.records.length"), 0);
  assert.equal(app.run("state.attempts.length"), 0);
  assert.equal(app.run("state.xp"), 0);
  assert.equal(app.run("state.practiceSessions.length"), 0);
  assert.ok(app.saved().pendingPractice);
});

test("pause freezes question and session time, blocks answers, and resume excludes paused time", () => {
  const app = appHarness();
  app.run("startPractice()");
  const first = app.run("quiz.questions[quiz.index].id");
  app.tick(5000);
  app.run("pausePractice()");
  assert.equal(app.run("quiz.paused"), true);
  assert.equal(app.run("quiz.timerStartedAt"), null);
  assert.equal(app.run("quiz.sessionTimerStartedAt"), null);
  assert.equal(app.run("quiz.elapsedMs"), 5000);
  assert.equal(app.run("quiz.session.activeMs"), 5000);
  app.tick(90000);
  app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); checkAnswer(); skipPracticeQuestion(); nextQuestion()");
  assert.equal(app.run("quiz.questions[quiz.index].id"), first);
  assert.equal(app.run("state.attempts.length"), 0);
  assert.equal(app.run("quiz.session.records.length"), 0);
  app.run("resumePractice()");
  app.tick(3000);
  answerCorrect(app);
  assert.equal(app.run("state.attempts[0].durationMs"), 8000);
  app.tick(12000);
  app.run("endPractice()");
  assert.equal(app.run("state.practiceSessions[0].activeMs"), 20000);
  assert.equal(app.run("state.practiceSessions[0].records[0].durationMs"), 8000);
  assert.equal(app.run("buildPracticeReport(state.practiceSessions[0], catalog).reviewMs"), 12000);
});

test("hidden browser time is excluded from the session and question clocks", () => {
  const app = appHarness();
  app.run("startPractice()");
  app.tick(4000);
  app.visibility(true);
  assert.equal(app.run("quiz.timerStartedAt"), null);
  assert.equal(app.run("quiz.sessionTimerStartedAt"), null);
  app.tick(60000);
  app.visibility(false);
  if (app.run("quiz.paused")) app.run("resumePractice()");
  app.tick(6000);
  answerCorrect(app);
  app.run("endPractice()");
  assert.equal(app.run("state.practiceSessions[0].activeMs"), 10000);
  assert.equal(app.run("state.practiceSessions[0].records[0].durationMs"), 10000);
});

test("skipped and unverified questions are recorded without becoming errors or awarding XP", () => {
  const app = appHarness();
  app.run("startPractice()");
  const skipped = app.run("quiz.questions[quiz.index].id");
  app.tick(5000);
  app.run("skipPracticeQuestion()");
  const unfinished = app.run("quiz.questions[quiz.index].id");
  app.tick(7000);
  app.run("selectAnswer(quiz.questions[quiz.index].correctAlternative); endPractice()");
  const records = app.json("state.practiceSessions[0].records");
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => [record.questionId, record.outcome, record.durationMs]), [[skipped, "skipped", 5000], [unfinished, "unfinished", 7000]]);
  assert.equal(records.filter(record => record.outcome === "answered").length, 0);
  assert.equal(app.run("state.attempts.length"), 0);
  assert.equal(app.run("state.answered.length"), 0);
  assert.equal(app.run("state.missed.length"), 0);
  assert.equal(app.run("state.xp"), 0);
  assert.equal(app.run("buildPracticeReport(state.practiceSessions[0], catalog).accuracy"), null);
  assert.equal(app.run("buildPracticeReport(state.practiceSessions[0], catalog).wrong"), 0);
  assert.ok(!app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
});

test("checking and finishing twice do not duplicate the attempt, session, or XP", () => {
  const app = appHarness();
  app.run("startPractice()");
  app.tick(2000);
  answerCorrect(app);
  app.run("checkAnswer(); endPractice(); endPractice()");
  assert.equal(app.run("quiz.ended"), true);
  assert.equal(app.run("state.attempts.length"), 1);
  assert.equal(app.run("state.practiceSessions.length"), 1);
  assert.equal(app.run("state.practiceSessions[0].records.length"), 1);
  assert.equal(app.run("state.practiceSessions[0].records[0].outcome"), "answered");
  assert.equal(app.run("state.xp"), 10);
  assert.equal(app.run("state.pendingPractice"), null);
  assert.ok(app.run("state.practiceSessions[0].endedAt"));
});

test("pending sessions resume paused after reload with the same question, selection, filters, and saved answers", () => {
  const app = appHarness({ activeCourse: "matematica", practiceFilters: { matematica: { module: "mat-c1", competency: "1" } } });
  app.run("startPractice()");
  app.tick(3000);
  answerCorrect(app);
  app.run("nextQuestion(); selectAnswer(quiz.questions[quiz.index].correctAlternative)");
  app.tick(4000);
  app.run("checkpointPractice()");
  const current = app.run("quiz.questions[quiz.index].id");
  const selected = app.run("quiz.selected");
  const id = app.run("quiz.session.id");
  const queue = app.json("quiz.queue");
  const reloaded = appHarness(app.saved(), initialTime + 3600000);
  reloaded.run("renderPractice()");
  assert.match(reloaded.nodes.get("#app").innerHTML, /Retomar sessão/);
  reloaded.run("resumeSavedPractice()");
  assert.equal(reloaded.run("quiz.paused"), true);
  assert.equal(reloaded.run("quiz.session.id"), id);
  assert.equal(reloaded.run("quiz.questions[quiz.index].id"), current);
  assert.equal(reloaded.run("quiz.selected"), selected);
  assert.deepEqual(reloaded.json("quiz.queue"), queue);
  assert.equal(reloaded.run("quiz.filters.module"), "mat-c1");
  assert.equal(reloaded.run("state.attempts.length"), 1);
  reloaded.tick(10000);
  reloaded.run("resumePractice()");
  reloaded.tick(2000);
  reloaded.run("checkAnswer(); endPractice()");
  assert.equal(reloaded.run("state.attempts.length"), 2);
  assert.equal(reloaded.run("state.xp"), 20);
  assert.equal(reloaded.run("state.practiceSessions[0].records.length"), 2);
  assert.equal(reloaded.run("state.practiceSessions[0].activeMs"), 9000);
  assert.equal(reloaded.run("state.practiceSessions[0].records[1].durationMs"), 6000);
});

test("a reload on the correction screen cannot record the same answer a second time", () => {
  const app = appHarness();
  app.run("startPractice()");
  app.tick(2000);
  answerCorrect(app);
  app.run("checkpointPractice()");
  const reloaded = appHarness(app.saved(), initialTime + 3600000);
  reloaded.run("resumeSavedPractice(); resumePractice(); checkAnswer(); endPractice()");
  assert.equal(reloaded.run("state.attempts.length"), 1);
  assert.equal(reloaded.run("state.practiceSessions[0].records.length"), 1);
  assert.equal(reloaded.run("state.xp"), 10);
});

test("completed sessions survive reload and their report can be reopened without changing progress", () => {
  const app = appHarness();
  app.run("startPractice()");
  app.tick(2000);
  answerCorrect(app);
  app.run("nextQuestion()");
  app.tick(3000);
  app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(answer => answer.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); endPractice()");
  const saved = app.saved();
  const reloaded = appHarness(saved);
  reloaded.run("renderPractice()");
  assert.match(reloaded.nodes.get("#app").innerHTML, /Sessões recentes/);
  reloaded.run("renderSessionReport(state.practiceSessions[0])");
  const html = reloaded.nodes.get("#lesson-modal").innerHTML;
  for (const dimension of ["topic", "subject", "area", "competency"]) assert.ok(html.includes(`data-session-dimension="${dimension}"`), dimension);
  assert.match(html, /data-session-question=/);
  assert.deepEqual(reloaded.json("state.attempts"), saved.attempts);
  assert.equal(reloaded.run("state.xp"), saved.xp);
  assert.deepEqual(reloaded.json("state.practiceSessions"), saved.practiceSessions);
});

test("report controls change the grouping and review a question without recording another attempt", () => {
  const app = appHarness();
  app.run("startPractice()");
  app.tick(2000);
  answerCorrect(app);
  const questionId = app.run("quiz.questions[quiz.index].id");
  app.run("endPractice(); closeQuiz()");
  const sessionId = app.run("state.practiceSessions[0].id");
  app.click("data-session-report", sessionId);
  assert.equal(app.nodes.get("#lesson-modal").hidden, false);
  for (const dimension of ["area", "subject", "competency", "topic"]) {
    app.click("data-session-dimension", dimension);
    assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes(`data-session-dimension="${dimension}" aria-pressed="true"`));
  }
  app.click("data-session-question", questionId);
  assert.ok(app.nodes.get("#lesson-modal").innerHTML.includes('class="explanation"'));
  assert.match(app.nodes.get("#lesson-modal").innerHTML, /Voltar ao relatório/);
  app.click("data-action", "back-session-report");
  assert.match(app.nodes.get("#lesson-modal").innerHTML, /Desempenho nesta sessão/);
  assert.equal(app.run("state.attempts.length"), 1);
  assert.equal(app.run("state.xp"), 10);
  assert.equal(app.run("state.practiceSessions.length"), 1);
});

test("a recommendation prepares the original subject and topic without starting or scoring a new session", () => {
  const original = catalog.questions.find(question => question.subjectId === "fisica");
  const app = appHarness({ activeCourse: "ciencias-natureza", practiceFilters: { "ciencias-natureza": { query: original.id } } });
  app.run("startPractice()");
  const questionId = app.run("quiz.questions[quiz.index].id");
  assert.equal(questionId, original.id);
  app.tick(1000);
  app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(answer => answer.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); endPractice()");
  const focusIndex = app.nodes.get("#lesson-modal").innerHTML.match(/data-session-focus="(\d+)"/)?.[1];
  assert.notEqual(focusIndex, undefined);
  app.click("data-session-focus", focusIndex);
  assert.equal(app.run("data.id"), original.subjectId);
  assert.equal(app.run("practiceFilters().module"), original.moduleId);
  assert.equal(app.run("activeView"), "praticar");
  assert.equal(app.run("quiz"), null);
  assert.equal(app.run("state.pendingPractice"), null);
  assert.equal(app.run("state.attempts.length"), 1);
  assert.equal(app.run("state.practiceSessions.length"), 1);
  assert.equal(app.run("state.xp"), 0);
});

for (const subjectId of ["arte", "filosofia"]) {
  test(`a ${subjectId} recommendation preserves its canonical subject and topic in the integrated course and submitted filters`, () => {
    const original = catalog.questions.find(question => question.subjectId === subjectId);
    assert.ok(original);
    assert.ok(!catalog.courses.some(course => course.id === subjectId));
    const course = catalog.courses.find(item => item.id === original.areaId);
    assert.equal(course.integrated, true);
    const app = appHarness({ activeCourse: course.id, practiceFilters: { [course.id]: { query: original.id } } });
    app.run("startPractice()");
    assert.equal(app.run("quiz.questions[quiz.index].id"), original.id);
    app.tick(1000);
    app.run("selectAnswer(quiz.questions[quiz.index].alternatives.find(answer => answer.letter !== quiz.questions[quiz.index].correctAlternative).letter); checkAnswer(); endPractice()");
    const focusIndex = app.nodes.get("#lesson-modal").innerHTML.match(/data-session-focus="(\d+)"/)?.[1];
    assert.notEqual(focusIndex, undefined);
    app.click("data-session-focus", focusIndex);
    const topic = `${subjectId}:${original.moduleId}`;
    assert.equal(app.run("data.id"), course.id);
    assert.equal(app.run("practiceFilters().subject"), subjectId);
    assert.equal(app.run("practiceFilters().topic"), topic);
    assert.equal(app.run("practiceFilters().module"), "");
    assert.equal(app.run("practiceFilters().query"), "");
    const courseIds = new Set(course.questionIds);
    const expected = new Set(catalog.questions.filter(question => courseIds.has(question.id) && question.subjectId === subjectId && question.moduleId === original.moduleId).map(question => question.id));
    assert.ok(expected.size > 0);
    assert.deepEqual(new Set(app.json("filteredPracticeQuestions().map(question => question.id)")), expected);

    // Use the actual rendered controls, so missing names or selected options fail
    // before exercising the same FormData submit path used by the browser.
    const html = app.nodes.get("#app").innerHTML;
    const values = {};
    for (const [, name, options] of html.matchAll(/<select name="([^"]+)">([\s\S]*?)<\/select>/g)) {
      const choices = [...options.matchAll(/<option value="([^"]*)"([^>]*)>/g)];
      values[name] = (choices.find(choice => /\bselected\b/.test(choice[2])) || choices[0])[1];
    }
    const query = html.match(/<input name="query"[^>]*\bvalue="([^"]*)"/);
    assert.ok(query);
    values.query = query[1];
    assert.equal(values.subject, subjectId);
    assert.equal(values.topic, topic);
    app.event("submit", { target: { id: "practice-filters", values } });
    assert.equal(app.run("practiceFilters().subject"), subjectId);
    assert.equal(app.run("practiceFilters().topic"), topic);
    assert.deepEqual(new Set(app.json("filteredPracticeQuestions().map(question => question.id)")), expected);
    assert.equal(app.saved().practiceFilters[course.id].topic, topic);
    assert.equal(app.run("state.attempts.length"), 1);
    assert.equal(app.run("state.practiceSessions.length"), 1);
    assert.equal(app.run("state.pendingPractice"), null);
  });
}

test("saving a paused session to return to filters preserves it without generating a final report", () => {
  const app = appHarness();
  app.run("startPractice()");
  const sessionId = app.run("quiz.session.id");
  const questionId = app.run("quiz.questions[quiz.index].id");
  app.tick(3000);
  app.click("data-action", "pause-practice");
  app.click("data-action", "save-practice-exit");
  assert.equal(app.run("quiz"), null);
  assert.equal(app.nodes.get("#lesson-modal").hidden, true);
  assert.equal(app.run("state.pendingPractice.session.id"), sessionId);
  assert.equal(app.run("state.practiceSessions.length"), 0);
  assert.match(app.nodes.get("#app").innerHTML, /Retomar sessão/);
  app.tick(60000);
  app.click("data-action", "resume-saved-practice");
  assert.equal(app.run("quiz.questions[quiz.index].id"), questionId);
  assert.equal(app.run("quiz.paused"), true);
  assert.equal(app.run("quiz.session.activeMs"), 3000);
});

test("session filters stay fixed and the same question is not repeated before the eligible pool is traversed", () => {
  const app = appHarness({ activeCourse: "matematica", practiceFilters: { matematica: { module: "mat-c1", competency: "1" } } });
  app.run("startPractice()");
  const expected = app.run("filteredPracticeQuestions(quiz.filters).length");
  assert.ok(expected > 3);
  app.run("state.practiceFilters.matematica = {...defaultPracticeFilters(), module: 'mat-c2'}");
  for (let index = 0; index < 4; index++) {
    assert.equal(app.run("quiz.questions[quiz.index].moduleId"), "mat-c1");
    app.tick(1000);
    answerCorrect(app);
    if (index < 3) app.run("nextQuestion()");
  }
  app.run("endPractice()");
  assert.equal(app.run("state.practiceSessions[0].filters.module"), "mat-c1");
  assert.equal(app.run("new Set(state.practiceSessions[0].records.map(record => record.questionId)).size"), 4);
});

test("legacy attempts remain in overall statistics and are never invented as practice sessions", () => {
  const questionId = catalog.courses.find(course => course.id === "matematica").questionIds[0];
  const at = "2026-10-13T14:00:00.000Z";
  const app = appHarness({ activeCourse: "matematica", answered: [questionId], xp: 10, attempts: [{ questionId, correct: true, at, day: "2026-10-13", durationMs: 3000, mode: "practice", courseId: "matematica" }] });
  app.run("renderPractice()");
  assert.equal(app.run("state.attempts.length"), 1);
  assert.equal(app.run("performanceMetrics(courseAttempts()).accuracy"), 100);
  assert.equal(app.run("state.practiceSessions.length"), 0);
  assert.equal(app.run("state.pendingPractice"), null);
  assert.equal(app.run("state.xp"), 10);
});

test("session history is bounded to the latest twenty without truncating answer history", () => {
  const app = appHarness();
  const ids = [];
  for (let index = 0; index < 22; index++) {
    app.tick(1000);
    app.run("startPractice()");
    ids.push(app.run("quiz.session.id"));
    app.tick(1000);
    answerCorrect(app);
    app.run("endPractice(); closeQuiz()");
  }
  const retained = new Set(app.json("state.practiceSessions.map(session => session.id)"));
  assert.equal(retained.size, 20);
  assert.deepEqual(retained, new Set(ids.slice(-20)));
  assert.equal(app.run("state.attempts.length"), 22);
  assert.equal(app.run("state.xp"), 220);
  assert.equal(app.saved().practiceSessions.length, 20);
});
