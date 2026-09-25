const test = require("node:test");
const assert = require("node:assert/strict");
const { parseProtocolTarget, buildBlockUri } = require("../src/protocol-target");
const { setup } = require("./protocol-navigation-harness");

test('editor below tall properties is revealed before its queued exact scroll', async () => {
  const env = setup(), calls = [];
  env.editor.cm = {
    inView: false, dom: {isConnected: true}, scrollDOM: {clientHeight: 500},
    contentDOM: {scrollIntoView(options) {calls.push(['reveal', options]); env.editor.cm.inView = true;}}
  };
  const scroll = env.editor.scrollIntoView;
  env.editor.scrollIntoView = (...args) => {assert.equal(env.editor.cm.inView, true); calls.push(['exact']); scroll(...args);};
  await env.request();
  assert.deepEqual(calls.map(call => call[0]), ['reveal', 'exact']);
  assert.equal(env.editor.getValue(), env.doc);
});

const id = "smartpasteblockID-0123456789abcdef";
const params = { action: "smartpaste", vault: "AAG Vault", file: "note.md", block: id };

for (const path of ["note.md", 'חזרות/חזרות שו"ע יו"ד סימן צב.md', "spaces in name.md",
  "one/two/three.md", "literal%20filename.md", "literal%2e%2e/note.md", "plus+percent%25.md"]) {
  test(`protocol URI round trip with one decoding: ${path}`, () => {
    const uri = buildBlockUri(params.vault, path, id);
    const url = new URL(uri);
    assert.equal(url.hostname, "smartpaste");
    assert.equal(url.hash, "");
    const decoded = { action: url.hostname, ...Object.fromEntries(url.searchParams) };
    assert.deepEqual(parseProtocolTarget(decoded, params.vault), { vault: params.vault, file: path, block: id });
    assert.equal(url.searchParams.get("block"), id);
    assert.doesNotMatch(uri, /[\s+]/);
  });
}

for (const block of [id, "aag-1234567890abcdef", "user-id", "sidenotes-123"]) {
  test(`navigation accepts and preserves existing native ID: ${block}`, async () => {
    const env = setup({ id: block });
    await env.request();
    assert.deepEqual(env.notices, []);
    assert.equal(env.editor.getValue(), env.doc);
    assert.equal(env.editor.getSelection(), "");
    assert.equal(env.state.selection.main.anchor, env.state.selection.main.head);
    assert.deepEqual(env.calls.find(c => c[0] === "cursor")[1], { line: 2, ch: 0 });
  });
}

for (const block of ["", "^" + id, "bad_id", "bad/id", "bad#id", "id\n", "id%20", "x);alert(1)", null]) {
  test(`malformed block is rejected: ${JSON.stringify(block)}`, () => {
    assert.throws(() => parseProtocolTarget({ ...params, block }, params.vault));
  });
}
for (const file of ["../note.md", "folder/../../note.md", "/tmp/note.md", "C:/note.md",
  "folder\\note.md", "folder/./note.md", "folder//note.md", "file:///tmp/note.md", "note.md\0", "note.pdf"]) {
  test(`unsafe path is rejected before file lookup: ${JSON.stringify(file)}`, async () => {
    assert.throws(() => parseProtocolTarget({ ...params, file }, params.vault));
    const env = setup();
    await env.request({ file });
    assert.equal(env.calls.length, 0);
    assert.equal(env.notices.length, 1);
  });
}

test("wrong action/vault, missing, extra, or non-string parameters cannot invoke navigation", async () => {
  for (const malformed of [null, [], {}, { ...params, action: "open" }, { ...params, vault: "Other" },
    { ...params, file: ["note.md"] }, { ...params, command: "delete" }, { ...params, "x-success": "javascript:evil()" },
    Object.create(params)]) assert.throws(() => parseProtocolTarget(malformed, params.vault));
  const env = setup();
  await env.request({ vault: "Other" });
  assert.equal(env.calls.length, 0);
});

const starts = [
  ["plain paragraph", `First character ^${id}`, { line: 0, ch: 0 }],
  ["Hebrew paragraph", `טקסט הפסקה ^${id}`, { line: 0, ch: 0 }],
  ["mixed Hebrew/English", `עברית English ^${id}`, { line: 0, ch: 0 }],
  ["multiline paragraph", `First line\nSecond line ^${id}`, { line: 0, ch: 0 }],
  ["list content", `- List item ^${id}`, { line: 0, ch: 2 }],
  ["ordered list content", `12. Item ^${id}`, { line: 0, ch: 4 }],
  ["task content", `- [ ] משימה ^${id}`, { line: 0, ch: 6 }],
  ["checked task", `- [x] Task ^${id}`, { line: 0, ch: 6 }],
  ["empty task falls back before structure instead of on ID", `- [ ] ^${id}`, { line: 0, ch: 0 }],
  ["blockquote content", `> ציטוט\n\n^${id}`, { line: 0, ch: 2 }, { line: 0, col: 7 }],
  ["nested quote", `> > Quote\n\n^${id}`, { line: 0, ch: 4 }, { line: 0, col: 9 }],
  ["callout body", `> [!note] Title\n>\n> גוף התוכן\n\n^${id}`, { line: 2, ch: 2 }, { line: 2, col: 11 }],
  ["empty callout falls back to source start", `> [!note]\n\n^${id}`, { line: 0, ch: 0 }, { line: 0, col: 9 }],
  ["heading native target", `## Heading ^${id}`, { line: 0, ch: 3 }],
  ["table source start", `| A | B |\n| - | - |\n| 1 | 2 |\n\n^${id}`, { line: 0, ch: 0 }, { line: 2, col: 9 }]
];
for (const [name, doc, cursor, end] of starts) {
  test(`collapsed cursor at editable logical start: ${name}`, async () => {
    const env = setup({ id, doc, start: { line: 0, col: 0 }, end });
    await env.request();
    assert.deepEqual(env.notices, []);
    assert.deepEqual(env.calls.find(c => c[0] === "cursor")[1], cursor);
    assert.deepEqual(env.calls.find(c => c[0] === "scroll"), ["scroll", { from: cursor, to: cursor }, true]);
    assert.equal(env.editor.getSelection(), "");
    assert.equal(env.state.selection.ranges.length, 1);
    assert.equal(env.state.selection.main.anchor, env.state.selection.main.head);
    assert.equal(env.editor.getValue(), doc);
    assert.ok(env.state.selection.main.head < doc.lastIndexOf("^" + id));
  });
}

test("nested list starts at cached item line, after indentation and marker", async () => {
  const doc = `- Parent\n  - Child ^${id}`;
  const env = setup({ id, doc, start: { line: 1, col: 2 } });
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.deepEqual(env.calls.find(c => c[0] === "cursor")[1], { line: 1, ch: 4 });
});

test("missing file or block produces a notice without opening or editing", async () => {
  for (const missingFile of [true, false]) {
    const env = setup({ missingFile });
    if (!missingFile) env.cache = null;
    await env.request();
    assert.equal(env.notices.length, 1);
    assert.equal(env.calls.some(c => c[0] === "open"), false);
    assert.equal(env.editor.getValue(), env.doc);
  }
});

test("existing leaf is reused; Reading View switches to an editor without native highlighting state", async () => {
  const env = setup({ reading: true });
  await env.request();
  const options = env.calls.find(c => c[0] === "open")[2];
  assert.deepEqual(options, { active: true, state: { mode: "source" }, eState: {} });
  assert.equal(env.calls.some(c => c[0] === "leaf"), false);
  assert.equal(env.view.getMode(), "source");
  assert.equal(env.calls.filter(c => c[0] === "reveal").length, 1);
  assert.equal(env.calls.filter(c => c[0] === "focus").length, 1);
});

test("no existing target leaf uses the normal navigable leaf", async () => {
  const env = setup({ noExistingLeaf: true });
  await env.request();
  assert.deepEqual(env.calls.find(c => c[0] === "leaf"), ["leaf", false]);
});

test("repeated navigation stays collapsed, keeps the target, and never changes Markdown", async () => {
  const env = setup();
  await Promise.all([env.request(), env.request(), env.request()]);
  assert.deepEqual(env.notices, []);
  assert.equal(env.calls.filter(c => c[0] === "cursor").length, 3);
  assert.equal(env.editor.getSelection(), "");
  assert.equal(env.editor.getValue(), env.doc);
});

test("post-open cursor restoration finishes BEFORE explicit block navigation", async () => {
  const restorer = { loadingFile: false };
  const env = setup({ onOpen(env) {
    restorer.loadingFile = true;
    setTimeout(() => { env.editor.setCursor({line: 0, ch: 0}); restorer.loadingFile = false; }, 80);
  } });
  env.app.plugins = { getPlugin: id => id === "remember-cursor-position" ? restorer : null };
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.editor.getCursor().line, 2);
  assert.equal(env.calls.filter(c => c[0] === "cursor")[0][1].line, 0);
  assert.equal(env.editor.getValue(), env.doc);
});

test("late first-layout selection replacement is corrected before success", async () => {
  const env = setup();
  const original = env.editor.scrollIntoView;
  let once = true;
  env.editor.scrollIntoView = (...args) => {
    original(...args);
    if (once) { once = false; setTimeout(() => env.editor.setCursor({line: 0, ch: 0}), 5); }
  };
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.editor.getCursor().line, 2);
});

test("stuck restoration fails explicitly instead of reporting exact navigation", async () => {
  const env = setup();
  env.app.plugins = { getPlugin: () => ({loadingFile: true}) };
  await assert.rejects(env.plugin.navigateToLocation(env.target));
  assert.equal(env.calls.some(c => c[0] === "cursor"), false);
});

test("stale or malformed cache does not place a cursor at a wrong marker", async () => {
  for (const position of [
    { start: { line: 0, col: 0 }, end: { line: 0, col: 5 } },
    { start: { line: 200, col: 0 }, end: { line: 200, col: 0 } },
    { start: { line: 2, col: -1 }, end: { line: 2, col: 2 } },
    { start: { line: 2, col: 10 }, end: { line: 1, col: 0 } }
  ]) {
    const env = setup();
    Object.values(env.cache.blocks)[0].position = position;
    await env.request();
    assert.equal(env.notices.length, 1);
    assert.equal(env.calls.some(c => c[0] === "cursor"), false);
  }
});

test("metadata is re-read after opening and the file must still be the requested file", async () => {
  for (const options of [
    { onOpen(env) { env.cache = null; } },
    { onReveal(env) { env.view.file = {}; } },
    { onReveal(env) { env.file.path = "renamed.md"; } },
    { onOpen() { throw new Error("Failed to open"); } }
  ]) {
    const env = setup(options);
    await env.request();
    assert.equal(env.notices.length, 1);
    assert.equal(env.calls.some(c => c[0] === "cursor"), false);
    assert.equal(env.editor.getValue(), env.doc);
  }
});

test("cold startup waits for layout readiness without a timer", async () => {
  const env = setup({ cold: true });
  const promise = env.request();
  await Promise.resolve();
  assert.equal(env.calls.length, 0);
  env.ready();
  await promise;
  assert.equal(env.editor.getSelection(), "");
});

test("unload unregisters protocol and cancels startup navigation", async () => {
  const env = setup({ cold: true });
  const promise = env.request();
  env.plugin.unload();
  await promise;
  env.ready();
  assert.equal(env.handlers.size, 0);
  assert.equal(env.calls.length, 0);
});

test("unload during file opening cancels cursor/focus/scroll and queued requests", async () => {
  const env = setup({ onOpen(env) { env.plugin.unload(); } });
  await Promise.all([env.request(), env.request()]);
  assert.equal(env.handlers.size, 0);
  assert.equal(env.calls.filter(c => c[0] === "open").length, 1);
  assert.equal(env.calls.some(c => ["cursor", "focus", "scroll"].includes(c[0])), false);
  assert.equal(env.editor.getValue(), env.doc);
});


test("closed note waits for requested file identity after reveal resolves early", async () => {
  let env;
  env = setup({ noExistingLeaf: true, onReveal(e) {
    e.view.file = { path: "previous.md" };
    setTimeout(() => { e.view.file = e.file; }, 40);
  } });
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.calls.filter(c => c[0] === "cursor").length, 1);
  assert.equal(env.view.file, env.file);
  assert.equal(env.editor.getValue(), env.doc);
});

test("closed note waits for the editor content to match indexed block", async () => {
  const env = setup({ noExistingLeaf: true, onReveal(e) {
    e.view.editor = { ...e.editor, lineCount: () => 1 };
    setTimeout(() => { e.view.editor = e.editor; }, 40);
  } });
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.calls.filter(c => c[0] === "cursor").length, 1);
  assert.equal(env.editor.getValue(), env.doc);
});

test("unload while awaiting file readiness never moves the cursor", async () => {
  const env = setup({ noExistingLeaf: true, onReveal(e) {
    e.view.file = { path: "previous.md" };
    setTimeout(() => e.plugin.unload(), 20);
  } });
  await env.request();
  assert.equal(env.calls.filter(c => c[0] === "cursor").length, 0);
});


test("newly saved block waits for metadata without opening a file-only target", async () => {
  const env = setup();
  const indexed = env.cache;
  env.cache = null;
  setTimeout(() => { env.cache = indexed; }, 40);
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.calls.filter(c => c[0] === "cursor").length, 1);
  assert.equal(env.editor.getValue(), env.doc);
});

test("Opener-style redirection reveals and navigates the actual target leaf", async () => {
  let redirected;
  const env = setup({ noExistingLeaf: true, onOpen(e) {
    redirected = { view: Object.assign(new e.obsidian.MarkdownView(), { file: e.file, editor: e.editor, mode: 'source' }) };
    e.view.file = { path: 'previous.md' };
    e.view.editor = { setCursor() { throw new Error('Wrong editor'); } };
    e.app.workspace.activeLeaf = redirected;
    e.app.workspace.getLeavesOfType = () => [e.leaf, redirected];
  } });
  await env.request();
  assert.deepEqual(env.notices, []);
  assert.equal(env.calls.find(c => c[0] === 'reveal')[1], redirected);
  assert.equal(env.calls.filter(c => c[0] === 'cursor').length, 1);
  assert.equal(env.editor.getValue(), env.doc);
});
