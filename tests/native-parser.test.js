const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { planLocationLink } = require("../src/location-links");
const { supported, applyPlan } = require("./fixtures");
const compatibility = require("./compatibility-fixtures").filter((fixture) => !fixture.abort);
const guiRegressions = require("./gui-regression-fixtures");

// Optional compatibility check against the user's installed Obsidian parser.
// No app launch, vault access, or redistribution of proprietary code.
function nativeWorker() {
  const archive = fs.readFileSync(process.env.OBSIDIAN_ASAR);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
  const worker = header.files["worker.js"];
  const start = 8 + archive.readUInt32LE(4) + Number(worker.offset);
  let result;
  const context = { self: { postMessage(value) { result = value; } }, TextDecoder, console };
  vm.runInNewContext(archive.subarray(start, start + worker.size).toString(), context, { timeout: 10000 });
  return (data) => {
    result = undefined;
    context.self.onmessage({ data });
    return result;
  };
}

test("installed Obsidian indexes every supported fixture at the intended block", {
  skip: !process.env.OBSIDIAN_ASAR
}, () => {
  const parse = nativeWorker();
  for (const fixture of [...supported, ...compatibility, ...guiRegressions]) {
    const plan = planLocationLink(fixture.text, { line: fixture.line, ch: 0 }, () => "1234567890abcdef");
    const output = applyPlan(fixture.text, plan);
    const result = parse({ metadataCache: new TextEncoder().encode(output) });
    const block = result?.blocks?.[plan.id.toLowerCase()];
    assert.ok(block, `${fixture.name}: native parser must recognize ${plan.id}`);
    assert.equal(block.position.start.line, fixture.start, `${fixture.name}: correct target block`);
  }
});

test("installed Obsidian indexes both SmartPaste namespaces without rewriting existing IDs", {
  skip: !process.env.OBSIDIAN_ASAR
}, () => {
  const parse = nativeWorker();
  for (const id of ["aag-1234567890abcdef", "smartpasteblockID-1234567890abcdef", "user-id", "sidenotes-123"]) {
    for (const doc of [`עברית ^${id}`, `> Quote\n\n^${id}`]) {
      const plan = planLocationLink(doc, { line: 0, ch: 0 });
      assert.equal(plan.id, id);
      assert.equal(plan.edit, null);
      assert.ok(parse({ metadataCache: new TextEncoder().encode(doc) }).blocks[id.toLowerCase()]);
    }
  }
});

test("installed Obsidian Reading View natively omits block ID markers", {
  skip: !process.env.OBSIDIAN_ASAR
}, () => {
  const parse = nativeWorker();
  for (const id of ["aag-1234567890abcdef", "smartpasteblockID-1234567890abcdef", "user-id"]) {
    for (const doc of [`טקסט English ^${id}`, `> ציטוט\n\n^${id}`]) {
      const rendered = parse({ parseSections: doc });
      assert.ok(rendered.sections.length);
      const html = rendered.sections.map(section => section.html).join("");
      assert.doesNotMatch(html, /\^(?:aag|smartpasteblockID|user)-/);
      assert.doesNotMatch(html, new RegExp(id));
      assert.match(html, /טקסט|ציטוט/);
    }
  }
});

test("navigation accepts real Obsidian block positions for every supported location", {
  skip: !process.env.OBSIDIAN_ASAR
}, () => {
  const parse = nativeWorker();
  const { blockCursor } = require("./protocol-navigation-harness").loadNavigation({});
  for (const fixture of [...supported, ...compatibility, ...guiRegressions]) {
    const plan = planLocationLink(fixture.text, { line: fixture.line, ch: 0 }, () => "1234567890abcdef");
    const output = applyPlan(fixture.text, plan);
    const cache = parse({ metadataCache: new TextEncoder().encode(output) });
    const block = cache.blocks[plan.id.toLowerCase()];
    const lines = output.split(/\r?\n/);
    const cursor = blockCursor(block, { lineCount: () => lines.length, getLine: line => lines[line] }, plan.id);
    assert.ok(cursor.line >= block.position.start.line && cursor.line <= block.position.end.line, fixture.name);
    assert.ok(cursor.ch <= lines[cursor.line].length, fixture.name);
    assert.doesNotMatch(lines[cursor.line].slice(cursor.ch), /^\^[A-Za-z0-9-]+$/, fixture.name);
  }
});

test("real native metadata resolves editable paragraph/list/task/quote/callout/heading starts", {
  skip: !process.env.OBSIDIAN_ASAR
}, () => {
  const parse = nativeWorker();
  const { blockCursor } = require("./protocol-navigation-harness").loadNavigation({});
  const id = "smartpasteblockID-1234567890abcdef";
  for (const [source, expected] of [
    [`עברית\nEnglish ^${id}`, { line: 0, ch: 0 }],
    [`- First\n  - Nested ^${id}`, { line: 1, ch: 4 }],
    [`- [x] משימה ^${id}`, { line: 0, ch: 6 }],
    [`>   ציטוט\n\n^${id}`, { line: 0, ch: 4 }],
    [`> [!note] Title\n> גוף\n\n^${id}`, { line: 1, ch: 2 }],
    [`## Heading ^${id}`, { line: 0, ch: 3 }]
  ]) {
    const block = parse({ metadataCache: new TextEncoder().encode(source) }).blocks[id.toLowerCase()];
    const lines = source.split("\n");
    const actual = blockCursor(block, { lineCount: () => lines.length, getLine: line => lines[line] }, id);
    assert.deepEqual({ ...actual }, expected);
  }
});

test("removal makes the existing external block target unresolved in native metadata", {
  skip: !process.env.OBSIDIAN_ASAR
}, async () => {
  const { planLocationRemoval } = require('../src/location-removal');
  const { setup } = require('./protocol-navigation-harness');
  const parse = nativeWorker();
  for (const fixture of [...supported, ...compatibility, ...guiRegressions]) {
    const created = planLocationLink(fixture.text, { line: fixture.line, ch: 0 }, () => '1234567890abcdef');
    if (!/^smartpasteblockID-[0-9a-f]{16}$/.test(created.id)) continue;
    const before = applyPlan(fixture.text, created);
    const indexed = parse({ metadataCache: new TextEncoder().encode(before) });
    const block = indexed.blocks[created.id.toLowerCase()];
    assert.ok(block, fixture.name);
    const edit = planLocationRemoval(before, { line: fixture.line, ch: 0 });
    assert.ok(edit, fixture.name);
    const offset = before.split('\n').slice(0,edit.from.line).reduce((n,line)=>n+line.length+1,0);
    const after = before.slice(0,offset+edit.from.ch)+before.slice(offset+edit.to.ch);
    const reindexed = parse({ metadataCache: new TextEncoder().encode(after) });
    assert.equal(reindexed.blocks?.[created.id.toLowerCase()], undefined, fixture.name);
    const env = setup({ doc:before.replace(/\r\n/g, "\n"), id:created.id, start:block.position.start, end:block.position.end });
    env.cache = indexed;
    await env.request();
    assert.equal(env.notices.length,0,fixture.name);
    const calls = env.calls.length;
    env.cache = reindexed;
    await env.request();
    assert.equal(env.notices.length,1,fixture.name);
    assert.match(env.notices[0],/לא נמצא/);
    assert.equal(env.calls.slice(calls).some(c=>c[0]==='open'||c[0]==='cursor'),false,'removed target cannot silently fall back');
  }
});
