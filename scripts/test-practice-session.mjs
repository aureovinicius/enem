import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPracticeReport } from "../dist/practice-session.js";

const catalog = {
  matrix: { areas: {
    "ciencias-natureza": { title: "Ciências da Natureza", competencies: [{ number: 1, description: "Fenômenos naturais" }] },
    linguagens: { title: "Linguagens", competencies: [{ number: 1, description: "Comunicação" }] },
  } },
  courses: [{ id: "fisica", title: "Física", modules: [{ id: "ondas", title: "Ondas" }] }],
  questions: [
    { id: "f1", title: "Questão de ondas", areaId: "ciencias-natureza", subjectId: "fisica", subjectTitle: "Física", moduleId: "ondas", moduleTitle: "Ondas", competency: 1 },
    { id: "f2", title: "Questão de som", areaId: "ciencias-natureza", subjectId: "fisica", subjectTitle: "Física", moduleId: "ondas", moduleTitle: "Ondas", competency: 1 },
    { id: "f3", title: "Questão de luz", areaId: "ciencias-natureza", subjectId: "fisica", subjectTitle: "Física", moduleId: "ondas", moduleTitle: "Ondas", competency: 1 },
    { id: "q1", title: "Questão de química", areaId: "ciencias-natureza", subjectId: "quimica", subjectTitle: "Química", moduleId: "reacoes", moduleTitle: "Reações", competency: 5 },
    { id: "p1", title: "Questão de texto", areaId: "linguagens", subjectId: "portugues", subjectTitle: "Língua Portuguesa", moduleId: "leitura", moduleTitle: "Leitura", competency: 1 },
    { id: "a1", title: "Questão de arte", areaId: "linguagens", subjectId: "arte", subjectTitle: "Arte", moduleId: "lc-arte", moduleTitle: "Arte", competency: 4 },
    { id: "e1", title: "Questão de esporte", areaId: "linguagens", subjectId: "educacao-fisica", subjectTitle: "Educação Física", moduleId: "lc-corpo", moduleTitle: "Corpo", competency: 3 },
  ],
};
const answered = (questionId, correct, durationMs = 1000) => ({ questionId, answer: correct ? "A" : "B", outcome: "answered", correct, durationMs });

test("session metrics exclude skipped and unfinished items from accuracy and average answer time", () => {
  const report = buildPracticeReport({ activeMs: 20000, records: [
    answered("f1", true, 4000), answered("q1", false, 6000),
    { questionId: "p1", outcome: "skipped", correct: null, durationMs: 2000 },
    { questionId: "a1", outcome: "unfinished", correct: null, durationMs: 3000 },
  ] }, catalog);
  assert.equal(report.total, 2);
  assert.equal(report.correct, 1);
  assert.equal(report.wrong, 1);
  assert.equal(report.accuracy, 50);
  assert.equal(report.averageMs, 5000);
  assert.equal(report.answerMs, 10000);
  assert.equal(report.skipped, 1);
  assert.equal(report.skippedMs, 2000);
  assert.equal(report.unfinished, 1);
  assert.equal(report.unfinishedMs, 3000);
  assert.equal(report.recordedMs, 15000);
  assert.equal(report.reviewMs, 5000);
  assert.equal(report.activeMs, 20000);
  assert.equal(report.groups.subject.length, 2);
});

test("competencies with the same number stay separate across areas", () => {
  const report = buildPracticeReport({ records: [answered("f1", true), answered("p1", false)] }, catalog);
  assert.equal(report.groups.area.length, 2);
  assert.deepEqual(report.groups.competency.map(group => [group.id, group.correct, group.wrong]), [
    ["ciencias-natureza:c1", 1, 0], ["linguagens:c1", 0, 1],
  ]);
  assert.equal(report.groups.competency[0].description, "Fenômenos naturais");
});

test("the canonical catalog, not an integrated course or record metadata, defines subjects and topics", () => {
  const report = buildPracticeReport({ courseId: "ciencias-natureza", records: [
    { ...answered("f1", true), moduleId: "cn-c1", moduleTitle: "Ciência integrada", subjectTitle: "Ciências da Natureza" },
    answered("q1", false), answered("a1", true),
  ] }, catalog);
  assert.deepEqual(report.groups.subject.map(group => group.title), ["Arte", "Física", "Química"]);
  assert.ok(report.groups.topic.some(group => group.moduleId === "ondas" && group.subjectId === "fisica"));
  assert.ok(!report.groups.topic.some(group => group.moduleId === "cn-c1"));
  assert.equal(report.slowest.find(item => item.questionId === "f1").moduleTitle, "Ondas");
});

test("top five groups repeated questions and sums only time spent answering", () => {
  const records = catalog.questions.map((question, index) => answered(question.id, index % 2 === 0, (index + 1) * 1000));
  records.push(answered("f1", false, 9000));
  records.push({ questionId: "p1", outcome: "skipped", durationMs: 90000 });
  const report = buildPracticeReport({ records }, catalog);
  assert.equal(report.total, 8);
  assert.equal(report.unique, 7);
  assert.equal(report.slowest.length, 5);
  assert.deepEqual(report.slowest.map(item => item.questionId), ["f1", "e1", "a1", "p1", "q1"]);
  assert.deepEqual([report.slowest[0].durationMs, report.slowest[0].attempts, report.slowest[0].correct, report.slowest[0].wrong], [10000, 2, 1, 1]);
  assert.equal(report.groups.topic.find(group => group.moduleId === "ondas").unique, 3);
  assert.equal(report.groups.topic.find(group => group.moduleId === "ondas").total, 4);
});

test("zero answers produce no artificial percentage, speed or recommendation of proficiency", () => {
  for (const session of [null, {}, { activeMs: 3000, records: [{ questionId: "f1", outcome: "skipped", durationMs: 3000 }] }]) {
    const report = buildPracticeReport(session, catalog);
    assert.equal(report.accuracy, null);
    assert.equal(report.total, 0);
    assert.equal(report.averageMs, 0);
    assert.deepEqual(report.groups, { area: [], subject: [], topic: [], competency: [] });
    assert.deepEqual(report.slowest, []);
    assert.match(report.recommendations[0].title, /Ainda não há respostas/);
  }
});

test("invalid records are excluded and nonfinite or negative times cannot corrupt totals", () => {
  const report = buildPracticeReport({ activeMs: -10, records: [
    null, {}, answered("missing", true, 500), { questionId: "f1", outcome: "answered", correct: null },
    { questionId: "f1", outcome: "answered", correct: "false" },
    { questionId: "f1", outcome: "other", correct: true },
    answered("f1", false, -100), answered("f2", true, Number.NaN),
    answered("f3", true, Number.POSITIVE_INFINITY), answered("q1", true, "2000"),
    answered("p1", true, 1200.4),
  ] }, catalog);
  assert.equal(report.invalidRecords, 6);
  assert.equal(report.total, 5);
  assert.equal(report.accuracy, 80);
  assert.equal(report.answerMs, 1200);
  assert.equal(report.activeMs, 1200);
  assert.equal(report.reviewMs, 0);
  assert.equal(report.averageMs, 240);
});

test("too-small saved active time is reconciled with recorded item time", () => {
  const report = buildPracticeReport({ activeMs: 1000, records: [answered("f1", true, 2000), { questionId: "f2", outcome: "unfinished", durationMs: 3000 }] }, catalog);
  assert.equal(report.activeMs, 5000);
  assert.equal(report.recordedMs, 5000);
  assert.equal(report.reviewMs, 0);
});

test("unclassified metadata stays visible without joining unrelated dimensions", () => {
  const minimalCatalog = { questions: [{ id: "x" }, { id: "y", areaId: "linguagens", subjectId: "arte", subjectTitle: "Arte" }] };
  const report = buildPracticeReport({ records: [answered("x", false), answered("y", true)] }, minimalCatalog);
  assert.equal(report.total, 2);
  assert.equal(report.groups.topic.length, 2);
  assert.equal(report.groups.competency.length, 2);
  assert.ok(report.groups.area.some(group => group.title === "Área não informada"));
  assert.ok(report.groups.competency.every(group => group.competency === null));
});

test("recommendations prioritize observed topic errors and expose supporting counts", () => {
  const report = buildPracticeReport({ records: [answered("f1", false), answered("f2", false), answered("f3", false), answered("q1", false), answered("a1", true)] }, catalog);
  assert.equal(report.recommendations[0].moduleId, "ondas");
  assert.equal(report.recommendations[0].subjectId, "fisica");
  assert.match(report.recommendations[0].body, /3 erros em 3 respostas/);
  assert.match(report.recommendations[0].body, /3 questões diferentes/);
  assert.equal(report.recommendations[1].moduleId, "reacoes");
  assert.match(report.recommendations[1].body, /amostra deste assunto é pequena/);
});

test("one or two unique questions retain a small-sample warning even after many repeated attempts", () => {
  for (const records of [[answered("f1", false)], [answered("f1", false), answered("f2", true)], Array.from({ length: 8 }, () => answered("f1", false))]) {
    const report = buildPracticeReport({ records }, catalog);
    assert.match(report.recommendations[0].title, /amostra inicial/);
    assert.match(report.recommendations[0].body, /pouca evidência/);
    assert.match(report.recommendations.find(item => item.moduleId === "ondas").body, /amostra deste assunto é pequena/);
  }
});

test("all-correct sessions encourage broader practice without inventing weak topics", () => {
  const report = buildPracticeReport({ records: [answered("f1", true), answered("q1", true), answered("a1", true)] }, catalog);
  assert.equal(report.accuracy, 100);
  assert.ok(report.recommendations.some(item => /Amplie a variedade/.test(item.title)));
  assert.ok(!report.recommendations.some(item => item.moduleId));
  assert.ok(!report.recommendations.some(item => /probabilidade|nota prevista|lento demais|rápido demais/.test(item.body)));
});

test("recommendations distinguish repeated attempts from wider evidence", () => {
  const report = buildPracticeReport({ records: [answered("f1", true), answered("f1", true), answered("q1", true), answered("a1", true)] }, catalog);
  const repeat = report.recommendations.find(item => item.title === "Confirme o aprendizado com questões novas");
  assert.match(repeat.body, /4 respostas incluem 3 questões diferentes/);
});

test("report is pure and reproducible, including ties in the slowest list", () => {
  const session = { records: [answered("q1", true), answered("f1", false)], activeMs: 3000 };
  const before = JSON.stringify({ session, catalog });
  const first = buildPracticeReport(session, catalog);
  assert.deepEqual(first, buildPracticeReport(session, catalog));
  assert.equal(JSON.stringify({ session, catalog }), before);
  assert.deepEqual(first.slowest.map(item => item.questionId), ["f1", "q1"]);
  assert.doesNotThrow(() => JSON.stringify(first));
});

test("published catalog covers every area and integrated-only subject using canonical metadata", () => {
  const actual = JSON.parse(readFileSync(new URL("../dist/data/courses.json", import.meta.url), "utf8"));
  const questions = actual.questions.filter((question, index, all) => all.findIndex(item => item.subjectId === question.subjectId) === index);
  const report = buildPracticeReport({ courseId: "linguagens", records: questions.map(question => answered(question.id, true)) }, actual);
  assert.equal(report.total, questions.length);
  assert.equal(report.groups.area.length, 4);
  assert.equal(report.groups.subject.length, questions.length);
  for (const question of questions) {
    assert.ok(report.groups.topic.some(group => group.moduleId === question.moduleId && group.subjectId === question.subjectId));
    assert.ok(report.groups.competency.some(group => group.areaId === question.areaId && group.competency === question.competency));
  }
});
