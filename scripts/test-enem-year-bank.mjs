import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildYearBank } from "./enem-year-bank.mjs";

function question(index, extra = {}) {
  return {
    year: 2023, index, title: `Questão ${index} - ENEM 2023`, language: null, discipline: "ciencias-natureza",
    context: "Enunciado preservado.", alternativesIntroduction: "Qual é a alternativa correta?", files: [], correctAlternative: "A",
    alternatives: ["A", "B", "C", "D", "E"].map(letter => ({ letter, text: `Alternativa ${letter}`, file: null, isCorrect: letter === "A" })),
    ...extra,
  };
}

function parameters(index, extra = {}) {
  return { year: 2023, questionNumber: index, officialAnswer: "A", language: null, area: "CN", a: 1.2, b: 0.4, c: 0.2, difficultyScore: 540,
    sourceUrl: "https://download.inep.gov.br/microdados/microdados_enem_2023.zip", matchMethod: "verified_fixture", ...extra };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "enem-year-bank-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const courses = ["ciencias-natureza", "ciencias-humanas", "linguagens", "matematica", "fisica", "portugues", "ingles", "espanhol"].map(id => ({ id, questionIds: [] }));
  const snapshot = { source: "https://api.enem.dev/v1", questions: [], total: 0 };
  const write = async (relative, value) => {
    const file = path.join(root, relative);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value));
  };
  const run = (options = {}) => buildYearBank({ root, snapshot, curatedQuestions: [], courses, tri: {}, years: [2023], ...options });
  return { root, courses, snapshot, write, run };
}

test("enabled years add unique new items only to area, mathematics and language practice pools", async t => {
  const f = await fixture(t);
  const existing = question(1);
  f.snapshot.questions = [existing, question(2), question(2), question(3, { discipline: "matematica" }), question(4, { discipline: "linguagens", language: "ingles" }), question(4, { discipline: "linguagens", language: "espanhol" }), question(5, { year: 2022 })];
  const curated = [{ ...existing, id: "2023-1", subjectId: "fisica", competency: 1, explanation: { concept: "Curada" } }];
  for (const course of f.courses.filter(course => ["fisica", "ciencias-natureza"].includes(course.id))) course.questionIds.push("2023-1");
  const sourceBefore = JSON.stringify(f.snapshot);
  const curatedBefore = JSON.stringify(curated);
  const { practiceQuestions: added, imports } = await f.run({ curatedQuestions: curated, years: [2023, 2023] });
  assert.equal(added.length, 4);
  assert.equal(imports.rawTotal, 5);
  assert.equal(imports.availableTotal, 5);
  assert.equal(imports.addedTotal, 4);
  assert.deepEqual(imports.batches, [{ year: 2023, total: 5, existing: 1, added: 4, excluded: 0 }]);
  const byCourse = Object.fromEntries(f.courses.map(course => [course.id, course.practiceQuestionIds]));
  assert.deepEqual(byCourse.fisica, ["2023-1"]);
  assert.deepEqual(byCourse.portugues, []);
  assert.deepEqual(byCourse["ciencias-natureza"], ["2023-1", "2023-2"]);
  assert.deepEqual(byCourse.matematica, ["2023-3"]);
  assert.deepEqual(new Set(byCourse.linguagens), new Set(["2023-4-ingles", "2023-4-espanhol"]));
  assert.deepEqual(byCourse.ingles, ["2023-4-ingles"]);
  assert.deepEqual(byCourse.espanhol, ["2023-4-espanhol"]);
  const unclassified = added.find(item => item.id === "2023-2");
  assert.equal(unclassified.subjectId, "ciencias-natureza-sem-classificacao");
  assert.match(unclassified.subjectTitle, /não classificada/);
  for (const item of added) {
    assert.equal(item.imported, true);
    assert.equal(item.moduleId, "acervo-api");
    assert.equal(item.competency, null);
    assert.equal(item.skill, null);
    assert.equal(item.explanation, null);
    assert.ok(item.sourceUrl.startsWith("https://api.enem.dev/v1/exams/2023/questions/"));
  }
  assert.equal(added.find(item => item.language === "ingles").subjectTitle, "Inglês");
  assert.equal(JSON.stringify(f.snapshot), sourceBefore);
  assert.equal(JSON.stringify(curated), curatedBefore);
});

test("a verified official identity fixes the API area while preserving original source fields", async t => {
  const f = await fixture(t);
  f.snapshot.questions = [question(1, { discipline: "ciencias-humanas" })];
  const result = await f.run({ tri: { questions: { "2023-1": parameters(1) } } });
  const imported = result.practiceQuestions[0];
  assert.equal(imported.discipline, "ciencias-humanas");
  assert.equal(imported.sourceAreaId, "ciencias-humanas");
  assert.equal(imported.areaId, "ciencias-natureza");
  assert.equal(imported.subjectId, "ciencias-natureza-sem-classificacao");
  assert.equal(imported.areaClassificationSource, "INEP");
  assert.equal(imported.areaClassificationSourceUrl, parameters(1).sourceUrl);
  assert.deepEqual(imported.tri, parameters(1));
  assert.equal(imported.triUnavailable, null);
  assert.deepEqual(f.courses.find(course => course.id === "ciencias-natureza").practiceQuestionIds, ["2023-1"]);
  assert.deepEqual(f.courses.find(course => course.id === "ciencias-humanas").practiceQuestionIds, []);
});

test("TRI parameters must match year, number, answer and language and retain official provenance", async t => {
  const f = await fixture(t);
  f.snapshot.questions = Array.from({ length: 8 }, (_, i) => question(i + 1, { discipline: "linguagens", language: "ingles" }));
  const fields = [{ year: 2022 }, { questionNumber: 99 }, { language: "espanhol" }, { sourceUrl: "https://example.org/parameters.json" }, { difficultyScore: 700 }, { b: null }, { officialAnswer: "B" }, { area: "CN" }];
  const tri = { questions: Object.fromEntries(fields.map((field, i) => [`2023-${i + 1}-ingles`, parameters(i + 1, { area: "LC", language: "ingles", ...field })])) };
  const result = await f.run({ tri });
  assert.equal(result.practiceQuestions.length, 7);
  assert.ok(result.practiceQuestions.every(item => item.tri === null));
  assert.ok(result.imports.excluded.find(item => item.id === "2023-7-ingles" && item.reasons.some(reason => /divergente/.test(reason))));
  assert.ok(result.practiceQuestions.filter(item => ["2023-1-ingles", "2023-2-ingles", "2023-3-ingles", "2023-4-ingles", "2023-8-ingles"].includes(item.id)).every(item => item.areaClassificationSource === "API enem.dev"));
});

test("a verified booklet fixes the area of an ambiguous language item without inventing its language or TRI", async t => {
  const f = await fixture(t);
  f.snapshot.questions = [question(5, { year: 2020, discipline: "ciencias-humanas" })];
  const tri = { unavailable: { "2020-5": { year: 2020, area: "LC", reason: "ambiguous_or_missing_official_item" } },
    years: [{ year: 2020, sourceUrl: "https://download.inep.gov.br/microdados/microdados_enem_2020.zip",
      areas: { LC: { sequenceValidated: true, color: "AZUL", application: "regular", comparableAnswers: 49 } } }] };
  const result = await f.run({ years: [2020], tri });
  assert.equal(result.practiceQuestions[0].areaId, "linguagens");
  assert.equal(result.practiceQuestions[0].sourceAreaId, "ciencias-humanas");
  assert.equal(result.practiceQuestions[0].language, null);
  assert.equal(result.practiceQuestions[0].tri, null);
  tri.years[0].areas.LC.sequenceValidated = false;
  assert.equal((await f.run({ years: [2020], tri })).practiceQuestions[0].areaClassificationSource, "API enem.dev");
});

test("official cancellation and wrong keys are excluded, while nonconvergent TRI remains usable", async t => {
  const f = await fixture(t);
  f.snapshot.questions = [question(1), question(2), question(3), question(4)];
  const tri = { sourceIndexUrl: "https://www.gov.br/inep/microdados", unavailable: {
    "2023-1": { year: 2023, reason: "official_item_abandoned", officialAnswer: "X" },
    "2023-2": { year: 2023, reason: "api_official_answer_mismatch", officialAnswer: "C" },
    "2023-3": { year: 2023, reason: "official_item_abandoned", officialAnswer: "A", area: "MT", examCode: 1, itemCode: 2, officialAbandonmentReason: "Não permitiu a convergência do algoritmo de estimação da TRI" },
    "2023-4": { year: 2023, reason: "ambiguous_or_missing_official_item", area: "CH" },
  } };
  const { practiceQuestions, imports } = await f.run({ tri });
  assert.deepEqual(practiceQuestions.map(item => item.id), ["2023-3", "2023-4"]);
  assert.equal(practiceQuestions[0].areaId, "matematica");
  assert.equal(practiceQuestions[0].subjectId, "matematica");
  assert.equal(practiceQuestions[0].tri, null);
  assert.equal(practiceQuestions[0].triUnavailable.reason, "official_item_abandoned");
  assert.equal(practiceQuestions[1].areaId, "ciencias-natureza");
  assert.equal(practiceQuestions[1].areaClassificationSource, "API enem.dev");
  assert.deepEqual(imports.batches, [{ year: 2023, total: 4, existing: 0, added: 2, excluded: 2 }]);
});

test("invalid alternative counts, letters, flags, duplicate content and missing content are excluded", async t => {
  const f = await fixture(t);
  const items = Array.from({ length: 7 }, (_, i) => question(i + 1));
  items[0].alternatives.pop();
  items[1].alternatives[1].letter = "A";
  items[2].alternatives[1].isCorrect = true;
  items[3].correctAlternative = "B";
  items[4].alternatives[1].text = items[4].alternatives[0].text;
  items[5].alternatives[0].text = "";
  items[6].alternatives[0].isCorrect = "true";
  f.snapshot.questions = items;
  const result = await f.run();
  assert.equal(result.practiceQuestions.length, 0);
  assert.equal(result.imports.excluded.length, items.length);
  assert.ok(result.imports.excluded.every(item => item.reasons.length));
});

test("self-contained prompts are allowed but an absent prompt or malformed context is excluded", async t => {
  const f = await fixture(t);
  f.snapshot.questions = [question(1, { context: null }), question(2, { alternativesIntroduction: " " }), question(3, { context: {} })];
  const { practiceQuestions, imports } = await f.run();
  assert.deepEqual(practiceQuestions.map(item => item.id), ["2023-1"]);
  assert.equal(imports.excluded.length, 2);
});

test("content exclusions are respected without excluding pending explanations or former Physics misclassification", async t => {
  const f = await fixture(t);
  await f.write("data/learning/review-report.json", { excluded: [
    { id: "2023-1", reason: "O enunciado está incompleto: faltam dados essenciais." },
    { id: "2023-2", reason: "Aguardando resolução comentada e revisão editorial." },
    { id: "2023-3", reason: "Questão de Química classificada indevidamente como Mecânica." },
  ] });
  await f.write("data/learning/explanations-fixture.json", {
    "2023-4": { excludeReason: "O gabarito é inconsistente com os dados." },
    "2023-5": { exclReason: "A imagem está ausente da fonte." },
  });
  f.snapshot.questions = Array.from({ length: 6 }, (_, i) => question(i + 1));
  f.snapshot.questions[5].excludeReason = "O contexto é incompleto.";
  const { practiceQuestions, imports } = await f.run();
  assert.deepEqual(practiceQuestions.map(item => item.id), ["2023-2", "2023-3"]);
  assert.equal(imports.excluded.length, 4);
});

test("context, prompt, alternative and file-list images are normalized and copied from local source", async t => {
  const f = await fixture(t);
  const prefix = "https://enem.dev/2023/questions/1-ingles/";
  const item = question(1, { discipline: "linguagens", language: "ingles", context: `![](${prefix}context.png)`, files: [`${prefix}listed.webp`], alternativesIntroduction: `Observe ![](${prefix}prompt.jpg) e responda.` });
  item.alternatives[1].text = null;
  item.alternatives[1].file = `${prefix}alternative.gif`;
  item.alternatives[2].text = `<img src="${prefix}inline.svg">`;
  for (const file of ["context.png", "listed.webp", "prompt.jpg", "alternative.gif", "inline.svg"]) await f.write(`data/enem-source/public/2023/questions/1-ingles/${file}`, `fixture ${file}`);
  f.snapshot.questions = [item];
  const result = await f.run();
  assert.equal(result.imports.excluded.length, 0);
  const imported = result.practiceQuestions[0];
  assert.equal(imported.context, "![](/assets/questions/2023/1-ingles/context.png)");
  assert.deepEqual(imported.files, ["/assets/questions/2023/1-ingles/listed.webp"]);
  assert.equal(imported.alternatives[1].file, "/assets/questions/2023/1-ingles/alternative.gif");
  assert.match(imported.alternativesIntroduction, /\/assets\/questions\/2023\/1-ingles\/prompt.jpg/);
  for (const file of ["context.png", "listed.webp", "prompt.jpg", "alternative.gif", "inline.svg"]) assert.equal(await readFile(path.join(f.root, "dist/assets/questions/2023/1-ingles", file), "utf8"), `fixture ${file}`);
});

test("missing images, broken placeholders, remote-only images and traversal paths are excluded", async t => {
  const f = await fixture(t);
  const references = ["https://enem.dev/2023/questions/1/missing.png", "https://enem.dev/broken-image.svg", "https://example.org/question.png", "https://enem.dev/2023/questions/4/%2e%2e/hidden.png"];
  f.snapshot.questions = references.map((reference, index) => question(index + 1, { context: `![](${reference})` }));
  const result = await f.run();
  assert.equal(result.practiceQuestions.length, 0);
  assert.equal(result.imports.excluded.length, 4);
  assert.ok(result.imports.excluded.every(item => item.reasons.some(reason => /imagem|Imagem/.test(reason))));
});

test("conflicting duplicate IDs are excluded while curated IDs and source identity stay unchanged", async t => {
  const f = await fixture(t);
  const one = question(1);
  f.snapshot.questions = [one, { ...one, context: "Outro enunciado" }, question(2), { ...question(2), context: "Versão divergente" }];
  const curated = [{ ...question(2), id: "2023-2" }];
  const result = await f.run({ curatedQuestions: curated });
  assert.equal(result.practiceQuestions.length, 0);
  assert.equal(result.imports.rawTotal, 2);
  assert.equal(result.imports.availableTotal, 1);
  assert.equal(result.imports.excluded.length, 1);
  assert.equal(result.imports.excluded[0].id, "2023-1");
  assert.match(result.imports.excluded[0].reasons[0], /conflitantes/);
});

test("empty and multiple year batches stay ordered and re-running never duplicates course membership", async t => {
  const f = await fixture(t);
  f.snapshot.questions = [question(2), question(1, { year: 2022 })];
  const first = await f.run({ years: [2023, 2022, 2021] });
  const second = await f.run({ years: [2023, 2022, 2021] });
  assert.deepEqual(first, second);
  assert.deepEqual(first.imports.years, [2021, 2022, 2023]);
  assert.deepEqual(first.imports.batches[0], { year: 2021, total: 0, existing: 0, added: 0, excluded: 0 });
  assert.deepEqual(f.courses.find(course => course.id === "ciencias-natureza").practiceQuestionIds, ["2022-1", "2023-2"]);
  const empty = await f.run({ years: [] });
  assert.equal(empty.imports.rawTotal, 0);
  assert.deepEqual(empty.practiceQuestions, []);
  assert.ok(f.courses.every(course => course.practiceQuestionIds.length === 0));
});
