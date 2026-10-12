#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const read = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const [snapshot, physics, matrix, mapping, nature] = await Promise.all([
  read("data/enem/all-questions.json"), read("dist/data/physics-questions.json"),
  read("data/reference/matrix.json"), read("data/courses/physics-mapping.json"), read("data/courses/natureza.json"),
]);
const subjectCourses = await Promise.all(["quimica", "biologia", "matematica"].map((id) => read(`data/courses/${id}.json`)));
const savedLayout = await read("data/courses/lesson-layout.json");
let tri = { questions: {}, coverage: [] };
try { tri = await read("data/reference/tri-parameters.json"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const officialArea = (courseId) => courseId === "matematica" ? "matematica" : "ciencias-natureza";
const physicsSkills = Object.entries(mapping).flatMap(([skill, ids]) => ids.map((id) => [id, Number(skill)]));
assert.equal(new Set(physicsSkills.map(([id]) => id)).size, physicsSkills.length, "Repeated physics mapping");
const skillsById = new Map(physicsSkills);
const physicsCourse = {
  id: "fisica", title: "Física", emoji: "⚛️",
  description: "Movimento, energia, calor, ondas e eletricidade em lições curtas.",
  modules: physics.modules.map(({ keywords, ...module }) => module),
  questions: physics.questions.map((q) => {
    const skill = skillsById.get(q.id);
    assert.ok(skill, `Missing physics skill ${q.id}`);
    const competency = matrix.areas["ciencias-natureza"].competencies.find((c) => c.skills.some((s) => s.number === skill)).number;
    return { id: q.id, moduleId: q.moduleId, skill, competency, explanation: q.explanation };
  }),
};
const questions = [];
const courses = [];
const seenIds = new Set();
const colors = [["#35b66f", "#178655"], ["#37a8e5", "#147eb8"], ["#8d6bdd", "#6547ae"], ["#f06d62", "#bd423e"], ["#d89921", "#ab7210"]];
function validateIntro(module) {
  const i = module.introduction;
  assert.ok(i?.title && i.summary && i.duration && i.pitfall, `Incomplete introduction ${module.id}`);
  assert.ok(i.sections?.length >= 3 && i.example?.steps?.length >= 2, `Incomplete concepts ${module.id}`);
  for (const section of i.sections) assert.ok(section.title && section.text, `Empty section ${module.id}`);
}
for (const course of [physicsCourse, ...subjectCourses]) {
  const areaId = officialArea(course.id);
  const area = matrix.areas[areaId];
  const modules = course.modules.map((m, index) => {
    validateIntro(m);
    const competence = m.competency ? area.competencies.find((c) => c.number === m.competency) : null;
    if (m.competency) assert.ok(competence, `Invalid unit competency ${m.id}`);
    return { ...m, color: colors[index % colors.length], ...(competence ? { reference: competence } : {}) };
  });
  for (const entry of course.questions) {
    assert.ok(!seenIds.has(entry.id), `Question belongs to two individual subjects: ${entry.id}`);
    seenIds.add(entry.id);
    const original = snapshot.questions.find((q) => `${q.year}-${q.index}` === entry.id && q.discipline === areaId);
    assert.ok(original, `Missing question or wrong area: ${entry.id}`);
    const module = modules.find((m) => m.id === entry.moduleId);
    assert.ok(module, `Invalid unit ${entry.id}`);
    const competence = area.competencies.find((c) => c.number === entry.competency);
    assert.ok(competence?.skills.some((s) => s.number === entry.skill), `Skill does not match competence: ${entry.id}`);
    if (module.competency) assert.equal(entry.competency, module.competency, `Wrong unit: ${entry.id}`);
    assert.ok(entry.explanation?.concept && entry.explanation.steps?.length >= 2 && entry.explanation.takeaway, `No explanation: ${entry.id}`);
    assert.ok(original.alternatives.some((a) => a.letter === original.correctAlternative), `Invalid answer ${entry.id}`);
    const prefix = `https://enem.dev/${original.year}/questions/${original.index}/`;
    const normalized = JSON.parse(JSON.stringify(original).replaceAll(prefix, `/assets/questions/${original.year}/${original.index}/`));
    const parameters = tri.questions[entry.id];
    if (parameters) {
      assert.ok(Number.isFinite(parameters.b) && Number.isFinite(parameters.difficultyScore), `Invalid TRI ${entry.id}`);
      assert.equal(parameters.year, original.year, `Wrong TRI year ${entry.id}`);
      assert.equal(parameters.questionNumber, original.index, `Wrong TRI number ${entry.id}`);
      assert.equal(parameters.officialAnswer, original.correctAlternative, `Wrong TRI answer ${entry.id}`);
      assert.ok(Math.abs(parameters.difficultyScore - (500 + 100 * parameters.b)) < 0.000001, `Wrong TRI scale ${entry.id}`);
      assert.ok(parameters.sourceUrl?.startsWith("https://download.inep.gov.br/") && parameters.matchMethod, `Missing official TRI provenance ${entry.id}`);
    }
    questions.push({ ...normalized, ...entry, areaId, subjectId: course.id, subjectTitle: course.title, moduleTitle: module.title, tri: parameters || null, triUnavailable: parameters ? null : tri.unavailable?.[entry.id] || null });
  }
  for (const module of modules) assert.ok(course.questions.some((q) => q.moduleId === module.id), `Empty unit ${module.id}`);
  const { questions: entries, ...info } = course;
  courses.push({ ...info, areaId, areaTitle: area.title, modules, questionIds: entries.map((q) => q.id), total: entries.length });
}
const natureQuestions = questions.filter((q) => q.areaId === "ciencias-natureza");
const natureModules = nature.modules.map((m, index) => {
  validateIntro(m);
  assert.ok(natureQuestions.filter((q) => q.competency === m.competency).length >= 5, `Nature competency ${m.competency} needs at least 5 reviewed questions`);
  return { ...m, color: colors[index % colors.length], reference: matrix.areas["ciencias-natureza"].competencies.find((c) => c.number === m.competency) };
});
courses.push({ ...nature, areaId: "ciencias-natureza", areaTitle: matrix.areas["ciencias-natureza"].title, modules: natureModules,
  questionIds: natureQuestions.map((q) => q.id), total: natureQuestions.length });

// Keep published lesson boundaries, including partial lessons and the Natureza union.
for (const course of courses) {
  course.lessonLayout = {};
  for (const module of course.modules) {
    const ids = course.questionIds.filter(id => {
      const q = questions.find(q => q.id === id);
      return course.id === "ciencias-natureza" ? q.competency === module.competency : q.moduleId === module.id;
    });
    const previous = savedLayout[course.id]?.[module.id] || [];
    assert.ok(previous.flat().every(id => ids.includes(id)), `Published lesson lost a question: ${module.id}`);
    const assigned = new Set(previous.flat());
    const extra = ids.filter(id => !assigned.has(id));
    course.lessonLayout[module.id] = [...previous, ...Array.from({ length: Math.ceil(extra.length / 5) }, (_, i) => extra.slice(i * 5, i * 5 + 5))];
    assert.equal(new Set(course.lessonLayout[module.id].flat()).size, ids.length, `Duplicated lesson item ${module.id}`);
  }
}
await writeFile(path.join(root, "data/courses/lesson-layout.json"), JSON.stringify(Object.fromEntries(courses.map(c => [c.id, c.lessonLayout])), null, 2) + "\n");

const assetPaths = new Set(questions.flatMap((q) => JSON.stringify(q).match(/\/assets\/questions\/\d+\/\d+\/[^\s"\\)]+\.(?:png|jpg|jpeg|webp|gif)/gi) || []));
for (const asset of assetPaths) {
  const [, year, index, file] = asset.match(/^\/assets\/questions\/(\d+)\/(\d+)\/(.+)$/);
  const source = path.join(root, "data/enem-source/public", year, "questions", index, file);
  await access(source);
  const destination = path.join(root, "dist", asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}
const payload = {
  schemaVersion: 2, source: snapshot.source, sourceRepository: snapshot.sourceRepository,
  rawTotal: snapshot.total, years: snapshot.years, generatedAt: new Date().toISOString(),
  total: questions.length, matrix,
  tri: { coverage: tri.coverage || {}, matched: questions.filter(q => q.tri).length, scale: tri.scale || null,
    sourceIndexUrl: tri.sourceIndexUrl || null, years: (tri.years || []).map(({ year, sourceUrl, matched, unavailable }) => ({ year, sourceUrl, matched, unavailable })) },
  method: "Seleção editorial de questões íntegras com resoluções próprias. A associação a competência e habilidade é editorial; os enunciados de referência são do INEP.",
  courses, questions,
};
await mkdir(path.join(root, "dist/data"), { recursive: true });
await writeFile(path.join(root, "dist/data/courses.json"), JSON.stringify(payload) + "\n");
await cp(path.join(root, "data/reference/enem-matriz-de-referencia.pdf"), path.join(root, "dist/data/enem-matriz-de-referencia.pdf"));
console.log(JSON.stringify({ total: questions.length, assets: assetPaths.size, courses: courses.map((c) => ({ id: c.id, units: c.modules.length, questions: c.total })) }, null, 2));
