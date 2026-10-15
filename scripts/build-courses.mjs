#!/usr/bin/env node
import { readFile, writeFile, mkdir, cp, access } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { buildYearBank } from "./enem-year-bank.mjs";
import { applyExplanationBatches, explanationCoverage } from "./enem-explanations.mjs";
import { correctedSnapshot } from "./enem-content-corrections.mjs";

const root = process.cwd();
const sourcePublic = process.env.ENEM_SOURCE_PUBLIC || path.join(root, "data/enem-source/public");
const read = async (file) => JSON.parse(await readFile(path.join(root, file), "utf8"));
const [snapshot, physics, matrix, mapping, nature, humanities] = await Promise.all([
  read("data/enem/all-questions.json"), read("dist/data/physics-questions.json"),
  read("data/reference/matrix.json"), read("data/courses/physics-mapping.json"), read("data/courses/natureza.json"),
  read("data/courses/humanas.json"),
]);
const subjectCourses = await Promise.all(["quimica", "biologia", "matematica", "geografia", "historia", "portugues", "literatura", "ingles", "espanhol"].map((id) => read(`data/courses/${id}.json`)));
const languages = await read("data/courses/linguagens.json");
const languageExtras = { ...languages, ...await read("data/courses/linguagens-complementares.json") };
const questionId = (q) => `${q.year}-${q.index}${q.language ? `-${q.language}` : ""}`;
const savedLayout = await read("data/courses/lesson-layout.json");
let tri = { questions: {}, coverage: [] };
try { tri = await read("data/reference/tri-parameters.json"); } catch (error) { if (error.code !== "ENOENT") throw error; }
const officialArea = (courseId) => courseId === "matematica" ? "matematica"
  : ["portugues", "literatura", "ingles", "espanhol", "linguagens"].includes(courseId) ? "linguagens"
  : ["geografia", "historia", "ciencias-humanas"].includes(courseId) ? "ciencias-humanas" : "ciencias-natureza";
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
for (const course of [physicsCourse, ...subjectCourses, humanities, languageExtras]) {
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
    const original = snapshot.questions.find((q) => questionId(q) === entry.id && q.discipline === areaId);
    assert.ok(original, `Missing question or wrong area: ${entry.id}`);
    const module = modules.find((m) => m.id === entry.moduleId);
    assert.ok(module, `Invalid unit ${entry.id}`);
    if (course.studyGuide) {
      assert.ok(module.skills?.includes(entry.skill), `Wrong topic skill ${entry.id}`);
      assert.ok(course.legacyQuestionCredits?.[entry.id], `Missing previous completion reference ${entry.id}`);
    }
    const competence = area.competencies.find((c) => c.number === entry.competency);
    assert.ok(competence?.skills.some((s) => s.number === entry.skill), `Skill does not match competence: ${entry.id}`);
    if (module.competency) assert.equal(entry.competency, module.competency, `Wrong unit: ${entry.id}`);
    assert.ok(entry.explanation?.concept && entry.explanation.steps?.length >= 2 && entry.explanation.takeaway, `No explanation: ${entry.id}`);
    assert.ok(original.alternatives.some((a) => a.letter === original.correctAlternative), `Invalid answer ${entry.id}`);
    const sourceIndex = `${original.index}${original.language ? `-${original.language}` : ""}`;
    const prefix = `https://enem.dev/${original.year}/questions/${sourceIndex}/`;
    const normalized = JSON.parse(JSON.stringify(original).replaceAll(prefix, `/assets/questions/${original.year}/${sourceIndex}/`));
    const { promptStart, ...curated } = entry;
    // Some source records place the entire reading passage in the prompt field.
    if (promptStart) {
      assert.ok(!original.context, `Unexpected context split ${entry.id}`);
      const split = normalized.alternativesIntroduction.lastIndexOf(promptStart);
      assert.ok(split > 0, `Missing prompt boundary ${entry.id}`);
      normalized.context = normalized.alternativesIntroduction.slice(0, split).trim();
      normalized.alternativesIntroduction = normalized.alternativesIntroduction.slice(split).trim();
    }
    const parameters = tri.questions[entry.id];
    if (parameters) {
      assert.ok(Number.isFinite(parameters.b) && Number.isFinite(parameters.difficultyScore), `Invalid TRI ${entry.id}`);
      assert.equal(parameters.year, original.year, `Wrong TRI year ${entry.id}`);
      // Existing subject selections can cross exam areas (e.g. a gravity item in MT).
      if (areaId === "ciencias-humanas") assert.equal(parameters.area, "CH", `Wrong TRI area ${entry.id}`);
      if (areaId === "linguagens") {
        assert.equal(parameters.area, "LC", `Wrong TRI area ${entry.id}`);
        assert.equal(parameters.language || null, original.language || null, `Wrong TRI language ${entry.id}`);
      }
      assert.equal(parameters.questionNumber, original.index, `Wrong TRI number ${entry.id}`);
      assert.equal(parameters.officialAnswer, original.correctAlternative, `Wrong TRI answer ${entry.id}`);
      assert.ok(Math.abs(parameters.difficultyScore - (500 + 100 * parameters.b)) < 0.000001, `Wrong TRI scale ${entry.id}`);
      assert.ok(parameters.sourceUrl?.startsWith("https://download.inep.gov.br/") && parameters.matchMethod, `Missing official TRI provenance ${entry.id}`);
    }
    const subjectId = ["ciencias-humanas", "linguagens"].includes(course.id) ? entry.subjectId : course.id;
    const subjectTitle = ["ciencias-humanas", "linguagens"].includes(course.id) ? entry.subjectTitle : course.title;
    if (["ciencias-humanas", "linguagens"].includes(course.id)) {
      const complementarySubjects = course.id === "linguagens"
        ? { arte: "Arte", "educacao-fisica": "Educação Física", "tecnologia-informacao": "Tecnologias da Informação" }
        : { filosofia: "Filosofia", sociologia: "Sociologia" };
      assert.equal(subjectTitle, complementarySubjects[subjectId], `Invalid humanities subject ${entry.id}`);
      assert.ok(subjectTitle, `Missing humanities subject ${entry.id}`);
    }
    questions.push({ ...normalized, ...curated, areaId, subjectId, subjectTitle, moduleTitle: module.title, tri: parameters || null, triUnavailable: parameters ? null : tri.unavailable?.[entry.id] || null });
  }
  if (["ciencias-humanas", "linguagens"].includes(course.id)) continue;
  for (const module of modules) assert.ok(course.questions.some((q) => q.moduleId === module.id), `Empty unit ${module.id}`);
  const { questions: entries, ...info } = course;
  courses.push({ ...info, areaId, areaTitle: area.title, modules, questionIds: entries.map((q) => q.id), total: entries.length });
}
for (const integrated of [nature, humanities, languages]) {
  const areaId = officialArea(integrated.id);
  const areaQuestions = questions.filter((q) => q.areaId === areaId);
  const modules = integrated.modules.map((m, index) => {
    validateIntro(m);
    if (integrated.integratedBy === "subject") {
      assert.ok(areaQuestions.filter(q => q.subjectId === m.subjectId).length >= 5, `Empty integrated subject ${m.id}`);
      return { ...m, color: colors[index % colors.length] };
    }
    const reference = matrix.areas[areaId].competencies.find((c) => c.number === m.competency);
    assert.ok(reference, `Invalid integrated competency ${m.id}`);
    assert.ok(areaQuestions.filter((q) => q.competency === m.competency).length >= 5, `${integrated.title} C${m.competency} needs at least 5 reviewed questions`);
    return { ...m, color: colors[index % colors.length], reference };
  });
  const { questions: entries, ...info } = integrated;
  const integrationNote = integrated.integrationNote || (areaId === "ciencias-humanas"
    ? "Esta trilha reúne Geografia, História, Filosofia e Sociologia, sem repetir questões. A revisão de erros é compartilhada com as trilhas de Geografia e História."
    : "Esta trilha reúne todas as questões de Física, Química e Biologia, sem repetição. A revisão de erros é compartilhada entre as trilhas.");
  courses.push({ ...info, integrated: true, integrationNote, areaId, areaTitle: matrix.areas[areaId].title, modules,
    questionIds: areaQuestions.map((q) => q.id), total: areaQuestions.length });
}

// Keep published lesson boundaries, including partial lessons and the Natureza union.
for (const course of courses) {
  course.lessonLayout = {};
  course.legacyLessonCredits = {};
  for (const module of course.modules) {
    const ids = course.questionIds.filter(id => {
      const q = questions.find(q => q.id === id);
      return course.integratedBy === "subject" ? q.subjectId === module.subjectId
        : course.integrated ? q.competency === module.competency : q.moduleId === module.id;
    });
    // Repartition previously published Linguagens lessons by competence. Each
    // resulting group keeps its original completion credit without awarding XP.
    const legacyGroups = Object.entries(course.legacyLessonLayout || {}).flatMap(([oldModule, groups]) =>
      groups.map((group, index) => ({ oldId: `${oldModule}-${index + 1}`, ids: group.filter(id => ids.includes(id)) }))
    ).filter(group => group.ids.length);
    const previous = savedLayout[course.id]?.[module.id] || legacyGroups.map(group => group.ids);
    legacyGroups.forEach((group, index) => {
      assert.deepEqual(previous[index], group.ids, `Changed migrated lesson ${module.id}`);
      course.legacyLessonCredits[`${module.id}-${index + 1}`] = group.oldId;
    });
    assert.ok(previous.flat().every(id => ids.includes(id)), `Published lesson lost a question: ${module.id}`);
    const assigned = new Set(previous.flat());
    const extra = ids.filter(id => !assigned.has(id));
    const added = Array.from({ length: Math.ceil(extra.length / 5) }, (_, i) => extra.slice(i * 5, i * 5 + 5));
    if (course.studyGuide && added.length >= 2 && added.at(-1).length < 3) {
      const tail = added.splice(-2).flat();
      const split = Math.ceil(tail.length / 2);
      added.push(tail.slice(0, split), tail.slice(split));
    }
    course.lessonLayout[module.id] = [...previous, ...added];
    assert.equal(new Set(course.lessonLayout[module.id].flat()).size, ids.length, `Duplicated lesson item ${module.id}`);
  }
}
await writeFile(path.join(root, "data/courses/lesson-layout.json"), JSON.stringify(Object.fromEntries(courses.map(c => [c.id, c.lessonLayout])), null, 2) + "\n");

const assetPaths = new Set(questions.flatMap((q) => JSON.stringify(q).match(/\/assets\/questions\/\d+\/\d+(?:-(?:ingles|espanhol))?\/[^\s"\\)]+\.(?:png|jpg|jpeg|webp|gif)/gi) || []));
for (const asset of assetPaths) {
  const [, year, index, file] = asset.match(/^\/assets\/questions\/(\d+)\/(\d+(?:-(?:ingles|espanhol))?)\/(.+)$/);
  const source = path.join(sourcePublic, year, "questions", index, file);
  await access(source);
  const destination = path.join(root, "dist", asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination);
}
const importProgress = await read("data/enem/import-progress.json");
const practiceSnapshot = await correctedSnapshot(root, snapshot);
const bank = await buildYearBank({ root, sourcePublic, snapshot: practiceSnapshot, curatedQuestions: questions, courses, tri,
  years: importProgress.batches.map(batch => batch.year) });
await applyExplanationBatches({ root, questions: bank.practiceQuestions, sourceQuestions: practiceSnapshot.questions });
const payload = {
  schemaVersion: 2, source: snapshot.source, sourceRepository: snapshot.sourceRepository,
  rawTotal: snapshot.total, years: snapshot.years, generatedAt: new Date().toISOString(),
  total: questions.length, matrix,
  tri: { coverage: tri.coverage || {}, matched: questions.filter(q => q.tri).length, scale: tri.scale || null,
    sourceIndexUrl: tri.sourceIndexUrl || null, years: (tri.years || []).map(({ year, sourceUrl, matched, unavailable }) => ({ year, sourceUrl, matched, unavailable })) },
  method: "Seleção editorial de questões íntegras com resoluções próprias. A associação a competência e habilidade é editorial; os enunciados de referência são do INEP.",
  courses, questions, practiceQuestions: bank.practiceQuestions, imports: bank.imports,
  explanationCoverage: explanationCoverage([...questions, ...bank.practiceQuestions]),
};
await mkdir(path.join(root, "dist/data"), { recursive: true });
await writeFile(path.join(root, "dist/data/courses.json"), JSON.stringify(payload) + "\n");
await cp(path.join(root, "data/reference/enem-matriz-de-referencia.pdf"), path.join(root, "dist/data/enem-matriz-de-referencia.pdf"));
console.log(JSON.stringify({ total: questions.length, assets: assetPaths.size, courses: courses.map((c) => ({ id: c.id, units: c.modules.length, questions: c.total })) }, null, 2));
