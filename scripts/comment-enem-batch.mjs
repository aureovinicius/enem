#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { explanationProgressPath, sha256, sourceDigest, validateExplanation, explanationCoverage } from "./enem-explanations.mjs";
import { correctedSnapshot } from "./enem-content-corrections.mjs";

const read = async file => JSON.parse(await readFile(file, "utf8"));
const save = progress => writeFile(explanationProgressPath, JSON.stringify(progress, null, 2) + "\n");
const progress = await read(explanationProgressPath);
const [action, batchId, argument] = process.argv.slice(2);
if (action === "--status") {
  const catalog = await read("dist/data/courses.json");
  console.log(JSON.stringify({ ...explanationCoverage([...catalog.questions, ...catalog.practiceQuestions]), batches: progress.batches }, null, 2));
} else if (action === "--prepare") {
  if (!/^[a-z0-9-]+$/.test(batchId || "") || !argument?.trim()) throw new Error('Usage: --prepare BATCH_ID "Review evidence and conclusions"');
  if (progress.batches.some(b => b.status !== "published")) throw new Error("Confirm the pending batch deployment before preparing the next batch");
  if (progress.batches.some(b => b.id === batchId)) throw new Error("Batch already exists");
  const file = `data/enem/explanations/${batchId}.json`;
  const content = await readFile(file, "utf8");
  const explanations = JSON.parse(content);
  const catalog = await read("dist/data/courses.json");
  const questions = new Map(catalog.practiceQuestions.map(q => [q.id, q]));
  const ids = Object.keys(explanations);
  if (!ids.length) throw new Error("Empty batch");
  for (const id of ids) {
    if (questions.get(id)?.explanation) throw new Error(`Already explained: ${id}`);
    validateExplanation(id, explanations[id], questions.get(id));
  }
  const snapshot = await read("data/enem/all-questions.json");
  const practiceSnapshot = await correctedSnapshot(process.cwd(), snapshot);
  const batch = { id: batchId, file, status: "prepared", reviewedAt: new Date().toISOString(), reviewNote: argument,
    questionIds: ids, contentSha256: sha256(content), sourceSha256: sourceDigest(ids, practiceSnapshot.questions) };
  const before = structuredClone(progress);
  progress.batches.push(batch);
  await save(progress);
  try {
    const materialized = path.resolve(`.preview/enem-source-materialized/enem-api-${snapshot.sourceCommit}/public`);
    const sourcePublic = process.env.ENEM_SOURCE_PUBLIC || (existsSync(materialized) ? materialized : path.resolve("data/enem-source/public"));
    execFileSync(process.execPath, ["scripts/build-courses.mjs"], { stdio: "inherit", env: { ...process.env, ENEM_SOURCE_PUBLIC: sourcePublic } });
    console.log(`${batchId}: ${ids.length} comentários preparados. Execute testes e publique antes de --confirm.`);
  } catch (error) { await save(before); throw error; }
} else if (action === "--confirm") {
  if (!/^\d+$/.test(argument || "")) throw new Error("Usage: --confirm BATCH_ID ACTIONS_RUN_ID");
  const batch = progress.batches.find(b => b.id === batchId);
  if (!batch) throw new Error("Batch not prepared");
  const run = JSON.parse(execFileSync("gh", ["run", "view", argument, "--repo", "aureovinicius/enem", "--json", "headSha,status,conclusion,url,jobs,headBranch"], { encoding: "utf8" }));
  if (run.headBranch !== "main" || run.status !== "completed" || run.conclusion !== "success" || !run.jobs.some(job => job.name === "Publicar no GitHub Pages" && job.conclusion === "success")) throw new Error("This workflow did not deploy main successfully");
  const deployed = JSON.parse(execFileSync("gh", ["api", `repos/aureovinicius/enem/contents/${explanationProgressPath}?ref=${run.headSha}`, "-H", "Accept: application/vnd.github.raw+json"], { encoding: "utf8" }));
  const found = deployed.batches.find(b => b.id === batchId);
  if (found?.contentSha256 !== batch.contentSha256 || found?.sourceSha256 !== batch.sourceSha256 || JSON.stringify(found?.questionIds) !== JSON.stringify(batch.questionIds)) throw new Error("The deployment does not contain this reviewed batch");
  batch.status = "published";
  batch.deployment = { commit: run.headSha, runId: argument, url: run.url, confirmedAt: new Date().toISOString() };
  await save(progress);
  console.log(`${batchId}: publicação confirmada. ${run.url}`);
} else throw new Error("Use --status, --prepare BATCH_ID REVIEW_NOTE, or --confirm BATCH_ID RUN_ID");
