#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourcePath = path.join(root, "data", "enem", "all-questions.json");
const targetPath = path.join(root, "dist", "data", "physics-questions.json");
const sourceAssets = path.join(root, "data", "enem-source", "public");
const targetAssets = path.join(root, "dist", "assets", "questions");

const modules = [
  {
    id: "mecanica",
    title: "Mecânica",
    emoji: "⚙️",
    keywords: [
      "velocidade", "aceleração", "movimento", "deslocamento", "trajetória",
      "força", "atrito", "newton", "cinética", "potencial", "trabalho",
      "potência", "torque", "equilíbrio", "massa", "queda livre", "gravidade",
    ],
  },
  {
    id: "eletricidade",
    title: "Eletricidade",
    emoji: "⚡",
    keywords: [
      "corrente elétrica", "tensão elétrica", "resistência elétrica", "circuito",
      "resistor", "condutor", "ampère", "volt", "potência elétrica", "consumo de energia",
      "carga elétrica", "choque elétrico", "associação de resistores", "curto-circuito",
    ],
  },
  {
    id: "ondas-optica",
    title: "Ondas e óptica",
    emoji: "🌊",
    keywords: [
      "onda", "frequência", "comprimento de onda", "som", "acústica", "decibel",
      "luz", "óptica", "espelho", "lente", "refração", "reflexão", "laser",
      "ultrassom", "radiação eletromagnética",
    ],
  },
  {
    id: "termologia",
    title: "Termologia",
    emoji: "🌡️",
    keywords: [
      "temperatura", "calor", "térmic", "termômetro", "dilatação", "calorímetro",
      "mudança de estado", "capacidade térmica", "calor específico", "condução",
      "convecção", "irradiação", "máquina térmica", "gás ideal",
    ],
  },
  {
    id: "eletromagnetismo",
    title: "Eletromagnetismo",
    emoji: "🧲",
    keywords: [
      "campo magnético", "imã", "ímã", "indução", "eletromagn", "transformador",
      "fluxo magnético", "força magnética", "solenoide", "faraday", "lentz",
    ],
  },
];

const strongNegative = [
  "dna", "rna", "célula", "enzima", "proteína", "gene", "ecossistema", "espécie",
  "bactéria", "vírus", "fotossíntese", "molécula orgânica", "reação química",
  "ligação química", "ph ", "ácido", "base química", "estequiometria", "mol de",
];

function plainText(question) {
  return [
    question.context,
    question.alternativesIntroduction,
    ...question.alternatives.map((alternative) => alternative.text),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("pt-BR");
}

function classify(question) {
  if (question.discipline !== "ciencias-natureza") return null;
  const text = plainText(question);
  const negativeScore = strongNegative.reduce(
    (score, keyword) => score + (text.includes(keyword) ? 1 : 0),
    0,
  );

  const ranked = modules
    .map((module) => ({
      module,
      hits: module.keywords.filter((keyword) => text.includes(keyword)),
    }))
    .sort((a, b) => b.hits.length - a.hits.length);

  const best = ranked[0];
  if (!best || best.hits.length === 0) return null;
  if (negativeScore >= 2 && best.hits.length < 3) return null;

  return { module: best.module, score: best.hits.length, evidence: best.hits };
}

const snapshot = JSON.parse(await readFile(sourcePath, "utf8"));
const learningDir = path.join(root, "data", "learning");
const introductions = JSON.parse(await readFile(path.join(learningDir, "introductions.json"), "utf8"));
const explanations = {};
for (const file of (await readdir(learningDir)).filter((name) => /^explanations-.*\.json$/.test(name)).sort()) {
  const entries = JSON.parse(await readFile(path.join(learningDir, file), "utf8"));
  for (const [id, entry] of Object.entries(entries)) {
    if (explanations[id]) throw new Error(`Explicação duplicada: ${id}`);
    explanations[id] = entry;
  }
}
const candidates = snapshot.questions
  .map((question) => ({ question, classification: classify(question) }))
  .filter((entry) => entry.classification?.score >= 2)
  .map(({ question, classification }) => ({
    id: `${question.year}-${question.index}`,
    year: question.year,
    index: question.index,
    moduleId: classification.module.id,
    moduleTitle: classification.module.title,
    moduleEmoji: classification.module.emoji,
    confidence: classification.score,
    evidence: classification.evidence,
    title: question.title,
    context: question.context?.replaceAll(
      `https://enem.dev/${question.year}/questions/${question.index}/`,
      `/assets/questions/${question.year}/${question.index}/`,
    ),
    files: question.files.map((file) =>
      file.replace(
        `https://enem.dev/${question.year}/questions/${question.index}/`,
        `/assets/questions/${question.year}/${question.index}/`,
      ),
    ),
    alternativesIntroduction: question.alternativesIntroduction,
    correctAlternative: question.correctAlternative,
    alternatives: question.alternatives.map((alternative) => ({
      ...alternative,
      file: alternative.file?.replace(
        `https://enem.dev/${question.year}/questions/${question.index}/`,
        `/assets/questions/${question.year}/${question.index}/`,
      ) || null,
    })),
  }))
  .sort((a, b) => b.confidence - a.confidence || b.year - a.year);

const excluded = [];
const classified = [];
for (const question of candidates) {
  const explanation = explanations[question.id];
  if (!explanation || explanation.excludeReason) {
    excluded.push({ id: question.id, reason: explanation?.excludeReason || "Aguardando resolução comentada e revisão editorial." });
    continue;
  }
  if (!explanation.concept || explanation.steps?.length < 2 || !explanation.takeaway) {
    throw new Error(`Resolução incompleta: ${question.id}`);
  }
  const module = modules.find((item) => item.id === (explanation.moduleId || question.moduleId));
  if (!module) throw new Error(`Unidade inválida: ${question.id}`);
  classified.push({ ...question, moduleId: module.id, moduleTitle: module.title, moduleEmoji: module.emoji,
    explanation: { concept: explanation.concept, steps: explanation.steps, takeaway: explanation.takeaway } });
}
for (const module of modules) {
  if (!introductions[module.id]) throw new Error(`Introdução ausente: ${module.id}`);
  module.introduction = introductions[module.id];
  if (!classified.some((question) => question.moduleId === module.id)) throw new Error(`Unidade sem questões revisadas: ${module.id}`);
}

const payload = {
  source: snapshot.source,
  generatedAt: new Date().toISOString(),
  method: "Seleção por termos de Física com revisão editorial e resoluções próprias; o acervo bruto permanece integral.",
  explanationSource: "Resoluções didáticas elaboradas para o Enem; não são comentários oficiais do INEP nem da API enem.dev.",
  total: classified.length,
  modules,
  questions: classified,
};

for (const question of classified) {
  const from = path.join(sourceAssets, String(question.year), "questions", String(question.index));
  const to = path.join(targetAssets, String(question.year), String(question.index));
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "details.json") continue;
    if (!JSON.stringify(question).includes(`/assets/questions/${question.year}/${question.index}/${entry.name}`)) continue;
    await cp(path.join(from, entry.name), path.join(to, entry.name));
  }
}

await writeFile(targetPath, `${JSON.stringify(payload)}\n`);
await writeFile(path.join(learningDir, "review-report.json"), `${JSON.stringify({ candidates: candidates.length, published: classified.length, excluded }, null, 2)}\n`);
process.stdout.write(`Índice de Física: ${classified.length} questões.\n`);

