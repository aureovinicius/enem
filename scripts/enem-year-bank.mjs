import { cp, mkdir, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./enem-explanations.mjs";

const AREAS = {
  "ciencias-natureza": { code: "CN", title: "Ciências da Natureza" },
  "ciencias-humanas": { code: "CH", title: "Ciências Humanas" },
  linguagens: { code: "LC", title: "Linguagens" },
  matematica: { code: "MT", title: "Matemática" },
};
const AREA_BY_CODE = Object.fromEntries(Object.entries(AREAS).map(([id, area]) => [area.code, id]));
const LANGUAGES = { ingles: "Inglês", espanhol: "Espanhol" };
const LETTERS = ["A", "B", "C", "D", "E"];
const KNOWN_CONTENT_EXCLUSIONS = new Set(["2019-121", "2023-114", "2016-84", "2021-107", "2009-27", "2021-105", "2016-47", "2011-46", "2018-108", "2015-53", "2011-73"]);
const normalizedText = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const hasText = value => typeof value === "string" && value.trim().length > 0;
const questionId = question => `${question.year}-${question.index}${question.language ? `-${question.language}` : ""}`;

async function optionalJSON(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function contentExclusion(id, reason) {
  if (!hasText(reason)) return false;
  if (KNOWN_CONTENT_EXCLUSIONS.has(id)) return true;
  const text = normalizedText(reason);
  if (/aguardando|pendente.*revisao|revisao.*pendente|sem resolucao comentada/.test(text)) return false;
  // Exclusion from the former Physics selection does not imply an invalid item.
  return /(?:enunciado|contexto|texto|dado|imagem|figura|equacao|alternativa|gabarito|conteudo).*(?:omit|falta|ausen|inconsisten|identic|incomplet|invalid|corrompid)|(?:falta|ausen|omit).*(?:enunciado|contexto|texto|dado|imagem|figura|equacao|alternativa)|nao contem o contexto|apenas quatro alternativas/.test(text);
}

async function editorialExclusions(root, snapshot) {
  const exclusions = new Map();
  const add = (id, reason) => {
    if (contentExclusion(id, reason)) exclusions.set(id, [...new Set([...(exclusions.get(id) || []), reason])]);
  };
  const report = await optionalJSON(path.join(root, "data/learning/review-report.json"));
  for (const item of report?.excluded || []) add(item.id, item.reason);
  let files = [];
  try { files = await readdir(path.join(root, "data/learning")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const file of files.filter(name => /^explanations-.*\.json$/.test(name))) {
    const explanations = await optionalJSON(path.join(root, "data/learning", file));
    for (const [id, explanation] of Object.entries(explanations || {})) add(id, explanation?.excludeReason || explanation?.exclReason);
  }
  const issues = await optionalJSON(path.join(root, "data/enem/content-issues.json"));
  for (const [id, issue] of Object.entries(issues || {})) {
    const original = snapshot.questions.find(q => questionId(q) === id);
    if (!original || issue.originalSha256 !== sha256(JSON.stringify(original))) throw new Error(`Reviewed content issue source changed: ${id}`);
    if (!hasText(issue.reason) || !Number.isFinite(Date.parse(issue.reviewedAt)) || !Number.isInteger(issue.sourcePage) || issue.sourcePage < 1
      || !/^https:\/\/download\.inep\.gov\.br\/enem\/provas_e_gabaritos\/[^/]+\.pdf$/.test(issue.sourceUrl || "")) throw new Error(`Unverified content issue: ${id}`);
    exclusions.set(id, [...(exclusions.get(id) || []), issue.reason]);
  }
  return exclusions;
}

function validateContent(question) {
  const reasons = [];
  if (!Number.isInteger(question.index) || question.index <= 0) reasons.push("Número de questão inválido na fonte.");
  if (!AREAS[question.discipline]) reasons.push("Área de conhecimento não reconhecida na fonte.");
  if (question.language != null && !LANGUAGES[question.language]) reasons.push("Idioma não reconhecido na fonte.");
  if (question.language && question.discipline !== "linguagens") reasons.push("Idioma associado a uma área incompatível na fonte.");
  if (!hasText(question.alternativesIntroduction)) reasons.push("Pergunta ausente ou vazia na fonte.");
  if (question.context != null && typeof question.context !== "string") reasons.push("Enunciado em formato inválido na fonte.");
  if (!Array.isArray(question.alternatives) || question.alternatives.length !== 5) {
    reasons.push("A fonte não contém as cinco alternativas de A a E.");
    return reasons;
  }
  const alternatives = question.alternatives;
  if (alternatives.some(item => !item || !LETTERS.includes(item.letter)) || new Set(alternatives.map(item => item?.letter)).size !== 5) reasons.push("As letras das alternativas devem ser únicas, de A a E.");
  if (!LETTERS.includes(question.correctAlternative)) reasons.push("Gabarito ausente ou fora das alternativas de A a E.");
  const correct = alternatives.filter(item => item?.isCorrect === true);
  if (alternatives.some(item => typeof item?.isCorrect !== "boolean") || correct.length !== 1 || correct[0]?.letter !== question.correctAlternative) reasons.push("Os marcadores de resposta correta divergem do gabarito da fonte.");
  if (alternatives.some(item => !hasText(item?.text) && !hasText(item?.file))) reasons.push("Há alternativa sem texto nem imagem.");
  const content = alternatives.map(item => JSON.stringify([normalizedText(item?.text), item?.file || ""]));
  if (new Set(content).size !== content.length) reasons.push("A fonte contém alternativas com conteúdo idêntico.");
  return reasons;
}

function officialMetadata(question, tri) {
  const id = questionId(question);
  const parameters = tri?.questions?.[id];
  const unavailable = tri?.unavailable?.[id];
  const identityMatches = record => record && record.year === question.year
    && record.questionNumber === question.index && record.officialAnswer === question.correctAlternative
    && (record.language || null) === (question.language || null) && AREA_BY_CODE[record.area]
    && (!question.language || record.area === "LC");
  const unavailableMatches = unavailable && unavailable.year === question.year && AREA_BY_CODE[unavailable.area]
    && Number.isInteger(unavailable.examCode) && Number.isInteger(unavailable.itemCode)
    && unavailable.officialAnswer === question.correctAlternative
    && (unavailable.questionNumber == null || unavailable.questionNumber === question.index)
    && (unavailable.language == null || unavailable.language === question.language)
    && (!question.language || unavailable.area === "LC");
  const officialParameterSource = /^https:\/\/download\.inep\.gov\.br\//.test(parameters?.sourceUrl || "") && hasText(parameters?.matchMethod);
  const matched = identityMatches(parameters) && officialParameterSource ? parameters : unavailableMatches ? unavailable : null;
  const yearReport = (tri?.years || []).find(item => item.year === question.year);
  // An ambiguous foreign-language variant prevents a TRI join, but its area can
  // still be established from the verified booklet's printed number convention.
  const areaOrder = question.year === 2009 ? ["CN", "CH", "LC", "MT"]
    : question.year <= 2016 ? ["CH", "CN", "LC", "MT"] : ["LC", "CH", "CN", "MT"];
  const numberedArea = Number.isInteger(question.index) && question.index >= 1 && question.index <= 180
    ? areaOrder[Math.floor((question.index - 1) / 45)] : null;
  const booklet = yearReport?.areas?.[numberedArea];
  const verifiedNumberedArea = unavailable?.year === question.year && unavailable.reason === "ambiguous_or_missing_official_item"
    && unavailable.area === numberedArea && booklet?.sequenceValidated === true
    && booklet.color === "AZUL" && booklet.application === "regular" && booklet.comparableAnswers >= 30
    && /^https:\/\/download\.inep\.gov\.br\//.test(yearReport.sourceUrl || "");
  const officialArea = matched ? AREA_BY_CODE[matched.area] : verifiedNumberedArea ? AREA_BY_CODE[numberedArea] : null;
  const areaId = officialArea || question.discipline;
  const sourceUrl = matched?.sourceUrl || yearReport?.sourceUrl || tri?.sourceIndexUrl || null;
  const validParameters = identityMatches(parameters)
    && [parameters.a, parameters.b, parameters.c, parameters.difficultyScore].every(Number.isFinite)
    && Math.abs(parameters.difficultyScore - (500 + 100 * parameters.b)) < 0.000001
    && officialParameterSource;
  const reasons = [];
  if (unavailable?.year === question.year) {
    if (unavailable.officialAnswer === "X") reasons.push("Questão anulada ou excluída pedagogicamente no gabarito oficial (X).");
    else if (unavailable.reason === "api_official_answer_mismatch" || (LETTERS.includes(unavailable.officialAnswer) && unavailable.officialAnswer !== question.correctAlternative)) reasons.push(`Gabarito da API (${question.correctAlternative}) divergente do oficial (${unavailable.officialAnswer || "não identificado"}).`);
  }
  if (parameters?.year === question.year && parameters.questionNumber === question.index && (parameters.language || null) === (question.language || null)) {
    if (parameters.officialAnswer === "X") reasons.push("Questão anulada ou excluída pedagogicamente no gabarito oficial (X).");
    else if (LETTERS.includes(parameters.officialAnswer) && parameters.officialAnswer !== question.correctAlternative) reasons.push(`Gabarito da API (${question.correctAlternative}) divergente do oficial (${parameters.officialAnswer}).`);
  }
  return {
    reasons, areaId,
    areaClassificationSource: officialArea ? "INEP" : "API enem.dev",
    areaClassificationSourceUrl: officialArea ? sourceUrl : null,
    tri: validParameters ? structuredClone(parameters) : null,
    triUnavailable: validParameters ? null : unavailable?.year === question.year ? structuredClone(unavailable) : parameters ? { year: question.year, reason: "unverified_tri_link" } : null,
  };
}

function imageReferences(question) {
  const references = new Set();
  const reasons = [];
  if (question.files != null && !Array.isArray(question.files)) reasons.push("Lista de imagens em formato inválido na fonte.");
  for (const reference of [...(Array.isArray(question.files) ? question.files : []), ...(question.alternatives || []).map(item => item?.file).filter(value => value != null)]) {
    if (hasText(reference)) references.add(reference);
    else reasons.push("Referência de imagem vazia ou inválida na fonte.");
  }
  for (const text of [question.context, question.alternativesIntroduction, ...(question.alternatives || []).map(item => item?.text)]) {
    if (typeof text !== "string") continue;
    for (const match of text.matchAll(/!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g)) references.add(match[1]);
    for (const match of text.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)) references.add(match[1]);
    // Plain URLs in bibliographic citations are text, not required image assets.
  }
  return { references, reasons };
}

function assetLocation(reference, root, sourcePublic) {
  let pathname;
  try {
    const decoded = decodeURIComponent(reference);
    if (decoded.includes("\\") || decoded.split(/[/?#]/).some(part => part === ".." || part === ".")) return null;
    if (reference.startsWith("/assets/questions/")) pathname = new URL(reference, "https://enem.dev").pathname;
    else {
      const url = new URL(reference);
      if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "enem.dev") return null;
      pathname = decodeURIComponent(url.pathname).replace(/^\/(\d{4})\/questions\//, "/assets/questions/$1/");
    }
  } catch { return null; }
  const match = pathname.match(/^\/assets\/questions\/(\d{4})\/(\d+(?:-(?:ingles|espanhol))?)\/([^/]+\.(?:png|jpe?g|webp|gif|svg|avif))$/i);
  if (!match) return null;
  const [, year, index, file] = match;
  return { publicPath: `/assets/questions/${year}/${index}/${file}`, source: path.join(sourcePublic, year, "questions", index, file), destination: path.join(root, "dist/assets/questions", year, index, file) };
}

async function normalizeImages(question, root, sourcePublic) {
  const { references, reasons } = imageReferences(question);
  const replacements = new Map();
  const assets = [];
  const sourceRoot = path.resolve(sourcePublic);
  for (const reference of references) {
    const asset = assetLocation(reference, root, sourcePublic);
    if (!asset) { reasons.push(`Imagem sem arquivo local verificável: ${reference}`); continue; }
    try {
      const resolved = await realpath(asset.source);
      const info = await stat(resolved);
      if (!resolved.startsWith(`${sourceRoot}${path.sep}`) || !info.isFile() || info.size === 0) throw Object.assign(new Error("Invalid asset"), { code: "INVALID_ASSET" });
      assets.push(asset);
      replacements.set(reference, asset.publicPath);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "INVALID_ASSET"].includes(error.code)) throw error;
      reasons.push(`Arquivo de imagem ausente ou vazio: ${asset.publicPath}`);
    }
  }
  const normalized = JSON.parse(JSON.stringify(question, (_key, value) => {
    if (typeof value !== "string") return value;
    for (const [reference, replacement] of replacements) value = value.replaceAll(reference, replacement);
    return value;
  }));
  return { normalized, reasons, assets };
}

/** Adds enabled years to practice without changing the curated learning catalog. */
export async function buildYearBank({ root, snapshot, curatedQuestions, courses, tri = {}, years = [], sourcePublic }) {
  if (!root || !Array.isArray(snapshot?.questions) || !Array.isArray(curatedQuestions) || !Array.isArray(courses)) throw new TypeError("root, snapshot.questions, curatedQuestions and courses are required");
  if (!Array.isArray(years) || years.some(year => !Number.isInteger(year))) throw new TypeError("years must contain integer years");
  root = await realpath(path.resolve(root));
  sourcePublic = path.resolve(sourcePublic || path.join(root, "data/enem-source/public"));
  const enabledYears = [...new Set(years)].sort((a, b) => a - b);
  const enabled = new Set(enabledYears);
  const existingIds = new Set(curatedQuestions.map(question => question.id));
  const editorial = await editorialExclusions(root, snapshot);
  const grouped = new Map();
  for (const question of snapshot.questions) {
    if (!question || !enabled.has(question.year)) continue;
    const id = questionId(question);
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(question);
  }
  const imports = {
    years: enabledYears, rawTotal: grouped.size, availableTotal: 0, addedTotal: 0, excluded: [],
    batches: enabledYears.map(year => ({ year, total: 0, existing: 0, added: 0, excluded: 0 })),
  };
  const batches = new Map(imports.batches.map(batch => [batch.year, batch]));
  const practiceQuestions = [];
  const copyAssets = new Map();
  const rows = [...grouped.entries()].sort(([, a], [, b]) => a[0].year - b[0].year || a[0].index - b[0].index || String(a[0].language).localeCompare(String(b[0].language)));
  for (const [id, originals] of rows) {
    const original = originals[0];
    const batch = batches.get(original.year);
    batch.total += 1;
    if (existingIds.has(id)) { batch.existing += 1; continue; }
    const reasons = validateContent(original);
    if (new Set(originals.map(item => JSON.stringify(item))).size > 1) reasons.push("Há registros conflitantes com o mesmo ano, número e idioma na fonte.");
    for (const reason of editorial.get(id) || []) reasons.push(`Revisão editorial: ${reason}`);
    for (const reason of [original.excludeReason, original.exclReason]) if (contentExclusion(id, reason)) reasons.push(`Revisão editorial: ${reason}`);
    const official = officialMetadata(original, tri);
    reasons.push(...official.reasons);
    // Do not try to interpret an invalid alternatives collection as image data.
    const images = Array.isArray(original.alternatives) ? await normalizeImages(original, root, sourcePublic) : { normalized: structuredClone(original), reasons: [], assets: [] };
    reasons.push(...images.reasons);
    if (reasons.length) {
      imports.excluded.push({ id, year: original.year, reasons: [...new Set(reasons)] });
      batch.excluded += 1;
      continue;
    }
    const areaId = official.areaId;
    const subjectId = original.language || (areaId === "matematica" ? "matematica" : `${areaId}-sem-classificacao`);
    const subjectTitle = LANGUAGES[original.language] || (areaId === "matematica" ? "Matemática" : `${AREAS[areaId].title} · disciplina não classificada`);
    const sourceUrl = `${String(snapshot.source || "https://api.enem.dev/v1").replace(/\/$/, "")}/exams/${original.year}/questions/${original.index}${original.language ? `?language=${encodeURIComponent(original.language)}` : ""}`;
    practiceQuestions.push({
      ...images.normalized, id, imported: true, sourceUrl, sourceAreaId: original.discipline,
      areaId, subjectId, subjectTitle, moduleId: "acervo-api", moduleTitle: "Assunto não classificado",
      competency: null, skill: null, explanation: null,
      areaClassificationSource: official.areaClassificationSource,
      areaClassificationSourceUrl: official.areaClassificationSourceUrl || sourceUrl,
      tri: official.tri, triUnavailable: official.triUnavailable,
    });
    batch.added += 1;
    for (const asset of images.assets) copyAssets.set(asset.destination, asset);
  }
  for (const course of courses) {
    const added = practiceQuestions.filter(question => course.id === question.areaId || (LANGUAGES[course.id] && course.id === question.language)).map(question => question.id);
    course.practiceQuestionIds = [...new Set([...(course.questionIds || []), ...added])];
  }
  for (const asset of copyAssets.values()) {
    await mkdir(path.dirname(asset.destination), { recursive: true });
    await cp(asset.source, asset.destination);
  }
  imports.addedTotal = practiceQuestions.length;
  imports.availableTotal = imports.batches.reduce((sum, batch) => sum + batch.existing + batch.added, 0);
  return { practiceQuestions, imports };
}
