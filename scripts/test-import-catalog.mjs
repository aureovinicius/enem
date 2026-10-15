import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = path => JSON.parse(readFileSync(path, "utf8"));
const catalog = read("dist/data/courses.json");
const progress = read("data/enem/import-progress.json");
const raw = read("data/enem/all-questions.json");
const id = q => `${q.year}-${q.index}${q.language ? `-${q.language}` : ""}`;

test("annual imports account for every source record and never duplicate the curated catalog", () => {
  const enabled = progress.batches.map(b => b.year).sort();
  assert.deepEqual([...catalog.imports.years].sort(), enabled);
  const questions = [...catalog.questions, ...catalog.practiceQuestions];
  assert.equal(new Set(questions.map(q => q.id)).size, questions.length);
  for (const batch of catalog.imports.batches) {
    const source = raw.questions.filter(q => q.year === batch.year);
    assert.equal(batch.total, source.length);
    const available = new Set(questions.filter(q => q.year === batch.year).map(q => q.id));
    const excluded = new Set(catalog.imports.excluded.filter(q => q.year === batch.year).map(q => q.id));
    assert.equal(available.size + excluded.size, source.length);
    for (const q of source) assert.notEqual(available.has(id(q)), excluded.has(id(q)), id(q));
  }
  assert.ok(progress.batches.filter(b => b.status !== "published").length <= 1, "Only one batch may await deployment");
});

test("all newly imported questions retain source answers, local media and honest metadata", () => {
  const original = new Map(raw.questions.map(q => [id(q), q]));
  for (const q of catalog.practiceQuestions) {
    const source = original.get(q.id);
    assert.ok(source, q.id);
    assert.equal(q.correctAlternative, source.correctAlternative, q.id);
    assert.equal(q.explanation, null, q.id);
    assert.equal(q.competency, null, q.id);
    assert.equal(q.skill, null, q.id);
    assert.ok(q.imported && enabledYear(q.year), q.id);
    assert.equal(q.alternatives.length, 5, q.id);
    const serialized = JSON.stringify(q);
    for (const match of serialized.matchAll(/\/assets\/questions\/[^\s"\\)]+/g)) assert.ok(existsSync(`dist${match[0]}`), match[0]);
    assert.ok(!/https:\/\/enem\.dev\/\d+\/questions\//.test(serialized), `Remote media: ${q.id}`);
    const courses = catalog.courses.filter(c => c.practiceQuestionIds.includes(q.id));
    assert.ok(courses.some(c => c.id === q.areaId), `Missing area access: ${q.id}`);
    assert.ok(courses.every(c => c.id === q.areaId || c.id === q.subjectId), q.id);
    assert.ok(catalog.courses.every(c => !c.questionIds.includes(q.id)), `Imported question entered lessons: ${q.id}`);
  }
});
function enabledYear(year) { return progress.batches.some(b => b.year === year); }
