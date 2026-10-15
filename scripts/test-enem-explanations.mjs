import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { applyExplanationBatches, explanationProgressPath, sha256, sourceDigest, explanationCoverage } from "./enem-explanations.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "enem-comments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data/enem/explanations"), { recursive: true });
  const source = [{ year: 2023, index: 1, correctAlternative: "A", context: "Question source" }];
  const questions = [{ ...source[0], id: "2023-1", imported: true, explanation: null }];
  const content = { "2023-1": { correctAlternative: "A", concept: "Concept", steps: ["First step", "Second step", "Conclusion"], takeaway: "Remember" } };
  const serialized = JSON.stringify(content);
  const batch = { id: "test", file: "data/enem/explanations/test.json", status: "prepared", reviewedAt: "2026-10-15", reviewNote: "Question and answer checked", questionIds: ["2023-1"], contentSha256: sha256(serialized), sourceSha256: sourceDigest(["2023-1"], source) };
  const manifest = { schemaVersion: 1, batches: [batch] };
  const write = async () => {
    await writeFile(path.join(root, batch.file), JSON.stringify(content));
    await writeFile(path.join(root, explanationProgressPath), JSON.stringify(manifest));
  };
  const run = () => applyExplanationBatches({ root, questions, sourceQuestions: source });
  await write();
  return { root, source, questions, content, batch, manifest, write, run };
}

test("only reviewed manifests enable comments; unlisted drafts remain inactive", async t => {
  const f = await fixture(t);
  f.manifest.batches = [];
  await f.write();
  await f.run();
  assert.equal(f.questions[0].explanation, null);
  f.manifest.batches = [f.batch];
  await f.write();
  await f.run();
  assert.deepEqual(f.questions[0].explanation.steps, f.content["2023-1"].steps);
  assert.equal(f.questions[0].explanationReview.kind, "editorial");
  assert.equal(f.questions[0].correctAlternative, "A");
  assert.deepEqual(explanationCoverage(f.questions), { total: 1, explained: 1, pending: 0, years: [{ year: 2023, total: 1, explained: 1, pending: 0 }] });
  assert.equal(explanationCoverage([{ year: 2023, explanation: { concept: "Existing lesson", steps: ["First", "Second"] } }]).explained, 1, "Existing two-step curated comments also count");
});

test("edited content, changed source and incorrect answers require a fresh review", async t => {
  const f = await fixture(t);
  f.content["2023-1"].steps[0] = "Changed after review";
  await f.write();
  await assert.rejects(f.run, /content changed/);
  f.batch.contentSha256 = sha256(JSON.stringify(f.content));
  f.source[0].context = "Changed source";
  await f.write();
  await assert.rejects(f.run, /source changed/);
  f.batch.sourceSha256 = sourceDigest(f.batch.questionIds, f.source);
  f.content["2023-1"].correctAlternative = "B";
  f.batch.contentSha256 = sha256(JSON.stringify(f.content));
  await f.write();
  await assert.rejects(f.run, /answer differs/);
  assert.equal(f.questions[0].explanation, null);
});

test("duplicate batches, invalid paths and missing reviews are rejected", async t => {
  const f = await fixture(t);
  f.batch.reviewNote = "";
  await f.write();
  await assert.rejects(f.run, /Unreviewed/);
  f.batch.reviewNote = "Checked";
  f.manifest.batches.push({ ...f.batch, status: "published" });
  await f.write();
  await assert.rejects(f.run, /duplicate/);
  f.manifest.batches.pop();
  f.batch.file = "../outside.json";
  await writeFile(path.join(f.root, explanationProgressPath), JSON.stringify(f.manifest));
  await assert.rejects(f.run, /Invalid explanation path/);
});
