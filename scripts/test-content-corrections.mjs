import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { correctedSnapshot } from "./enem-content-corrections.mjs";
import { sha256 } from "./enem-explanations.mjs";
import { buildYearBank } from "./enem-year-bank.mjs";
import { isOfficialBookletURL } from "./enem-official-sources.mjs";

test("official booklet sources accept historical INEP paths and reject mismatches or other hosts", () => {
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/enem/provas_e_gabaritos/2021_PV_impresso_D1_CD1.pdf"), true);
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2019/2019_PV_impresso_D1_CD1.pdf"), true);
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2016/CAD_ENEM_2016_DIA_2_07_AZUL.pdf"), true);
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2016/CAD_ENEM_2015_DIA_2_07_AZUL.pdf"), false);
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2017/cad_1_prova_azul_5112017.pdf"), true);
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2016/cad_1_prova_azul_5112017.pdf"), false);
  for (const year of [2009, 2010, 2011, 2012, 2013]) {
    for (const booklet of ["dia1_caderno1", "dia2_caderno7"]) assert.equal(isOfficialBookletURL(`https://download.inep.gov.br/educacao_basica/enem/provas/${year}/${booklet}_azul.pdf`), true);
  }
  assert.equal(isOfficialBookletURL("https://download.inep.gov.br/educacao_basica/enem/provas/2014/dia2_caderno7_azul.pdf"), false);
  for (const value of [undefined, "https://example.com/enem/provas_e_gabaritos/exam.pdf", "https://download.inep.gov.br.example.com/enem/provas_e_gabaritos/exam.pdf", "https://download.inep.gov.br/educacao_basica/enem/provas/2019/2018_PV_impresso_D1_CD1.pdf", "https://download.inep.gov.br/enem/provas_e_gabaritos/../exam.pdf"]) {
    assert.equal(isOfficialBookletURL(value), false);
  }
});

test("a restored official figure is validated, copied into the app and rejects altered bytes", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "enem-restored-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "data/enem/restored-assets/2021/90");
  await mkdir(folder, { recursive: true });
  const bytes = Buffer.from("official-figure-test-fixture");
  await writeFile(path.join(folder, "official.jpg"), bytes);
  const original = { year: 2021, index: 90, discipline: "ciencias-humanas", context: "Incomplete", alternativesIntroduction: "Which choice?", files: [], correctAlternative: "A",
    alternatives: ["A", "B", "C", "D", "E"].map(letter => ({ letter, text: `Choice ${letter}`, file: null, isCorrect: letter === "A" })) };
  const correction = { originalSha256: sha256(JSON.stringify(original)), fields: { context: "![Official figure](/assets/questions/2021/90/official.jpg)" },
    assets: { "official.jpg": sha256(bytes) }, sourceUrl: "https://download.inep.gov.br/enem/provas_e_gabaritos/2021_PV_impresso_D1_CD1.pdf", sourcePage: 31, reviewedAt: "2026-10-15", reason: "Missing figure restored from official booklet" };
  const save = () => writeFile(path.join(root, "data/enem/content-corrections.json"), JSON.stringify({ "2021-90": correction }));
  await save();
  const snapshot = await correctedSnapshot(root, { questions: [original] });
  const bank = await buildYearBank({ root, snapshot, curatedQuestions: [], courses: [], years: [2021] });
  assert.equal(bank.practiceQuestions.length, 1);
  assert.equal(original.context, "Incomplete");
  assert.equal(sha256(await readFile(path.join(root, "dist/assets/questions/2021/90/official.jpg"))), sha256(bytes));
  await writeFile(path.join(folder, "official.jpg"), "changed");
  await assert.rejects(() => correctedSnapshot(root, { questions: [original] }), /Restored asset changed/);
  correction.assets = { "../../elsewhere.jpg": sha256(bytes) };
  await save();
  await assert.rejects(() => correctedSnapshot(root, { questions: [original] }), /Invalid restored asset/);
});

test("official text corrections preserve raw data and answers; changed sources and unreviewed fields fail closed", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "enem-corrections-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "data/enem"), { recursive: true });
  const original = { year: 2023, index: 99, context: null, alternativesIntroduction: "Incomplete", correctAlternative: "D", alternatives: [{ letter: "C", text: "12", isCorrect: false }, { letter: "D", text: "Correct", isCorrect: true }] };
  const snapshot = { questions: [original] };
  const correction = { originalSha256: sha256(JSON.stringify(original)), fields: { context: "Restored context", alternativesIntroduction: "Restored prompt" }, sourceUrl: "https://download.inep.gov.br/enem/provas_e_gabaritos/2023_PV_impresso_D2_CD7.pdf", sourcePage: 3, reviewedAt: "2026-10-15", reason: "Missing prompt restored from official booklet" };
  const save = () => writeFile(path.join(root, "data/enem/content-corrections.json"), JSON.stringify({ "2023-99": correction }));
  await save();
  const updated = await correctedSnapshot(root, snapshot);
  assert.equal(updated.questions[0].context, "Restored context");
  assert.equal(updated.questions[0].correctAlternative, "D");
  assert.equal(updated.questions[0].sourceCorrection.sourcePage, 3);
  assert.equal(original.context, null);
  correction.fields.alternativeTexts = { C: "13" };
  await save();
  const repaired = await correctedSnapshot(root, snapshot);
  assert.deepEqual(repaired.questions[0].alternatives, [{ letter: "C", text: "13", isCorrect: false }, { letter: "D", text: "Correct", isCorrect: true }]);
  assert.equal(original.alternatives[0].text, "12");
  correction.fields.alternativeTexts = { Z: "unlisted" };
  await save();
  await assert.rejects(() => correctedSnapshot(root, snapshot), /Invalid alternative text/);
  delete correction.fields.alternativeTexts;
  correction.fields.correctAlternative = "A";
  await save();
  await assert.rejects(() => correctedSnapshot(root, snapshot), /Invalid text correction/);
  delete correction.fields.correctAlternative;
  correction.originalSha256 = "changed";
  await save();
  await assert.rejects(() => correctedSnapshot(root, snapshot), /Correction source changed/);
});

test("incorrect alternative images can be replaced only by verified assets for that question", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "enem-alternative-images-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, "data/enem/restored-assets/2014/65");
  await mkdir(folder, { recursive: true });
  const bytes = Buffer.from("official-alternative-fixture");
  await writeFile(path.join(folder, "alternative-a.png"), bytes);
  const original = { year: 2014, index: 65, discipline: "ciencias-natureza", context: "Choose the group", alternativesIntroduction: "Which group?", files: [], correctAlternative: "A",
    alternatives: ["A", "B", "C", "D", "E"].map(letter => ({ letter, text: `Group ${letter}`, file: letter === "A" ? "https://enem.dev/2014/questions/65/wrong.png" : null, isCorrect: letter === "A" })) };
  const imagePath = "/assets/questions/2014/65/alternative-a.png";
  const correction = { originalSha256: sha256(JSON.stringify(original)), fields: { alternativeFiles: { A: imagePath } },
    assets: { "alternative-a.png": sha256(bytes) }, sourceUrl: "https://download.inep.gov.br/educacao_basica/enem/provas/2014/2014_PV_impresso_D1_CD1.pdf", sourcePage: 23, reviewedAt: "2026-10-21", reason: "API contains an unrelated image" };
  const save = () => writeFile(path.join(root, "data/enem/content-corrections.json"), JSON.stringify({ "2014-65": correction }));
  await save();
  const snapshot = await correctedSnapshot(root, { questions: [original] });
  const bank = await buildYearBank({ root, snapshot, curatedQuestions: [], courses: [], years: [2014] });
  assert.equal(bank.practiceQuestions.length, 1);
  assert.equal(bank.practiceQuestions[0].alternatives[0].file, imagePath);
  assert.equal(bank.practiceQuestions[0].correctAlternative, "A");
  assert.equal(original.alternatives[0].file, "https://enem.dev/2014/questions/65/wrong.png");
  assert.deepEqual(snapshot.questions[0].alternatives[1], original.alternatives[1]);
  assert.equal(sha256(await readFile(path.join(root, "dist", imagePath))), sha256(bytes));
  for (const value of ["https://example.com/alternative-a.png", "/assets/questions/2014/66/alternative-a.png", "/assets/questions/2014/65/../alternative-a.png", "/assets/questions/2014/65/unverified.png", null]) {
    correction.fields.alternativeFiles = { A: value };
    await save();
    await assert.rejects(() => correctedSnapshot(root, { questions: [original] }), /Invalid alternative image correction/);
  }
  correction.fields.alternativeFiles = { Z: imagePath };
  await save();
  await assert.rejects(() => correctedSnapshot(root, { questions: [original] }), /Invalid alternative image correction/);
  correction.fields.alternativeFiles = { A: imagePath };
  await writeFile(path.join(folder, "alternative-a.png"), "changed");
  await save();
  await assert.rejects(() => correctedSnapshot(root, { questions: [original] }), /Restored asset changed/);
});
