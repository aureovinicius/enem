import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { sha256, sourceQuestionId } from "./enem-explanations.mjs";

/** Preserve the API snapshot and restore only text verified in the official booklet. */
export async function correctedSnapshot(root, snapshot) {
  root = await realpath(root);
  let corrections;
  try { corrections = JSON.parse(await readFile(path.join(root, "data/enem/content-corrections.json"), "utf8")); }
  catch (error) { if (error.code === "ENOENT") return snapshot; throw error; }
  const available = new Map(snapshot.questions.map(q => [sourceQuestionId(q), q]));
  for (const [id, correction] of Object.entries(corrections)) {
    const question = available.get(id);
    if (!question || sha256(JSON.stringify(question)) !== correction.originalSha256) throw new Error(`Correction source changed: ${id}`);
    if (!/^https:\/\/download\.inep\.gov\.br\/enem\/provas_e_gabaritos\/[^/]+\.pdf$/.test(correction.sourceUrl)
      || !Number.isInteger(correction.sourcePage) || correction.sourcePage < 1
      || !correction.reason?.trim() || !Number.isFinite(Date.parse(correction.reviewedAt))) throw new Error(`Unverified correction: ${id}`);
    const fields = correction.fields;
    if (!fields || !Object.keys(fields).length || Object.keys(fields).some(key => !["context", "alternativesIntroduction", "alternativeTexts"].includes(key))
      || Object.entries(fields).some(([key, value]) => key !== "alternativeTexts" && (typeof value !== "string" || !value.trim()))) throw new Error(`Invalid text correction: ${id}`);
    if ("alternativeTexts" in fields && (!fields.alternativeTexts || typeof fields.alternativeTexts !== "object" || Array.isArray(fields.alternativeTexts)
      || !Object.keys(fields.alternativeTexts).length || Object.entries(fields.alternativeTexts).some(([letter, value]) =>
        !question.alternatives?.some(a => a.letter === letter) || typeof value !== "string" || !value.trim()))) throw new Error(`Invalid alternative text correction: ${id}`);
    if (correction.assets !== undefined) {
      if (!correction.assets || typeof correction.assets !== "object" || Array.isArray(correction.assets)
        || !Object.keys(correction.assets).length) throw new Error(`Invalid restored assets: ${id}`);
      const assetRoot = path.resolve(root, "data/enem/restored-assets");
      const folder = `${question.index}${question.language ? `-${question.language}` : ""}`;
      for (const [filename, digest] of Object.entries(correction.assets)) {
        if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(png|jpe?g|webp|gif|svg|avif)$/i.test(filename)
          || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`Invalid restored asset: ${id}`);
        const file = await realpath(path.join(assetRoot, String(question.year), folder, filename));
        if (!file.startsWith(`${assetRoot}${path.sep}`) || sha256(await readFile(file)) !== digest) throw new Error(`Restored asset changed: ${id}/${filename}`);
      }
    }
  }
  return { ...snapshot, questions: snapshot.questions.map(question => {
    const correction = corrections[sourceQuestionId(question)];
    if (!correction) return question;
    const { fields, ...sourceCorrection } = correction;
    const { alternativeTexts, ...textFields } = fields;
    return { ...question, ...textFields,
      ...(alternativeTexts ? { alternatives: question.alternatives.map(a => ({ ...a, text: alternativeTexts[a.letter] ?? a.text })) } : {}), sourceCorrection };
  }) };
}
