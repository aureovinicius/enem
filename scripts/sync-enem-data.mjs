#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceDir = path.join(root, "data", "enem-source");
const publicDir = path.join(sourceDir, "public");
const outputDir = path.join(root, "data", "enem");
const publicDataDir = path.join(root, "dist", "data");
const sourceRepository = "https://github.com/yunger7/enem-api.git";

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function syncRepository() {
  if (await exists(path.join(sourceDir, ".git"))) {
    process.stdout.write("Atualizando a fonte bruta da enem.dev…\n");
    execFileSync("git", ["-C", sourceDir, "pull", "--ff-only"], { stdio: "inherit" });
    return;
  }

  await rm(sourceDir, { recursive: true, force: true });
  await mkdir(path.dirname(sourceDir), { recursive: true });
  process.stdout.write("Baixando a base bruta completa da enem.dev…\n");
  execFileSync("git", ["clone", "--depth", "1", sourceRepository, sourceDir], {
    stdio: "inherit",
  });
}

async function loadExam(year) {
  const questionsDir = path.join(publicDir, String(year), "questions");
  const entries = await readdir(questionsDir, { withFileTypes: true });
  const questions = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const detailsPath = path.join(questionsDir, entry.name, "details.json");
    if (!(await exists(detailsPath))) continue;
    questions.push(JSON.parse(await readFile(detailsPath, "utf8")));
  }

  questions.sort((a, b) => a.index - b.index || String(a.language).localeCompare(String(b.language)));
  return { year, total: questions.length, questions };
}

await syncRepository();
await mkdir(outputDir, { recursive: true });
await mkdir(publicDataDir, { recursive: true });

const exams = JSON.parse(await readFile(path.join(publicDir, "exams.json"), "utf8"));
const years = exams.map((exam) => exam.year).sort((a, b) => a - b);
const allQuestions = [];

for (const year of years) {
  const exam = await loadExam(year);
  allQuestions.push(...exam.questions);
  await writeFile(
    path.join(outputDir, `${year}.json`),
    `${JSON.stringify(exam, null, 2)}\n`,
  );
  process.stdout.write(`ENEM ${year}: ${exam.total} questões\n`);
}

const snapshot = {
  source: "https://api.enem.dev/v1",
  sourceRepository: "https://github.com/yunger7/enem-api",
  sourceCommit: execFileSync("git", ["-C", sourceDir, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  license: "Dados públicos do ENEM; código da API sob GPL-2.0",
  downloadedAt: new Date().toISOString(),
  years,
  total: allQuestions.length,
  questions: allQuestions,
};

const serialized = `${JSON.stringify(snapshot)}\n`;
await writeFile(path.join(outputDir, "all-questions.json"), serialized);
await writeFile(path.join(publicDataDir, "all-questions.json"), serialized);
await cp(path.join(sourceDir, "LICENSE"), path.join(outputDir, "SOURCE-LICENSE-GPL-2.0.txt"));
process.stdout.write(`Snapshot concluído: ${snapshot.total} questões.\n`);

