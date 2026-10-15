import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const katex = createRequire(import.meta.url)("../dist/vendor/katex/katex.min.js");
const appSource = readFileSync("dist/app.js", "utf8");
const renderer = appSource.slice(appSource.indexOf("function escapeHtml("), appSource.indexOf("function makeLessons("));
const { renderMathText, renderMarkdown } = vm.runInNewContext(`${renderer}\n({ renderMathText, renderMarkdown })`, { window: { katex } });
const options = { throwOnError: true, trust: false, strict: "ignore", maxExpand: 1000, maxSize: 12 };

test("explicit variables and fractions render as accessible math while articles and prices remain text", () => {
  const html = renderMathText(String.raw`A escolha tem \(a\) possibilidades; \(C(n,k)=\frac{n!}{k!(n-k)!}\). Custa R$ 200.`);
  assert.ok(html.startsWith("A escolha tem "));
  assert.ok(html.includes('class="katex-mathml"'));
  assert.ok(html.includes("<mi>a</mi>"));
  assert.ok(html.includes("<mfrac>"));
  assert.ok(html.endsWith(". Custa R$ 200."));
  assert.equal(renderMathText("A escolha leva a uma resposta por R$ 10,00."), "A escolha leva a uma resposta por R$ 10,00.");
});

test("multiple inline and display expressions preserve prose and mathematical indices", () => {
  const html = renderMathText(String.raw`Com \(v_0=0\), temos \[E_c=\frac{mv^2}{2}\] e \(\mathrm{H_2O}\).`);
  assert.equal((html.match(/class="katex"/g) || []).length, 3);
  assert.ok(html.includes('class="math-display"'));
  assert.ok(html.includes("<msub>"));
  assert.ok(html.includes("<msup>"));
  assert.ok(!html.includes("math-fallback"));
});

test("math and Markdown never enable HTML or trusted TeX commands", () => {
  const html = renderMathText(String.raw`<img src=x onerror=alert(1)> \(\href{javascript:alert(1)}{x}\) \(\includegraphics{https://evil.invalid/a.png}\)`);
  assert.ok(html.startsWith("&lt;img"));
  assert.ok(!/<(?:img|script|a)\b/i.test(html));
  const invalid = renderMathText(String.raw`\(\unknown{<script>alert(1)</script>}\)`);
  assert.ok(invalid.includes("math-fallback"));
  assert.ok(!invalid.includes("<script>"));
  const markdown = renderMarkdown(String.raw`**Área**: \(A=x^2\)\n![Figura](/assets/questions/2023/1/a.png)`.replace("\\n", "\n"));
  assert.ok(markdown.includes("<strong>Área</strong>"));
  assert.ok(markdown.includes('class="katex"'));
  assert.ok(markdown.includes('<img src="/assets/questions/2023/1/a.png"'));
  assert.ok(!renderMarkdown("![x](javascript:alert)").includes("<img"));
});

test("escaped quotation omissions stay prose while actual display equations render", () => {
  const html = renderMarkdown(String.raw`O texto diz \[…\] e \[...\], com \[x^2=4\].`);
  assert.ok(html.includes("O texto diz […] e [...]"));
  assert.equal((html.match(/class="math-display"/g) || []).length, 1);
  assert.ok(html.includes("<msup>"));
});

test("source images with quoted Markdown titles preserve a valid image URL", () => {
  const html = renderMarkdown('![imagem (Foto: Reprodução/Enem)](/assets/questions/2010/168/figure.png "imagem (Foto: Reprodução/Enem)")');
  assert.ok(html.includes('<img src="/assets/questions/2010/168/figure.png"'));
  assert.ok(html.includes('alt="imagem (Foto: Reprodução/Enem)"'));
  assert.ok(!html.includes('&quot;imagem'));
  assert.ok(!renderMarkdown('![x](javascript:alert "title (test)")').includes('<img'));
});

test("all editorial expressions parse with local KaTeX and balanced explicit delimiters", () => {
  const catalog = JSON.parse(readFileSync("dist/data/courses.json", "utf8"));
  let count = 0;
  function visit(value, location) {
    if (typeof value === "string") {
      const regex = /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g;
      for (const match of value.matchAll(regex)) {
        assert.doesNotThrow(() => katex.renderToString(match[1] ?? match[2], { ...options, displayMode: match[2] !== undefined }), `${location}: ${match[0]}`);
        count++;
      }
      assert.ok(!/\\[()[\]]/.test(value.replace(regex, "")), `Unbalanced math delimiter at ${location}`);
      assert.ok(!renderMathText(value).includes('class="math-fallback"'), location);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) visit(child, `${location}.${key}`);
    }
  }
  for (const course of catalog.courses) for (const module of course.modules) visit(module.introduction, module.id);
  for (const question of catalog.questions) visit(question.explanation, question.id);
  assert.ok(count > 100, "The catalog must contain reviewed mathematical notation, not only a renderer");
});

test("every mathematical font referenced by CSS is local and available offline", () => {
  const css = readFileSync("dist/vendor/katex/katex.min.css", "utf8");
  const worker = readFileSync("dist/sw.js", "utf8");
  const fonts = [...css.matchAll(/url\((?:["'])?(fonts\/[^)"']+)/g)].map(match => match[1]);
  assert.ok(fonts.length > 0);
  for (const font of fonts) {
    assert.ok(font.endsWith(".woff2"));
    assert.ok(existsSync(`dist/vendor/katex/${font}`), font);
    assert.ok(worker.includes(JSON.stringify(font.split("/").at(-1))), `Missing offline font: ${font}`);
  }
  assert.ok(existsSync("dist/vendor/katex/LICENSE"));
});
