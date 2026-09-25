const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

function findChromium() {
  for (const name of ["chromium", "chromium-browser", "google-chrome"]) {
    const result = cp.spawnSync("sh", ["-c", "command -v " + name], { encoding: "utf8" });
    if (result.status === 0) return name;
  }
  return null;
}
const chromium = findChromium();

test("real Chromium DOM preserves structure and sanitizes unsupported active HTML", {
  skip: !chromium
}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aag-smartpaste-dom-"));
  const htmlFile = path.join(dir, "test.html");
  const sourceFile = path.join(dir, "html-transform.js");
  const testFile = path.join(dir, "test.js");

  fs.copyFileSync(path.join(__dirname, "../src/html-transform.js"), sourceFile);
  fs.writeFileSync(testFile, [
    "const h=window.module.exports;",
    "const cases=[];",
    "const cleaned=h.cleanHtml('<p style=\"font-size:12px;color:red\">Para</p><pre>code</pre><picture><source src=x>pic</picture><progress>42</progress>');",
    "cases.push(/<div[^>]*font-size:12px/.test(cleaned));",
    "cases.push(cleaned.includes('<pre>code</pre>'));",
    "cases.push(!/divre|<picture|<progress|<source/.test(cleaned));",
    "const braces=h.smallToBraces('<p>one <small>קטן</small></p><p>two</p>three<br>four');",
    "cases.push(braces.includes('one {קטן}'));",
    "cases.push(/one \\{קטן\\}\\n+two/.test(braces));",
    "cases.push(braces.includes('three\\nfour'));",
    "const hostile=h.cleanHtml('<script>bad()</script><iframe src=x></iframe><p onclick=x style=\"direction:rtl;background:url(x)\">שלום</p>');",
    "cases.push(!/script|iframe|onclick|background|url\\(/i.test(hostile));",
    "cases.push(/direction:rtl/.test(hostile));",
    "cases.push(/class=\"aag-smart-paste-html\"/.test(cleaned));",
    "document.getElementById('result').textContent=cases.every(Boolean)?'PASS':JSON.stringify({cases,cleaned,braces,hostile});"
  ].join("\n"));

  fs.writeFileSync(htmlFile,
    "<!doctype html><meta charset=\"utf-8\"><body><pre id=\"result\">RUNNING</pre>" +
    "<script>window.module={exports:{}};</script>" +
    "<script src=\"html-transform.js\"></script>" +
    "<script src=\"test.js\"></script></body>"
  );

  try {
    const r = cp.spawnSync(chromium, [
      "--headless", "--no-sandbox", "--disable-gpu", "--dump-dom", "file://" + htmlFile
    ], { encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /<pre id="result">PASS<\/pre>/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("stylesheet is scoped to SmartPaste-owned HTML", () => {
  const css = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
  assert.match(css, /\.aag-smart-paste-html/);
  assert.doesNotMatch(css, /\.markdown-preview-view\s+(?:span|div)\[style/);
});
