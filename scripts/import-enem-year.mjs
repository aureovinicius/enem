#!/usr/bin/env node
// Enable exactly one annual batch; the next batch requires a confirmed Pages deployment.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const progressPath = "data/enem/import-progress.json";
const read = async path => JSON.parse(await readFile(path, "utf8"));
const save = value => writeFile(progressPath, JSON.stringify(value, null, 2) + "\n");
const progress = await read(progressPath);
const arg = process.argv[2];
if (arg === "--status") {
  console.log(JSON.stringify(progress, null, 2));
} else if (arg === "--confirm") {
  const year = Number(process.argv[3]);
  const runId = process.argv[4];
  if (!Number.isInteger(year) || !/^\d+$/.test(runId || "")) throw new Error("Usage: --confirm YEAR ACTIONS_RUN_ID");
  const batch = progress.batches.find(b => b.year === year);
  if (!batch) throw new Error("Year not prepared.");
  const run = JSON.parse(execFileSync("gh", ["run", "view", runId, "--repo", "aureovinicius/enem", "--json", "headSha,status,conclusion,url,jobs,headBranch"], { encoding: "utf8" }));
  if (run.headBranch !== "main" || run.status !== "completed" || run.conclusion !== "success" || !run.jobs.some(job => job.name === "Publicar no GitHub Pages" && job.conclusion === "success")) throw new Error("This run did not successfully deploy main to Pages.");
  const deployedManifest = JSON.parse(execFileSync("gh", ["api", `repos/aureovinicius/enem/contents/${progressPath}?ref=${run.headSha}`, "-H", "Accept: application/vnd.github.raw+json"], { encoding: "utf8" }));
  const deployedBatch = deployedManifest.batches.find(b => b.year === year);
  if (!deployedBatch || deployedBatch.sourceSha256 !== batch.sourceSha256) throw new Error("The deployment does not contain this annual batch.");
  batch.status = "published";
  batch.deployment = { commit: run.headSha, runId, url: run.url, confirmedAt: new Date().toISOString() };
  await save(progress);
  console.log(`ENEM ${year}: implantação confirmada. ${run.url}`);
} else {
  const pending = progress.batches.find(b => b.status !== "published");
  const next = progress.availableYears.find(year => !progress.batches.some(b => b.year === year));
  const year = arg === "--next" ? (pending?.year || next) : Number(arg);
  if (!year) throw new Error("All available years are already imported and published.");
  if (!progress.availableYears.includes(year)) throw new Error("Year unavailable in the verified API source.");
  if (pending && pending.year !== year) throw new Error(`Confirm publication of ${pending.year} before importing another year.`);
  if (progress.batches.some(b => b.year === year && b.status === "published")) throw new Error(`Year ${year} already published.`);
  const sourceCommit = execFileSync("git", ["-C", "data/enem-source", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (sourceCommit !== progress.sourceCommit) throw new Error("Source revision changed. Review it before continuing this import.");
  const annual = await read(`data/enem/${year}.json`);
  const questions = annual.questions;
  const snapshot = await read("data/enem/all-questions.json");
  if (snapshot.sourceCommit !== sourceCommit || annual.year !== year || annual.total !== questions.length
    || JSON.stringify(questions) !== JSON.stringify(snapshot.questions.filter(q => q.year === year))) throw new Error("Annual snapshot differs from verified source; review before enabling it.");
  console.log(`Preparando ENEM ${year}: ${questions.length} registros do snapshot local verificado.`);
  const before = structuredClone(progress);
  const batch = { year, status: "prepared", preparedAt: new Date().toISOString(), sourceSha256: createHash("sha256").update(JSON.stringify(questions)).digest("hex"), rawTotal: questions.length };
  progress.batches = [...progress.batches.filter(b => b.year !== year), batch].sort((a, b) => b.year - a.year);
  await save(progress);
  try {
    const materialized = path.resolve(`.preview/enem-source-materialized/enem-api-${sourceCommit}/public`);
    const sourcePublic = process.env.ENEM_SOURCE_PUBLIC || (existsSync(materialized) ? materialized : path.resolve("data/enem-source/public"));
    execFileSync(process.execPath, ["scripts/build-courses.mjs"], { stdio: "inherit", env: { ...process.env, ENEM_SOURCE_PUBLIC: sourcePublic } });
    const catalog = await read("dist/data/courses.json");
    batch.result = catalog.imports.batches.find(b => b.year === year);
    await save(progress);
    console.log(JSON.stringify({ year, ...batch.result, nextStep: "Run tests, publish this batch, then --confirm YEAR ACTIONS_RUN_ID" }, null, 2));
  } catch (error) {
    await save(before);
    throw error;
  }
}
