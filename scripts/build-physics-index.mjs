#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const classified = snapshot.questions
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

const payload = {
  source: snapshot.source,
  generatedAt: new Date().toISOString(),
  method: "Índice heurístico auditável por termos de Física; preserve o snapshot integral para reclassificação.",
  total: classified.length,
  modules,
  questions: classified,
};

await rm(targetAssets, { recursive: true, force: true });
for (const question of classified) {
  const from = path.join(sourceAssets, String(question.year), "questions", String(question.index));
  const to = path.join(targetAssets, String(question.year), String(question.index));
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name === "details.json") continue;
    await cp(path.join(from, entry.name), path.join(to, entry.name));
  }
}

await writeFile(targetPath, `${JSON.stringify(payload)}\n`);
process.stdout.write(`Índice de Física: ${classified.length} questões.\n`);

