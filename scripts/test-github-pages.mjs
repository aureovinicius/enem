import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildGitHubPages, normalizeBasePath } from "./build-github-pages.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "fisio-pages-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = {
    "index.html": '<link rel="icon" href="/favicon.svg"><link href="/styles.css?v=2"><script src="/app.js?v=2"></script><a href="#praticar">Praticar</a>',
    "app.js": 'const DATA_URL = "/data/courses.json?v=2"; const allowed = url => url.startsWith("/assets/questions/"); const download = `<a href="/data/matrix.pdf">Download</a>`;',
    "styles.css": "body { color: #123; }",
    "favicon.svg": "<svg></svg>",
    "data/matrix.pdf": "pdf fixture",
    "data/courses.json": JSON.stringify({ context: "![Gráfico](/assets/questions/2023/1/chart.png)", alternatives: [{ file: "/assets/questions/2023/1/chart.png" }], source: "https://example.org/data/official.json", sourceImage: "https://enem.dev/2023/questions/1/chart.png" }),
    "assets/questions/2023/1/chart.png": "image fixture",
  };
  for (const [relative, value] of Object.entries(source)) {
    await mkdir(path.dirname(path.join(root, "dist", relative)), { recursive: true });
    await writeFile(path.join(root, "dist", relative), value);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "--", "dist"], { cwd: root });
  await writeFile(path.join(root, "dist/assets/questions/2023/1/chart 2.png"), "untracked duplicate");
  return { root, source };
}

for (const basePath of ["/", "/enem", "/nested/enem/"]) {
  test(`packages all local resources for ${basePath}, preserving external URLs and source files`, async t => {
    const { root, source } = await fixture(t);
    const built = await buildGitHubPages({ root, basePath });
    const base = normalizeBasePath(basePath);
    const html = await readFile(path.join(built.output, "index.html"), "utf8");
    assert.ok(html.includes(`src="${base}/app.js?v=2"`));
    assert.ok(html.includes('href="#praticar"'));
    const js = await readFile(path.join(built.output, "app.js"), "utf8");
    assert.ok(js.includes(`"${base}/data/courses.json?v=2"`));
    assert.ok(js.includes(`startsWith("${base}/assets/questions/")`));
    assert.ok(js.includes(`href="${base}/data/matrix.pdf"`));
    const catalog = JSON.parse(await readFile(path.join(built.output, "data/courses.json"), "utf8"));
    assert.equal(catalog.context, `![Gráfico](${base}/assets/questions/2023/1/chart.png)`);
    assert.equal(catalog.alternatives[0].file, `${base}/assets/questions/2023/1/chart.png`);
    assert.equal(catalog.source, "https://example.org/data/official.json");
    assert.equal(catalog.sourceImage, "https://enem.dev/2023/questions/1/chart.png");
    assert.deepEqual(await readdir(path.join(built.output, "assets/questions/2023/1")), ["chart.png"]);
    assert.equal(built.files, Object.keys(source).length + 1);
    for (const [relative, contents] of Object.entries(source)) assert.equal(await readFile(path.join(root, "dist", relative), "utf8"), contents);
    await buildGitHubPages({ root, basePath, output: "_site_again" });
    for (const relative of Object.keys(source)) assert.deepEqual(await readFile(path.join(root, "_site", relative)), await readFile(path.join(root, "_site_again", relative)));
  });
}

test("rejects malformed base paths before producing output", async t => {
  const { root } = await fixture(t);
  for (const basePath of ["enem", "//evil.com", "/../enem", "/enem/..", "/enem?x", "/enem#x", "/enem%2fother", "/enem/<script>", "/a//b", "https://example.org", "/x\ny"]) {
    await assert.rejects(buildGitHubPages({ root, basePath }), /Base path/);
  }
  assert.ok(!(await readdir(root)).includes("_site"));
});

test("requires tracked referenced resources and prevents partial output", async t => {
  const { root } = await fixture(t);
  await writeFile(path.join(root, "dist/data/courses.json"), JSON.stringify({ context: "![Missing](/assets/questions/2023/1/chart%202.png)" }));
  await assert.rejects(buildGitHubPages({ root, basePath: "/enem" }), /Missing or unsafe local resource/);
  assert.ok(!(await readdir(root)).includes("_site"));
});

test("refuses unsafe output directories, existing files, and tracked symlinks", async t => {
  const { root } = await fixture(t);
  for (const output of [".", "dist", "dist/subdirectory", "../external"]) await assert.rejects(buildGitHubPages({ root, output }), /Output/);
  const external = await mkdtemp(path.join(tmpdir(), "fisio-pages-external-"));
  t.after(() => rm(external, { recursive: true, force: true }));
  await symlink(external, path.join(root, "linked-parent"));
  await assert.rejects(buildGitHubPages({ root, output: "linked-parent/output" }), /Output parent resolves outside/);
  assert.deepEqual(await readdir(external), []);
  await mkdir(path.join(root, "_site"));
  await writeFile(path.join(root, "_site/keep.txt"), "keep");
  await assert.rejects(buildGitHubPages({ root }), /existing files are never removed/);
  assert.equal(await readFile(path.join(root, "_site/keep.txt"), "utf8"), "keep");
  await symlink("../index.html", path.join(root, "dist/data/linked.html"));
  execFileSync("git", ["add", "--", "dist/data/linked.html"], { cwd: root });
  await assert.rejects(buildGitHubPages({ root, output: "safe" }), /Only regular files/);
});

test("requires a tracked entry point even when an untracked copy exists", async t => {
  const { root } = await fixture(t);
  execFileSync("git", ["rm", "--cached", "-q", "--", "dist/index.html"], { cwd: root });
  await assert.rejects(buildGitHubPages({ root }), /Missing tracked deployment file: dist\/index.html/);
  assert.ok(!(await readdir(root)).includes("_site"));
});
