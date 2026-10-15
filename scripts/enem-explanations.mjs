import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

export const explanationProgressPath = "data/enem/explanation-progress.json";
export const sourceQuestionId = q => `${q.year}-${q.index}${q.language ? `-${q.language}` : ""}`;
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export const sourceDigest = (ids, source) => sha256(JSON.stringify(ids.map(id => {
  const question = source.find(q => sourceQuestionId(q) === id);
  if (!question) throw new Error(`Unknown source question: ${id}`);
  return question;
})));
const text = value => typeof value === "string" && value.trim().length > 0;

export function validateExplanation(id, explanation, question) {
  if (!question || !question.imported) throw new Error(`Explanation must refer to an available imported question: ${id}`);
  if (explanation?.correctAlternative !== question.correctAlternative) throw new Error(`Explanation answer differs from the source: ${id}`);
  if (!text(explanation.concept) || !text(explanation.takeaway)
    || !Array.isArray(explanation.steps) || explanation.steps.length < 3 || !explanation.steps.every(text)) throw new Error(`Incomplete explanation: ${id}`);
  if (new Set(explanation.steps.map(s => s.trim())).size !== explanation.steps.length) throw new Error(`Repeated explanation steps: ${id}`);
  return { concept: explanation.concept, steps: [...explanation.steps], takeaway: explanation.takeaway };
}

/** Only explicitly reviewed batches are incorporated; draft files are never auto-published. */
export async function applyExplanationBatches({ root, questions, sourceQuestions }) {
  let progress;
  try { progress = JSON.parse(await readFile(path.join(root, explanationProgressPath), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return; throw error; }
  if (progress.schemaVersion !== 1 || !Array.isArray(progress.batches)) throw new Error("Invalid explanation progress manifest");
  if (progress.batches.filter(b => b.status !== "published").length > 1) throw new Error("Publish the previous explanation batch before enabling another");
  const available = new Map(questions.map(q => [q.id, q]));
  const seen = new Set();
  const batchIds = new Set();
  const updates = [];
  for (const batch of progress.batches) {
    if (!/^[a-z0-9-]+$/.test(batch.id) || batchIds.has(batch.id)) throw new Error("Invalid or duplicate explanation batch id");
    batchIds.add(batch.id);
    if (!["prepared", "published"].includes(batch.status) || !text(batch.reviewNote) || !Number.isFinite(Date.parse(batch.reviewedAt))) throw new Error(`Unreviewed explanation batch: ${batch.id}`);
    if (batch.file !== `data/enem/explanations/${batch.id}.json`) throw new Error(`Invalid explanation path: ${batch.id}`);
    const content = await readFile(path.join(root, batch.file), "utf8");
    if (sha256(content) !== batch.contentSha256) throw new Error(`Reviewed explanation content changed: ${batch.id}`);
    const explanations = JSON.parse(content);
    if (!batch.questionIds?.length || JSON.stringify(Object.keys(explanations).sort()) !== JSON.stringify([...batch.questionIds].sort())) throw new Error(`Explanation question list changed: ${batch.id}`);
    if (sourceDigest(batch.questionIds, sourceQuestions) !== batch.sourceSha256) throw new Error(`Question source changed since explanation review: ${batch.id}`);
    for (const id of batch.questionIds) {
      if (seen.has(id)) throw new Error(`Duplicate explanation: ${id}`);
      seen.add(id);
      const question = available.get(id);
      const explanation = validateExplanation(id, explanations[id], question);
      updates.push({ question, explanation, explanationReview: { batch: batch.id, kind: "editorial", reviewedAt: batch.reviewedAt } });
    }
  }
  // Fail atomically: a later invalid batch cannot leave a partially updated bank.
  for (const { question, ...update } of updates) Object.assign(question, update);
}

export function explanationCoverage(questions) {
  const explained = questions.filter(q => q.explanation?.concept && q.explanation?.steps?.length > 0).length;
  const years = [...new Set(questions.map(q => q.year))].sort((a, b) => b - a);
  return { total: questions.length, explained, pending: questions.length - explained,
    years: years.map(year => {
      const items = questions.filter(q => q.year === year);
      const count = items.filter(q => q.explanation?.concept && q.explanation?.steps?.length > 0).length;
      return { year, total: items.length, explained: count, pending: items.length - count };
    }) };
}
