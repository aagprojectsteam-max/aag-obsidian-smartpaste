const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const locationLinks = require("../src/location-links");
globalThis.crypto ??= webcrypto;

function setup(text = "שלום עולם", options = {}) {
  const notices = [];
  const writes = [];
  const events = [];
  const transactions = [];
  class MarkdownView { getMode() { return "source"; } }
  class Plugin {
    commands = [];
    extensions = [];
    protocols = new Map();
    register() {}
    registerObsidianProtocolHandler(action, handler) { this.protocols.set(action, handler); }
    registerEditorExtension(extension) { this.extensions.push(extension); }
    addCommand(command) { this.commands.push(command); }
  }
  const obsidian = { Plugin, MarkdownView, editorLivePreviewField: require("@codemirror/state").StateField.define({ create: () => true, update: value => value }), Notice: class { constructor(message) { notices.push(message); } } };
  const clipboard = {
    async writeText(value) {
      events.push("clipboard");
      if (options.clipboardFails) throw new Error("Clipboard denied");
      writes.push(value);
    },
    async readText() {
      if (options.onClipboardReadText) await options.onClipboardReadText();
      return options.clipboardText ?? "טקסט [plain]";
    },
    async read() {
      if (options.onClipboardRead) await options.onClipboardRead();
      return options.clipboardItems ?? [];
    }
  };
  const context = {
    module: { exports: {} },
    require(name) {
      if (name === "obsidian") return obsidian;
      if (name === "./editor-command") return require("./editor-command-harness").loadEditorCommand(obsidian);
      if (name === "./remove-location-command") return require("./location-removal-harness").loadRemovalCommand(obsidian);
      if (name === "./location-links") return locationLinks;
      if (name === "./html-transform") return require("../src/html-transform");
      if (name === "./protocol-navigation") return { registerProtocolNavigation: require("./protocol-navigation-harness").loadNavigation(obsidian).registerProtocolNavigation };
      if (name === "./block-id-visibility") return require("../src/block-id-visibility");
      if (["@codemirror/state", "@codemirror/view", "@codemirror/language"].includes(name)) return require(name);
      throw new Error(`Unexpected runtime dependency: ${name}`);
    },
    navigator: { clipboard },
    crypto: webcrypto,
    console: { error() {} }
  };
  const source = path.join(__dirname, options.bundle ? "../main.js" : "../src/main.js");
  vm.runInNewContext(fs.readFileSync(source, "utf8"), context, { filename: source });
  const plugin = new context.module.exports();
  let content = text;
  let persisted = options.persisted ?? text;
  let edits = 0;
  const cursor = options.cursor || { line: options.line || 0, ch: 0 };
  let selections = [{ anchor: cursor, head: cursor }];
  const editor = {
    getValue() { return content; },
    getCursor() { return { ...cursor }; },
    listSelections() { return selections; },
    setSelections(value) { selections = value; },
    replaceRange(value, from) {
      const offset = content.split("\n").slice(0, from.line).reduce((n, line) => n + line.length + 1, 0) + from.ch;
      content = content.slice(0, offset) + value + content.slice(offset);
      edits++;
      events.push("edit");
    },
    transaction(change, origin) {
      transactions.push({ change, origin });
      assert.equal(change.changes.length, 1);
      assert.equal(change.changes[0].to, undefined, "insertion only, no replacement range");
      const insertion = change.changes[0];
      this.replaceRange(insertion.text, insertion.from);
      selections = change.selections.map(({ from, to }) => ({ anchor: from, head: to }));
      if (options.onTransaction) options.onTransaction({ editor, view, file });
    },
    getSelection() { return content; },
    replaceSelection(value) { content = value; }
  };
  const file = { path: options.path || 'דוגמאות/דוגמאות שו"ע יו"ד סימן סט.md', extension: "md" };
  const view = new MarkdownView();
  Object.assign(view, { file, editor, async save() {
    events.push("save");
    if (options.onSave) await options.onSave({ editor, view, file });
    if (options.saveFails) throw new Error("Disk full");
    persisted = content;
  } });
  plugin.app = { workspace: { getActiveViewOfType: () => view, getMostRecentLeaf: () => null, onLayoutReady(callback) { callback(); } }, vault: {
    getName() { return "Example Vault"; },
    async read() {
      events.push("read");
      if (options.onRead) await options.onRead({ editor, view, file });
      return options.persistMismatch ? "older data" : persisted;
    }
  } };
  return { plugin, view, editor, notices, writes, events, transactions, clipboard,
    livePreviewField: obsidian.editorLivePreviewField, get edits() { return edits; } };
}

for (const bundle of [false, true]) {
  test(`${bundle ? "built artifact" : "source"}: host-registered extension can be removed without edits`, async () => {
    const { EditorState, Compartment } = require("@codemirror/state");
    const { EditorView } = require("@codemirror/view");
    const env = setup("Text ^smartpasteblockID-1234567890abcdef", { bundle });
    await env.plugin.onload();
    assert.equal(env.plugin.extensions.length, 1, "use Obsidian registration and its unload lifecycle");
    const extension = env.plugin.extensions[0];
    const compartment = new Compartment();
    const state = EditorState.create({ doc: env.editor.getValue(), extensions: [
      env.livePreviewField, compartment.of(extension)
    ] });
    assert.equal(state.facet(EditorView.decorations).length, 1);
    const tr = state.update({ effects: compartment.reconfigure([]) });
    assert.equal(tr.state.facet(EditorView.decorations).length, 0);
    assert.equal(tr.state.facet(EditorView.atomicRanges).length, 0);
    assert.equal(tr.docChanged, false);
    assert.equal(env.edits, 0);
    assert.deepEqual(env.events, []);
  });

  test(`${bundle ? "built artifact" : "source"}: command saves before copying and reuses ID`, async () => {
    const env = setup("שלום עולם", { bundle });
    await env.plugin.onload();
    assert.equal(env.plugin.commands.length, 7);
    const command = env.plugin.commands.find((c) => c.id === "copy-external-link-to-current-location");
    assert.equal(command.name, "העתק קישור חיצוני למיקום הנוכחי");
    await command.callback();
    assert.equal(env.writes.length, 1);
    assert.deepEqual(env.events, ["read", "edit", "save", "read", "clipboard"]);
    assert.match(env.editor.getValue(), /^שלום עולם \^smartpasteblockID-[0-9a-f]{16}$/);
    const uri = new URL(env.writes[0]);
    assert.equal(uri.hostname, "smartpaste");
    assert.equal(uri.searchParams.get("file"), env.view.file.path);
    assert.equal(uri.searchParams.get("block"), env.editor.getValue().split(" ").at(-1).slice(1));
    await command.callback();
    assert.equal(env.edits, 1);
    assert.equal(env.writes[0], env.writes[1]);
    assert.equal(env.events.filter((event) => event === "save").length, 1, "reuse must not trigger a save");
  });
}

test("delayed plain paste aborts after note text changes", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const env = setup("Original", { onClipboardReadText: () => gate });
  await env.plugin.onload();
  const command = env.plugin.commands.find(c => c.id === "paste-html-with-font-sizes");
  const pending = command.callback();
  env.editor.replaceRange("changed ", { line: 0, ch: 0 });
  release(); await pending;
  assert.equal(env.editor.getValue(), "changed Original");
  assert.match(env.notices.at(-1), /Paste cancelled/);
});
test("delayed paste aborts when the view switches files", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const env = setup("Original", { onClipboardReadText: () => gate });
  await env.plugin.onload();
  const pending = env.plugin.commands.find(c => c.id === "paste-small-as-braces").callback();
  env.view.file = { path: "other.md", extension: "md" };
  release(); await pending;
  assert.equal(env.editor.getValue(), "Original");
  assert.match(env.notices.at(-1), /Paste cancelled/);
});
test("delayed paste aborts on unload", async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const env = setup("Original", { onClipboardReadText: () => gate });
  await env.plugin.onload();
  const pending = env.plugin.commands.find(c => c.id === "paste-small-as-colors").callback();
  env.plugin.onunload(); release(); await pending;
  assert.equal(env.editor.getValue(), "Original");
  assert.match(env.notices.at(-1), /Paste cancelled/);
});

test("clipboard rejection keeps the saved ID for retry", async () => {
  const options = { clipboardFails: true };
  const env = setup("Text", options);
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.writes.length, 0);
  assert.equal(env.edits, 1);
  assert.match(env.notices.at(-1), /מזהה הבלוק נשמר/);
  options.clipboardFails = false;
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.edits, 1);
  assert.equal(env.writes.length, 1);
});

test("save failure never copies a URI or reports success", async () => {
  const env = setup("Text", { saveFails: true });
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.writes.length, 0);
  assert.match(env.notices.at(-1), /השמירה נכשלה/);
  assert.equal(env.plugin.copyingLocationLink, false);
});

test("unsupported locations and ambiguous native linkpaths never change notes", async () => {
  for (const [text, options] of [["```\ncode\n```", { line: 1 }], ["Text", { path: "a#b.md" }], ["", {}]]) {
    const env = setup(text, options);
    await env.plugin.copyLocationLink(env.editor, env.view);
    assert.equal(env.edits, 0);
    assert.equal(env.writes.length, 0);
    assert.equal(env.notices.length, 1);
  }
});

test("no Markdown view or clipboard API is handled without mutation", async () => {
  const env = setup();
  await env.plugin.copyLocationLink(env.editor, {});
  delete env.clipboard.writeText;
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.edits, 0);
  assert.equal(env.writes.length, 0);
  assert.equal(env.notices.length, 2);
});

test("file switch, rename, edit, and persisted mismatch cancel clipboard output", async () => {
  for (const options of [
    { onSave({ view }) { view.file = { path: "other.md", extension: "md" }; } },
    { onSave({ file }) { file.path = "renamed.md"; } },
    { onSave({ editor }) { editor.replaceRange("new ", { line: 0, ch: 0 }); } },
    { persistMismatch: true }
  ]) {
    const env = setup("Text", options);
    await env.plugin.copyLocationLink(env.editor, env.view);
    assert.equal(env.writes.length, 0);
    assert.match(env.notices.at(-1), /הפתק השתנה/);
  }
});

test("concurrent invocations cannot insert two IDs", async () => {
  let finishSave;
  const env = setup("Text", { onSave() { return new Promise((resolve) => { finishSave = resolve; }); } });
  const first = env.plugin.copyLocationLink(env.editor, env.view);
  await env.plugin.copyLocationLink(env.editor, env.view);
  finishSave();
  await first;
  assert.equal(env.edits, 1);
  assert.equal(env.writes.length, 1);
});

test("all four original commands and plain-text behavior remain available", async () => {
  const env = setup("[שלום] [world]", { bundle: true });
  await env.plugin.onload();
  assert.deepEqual(Array.from(env.plugin.commands, (c) => c.id).slice(3), [
    "paste-html-with-font-sizes", "paste-small-as-braces", "paste-small-as-colors", "replace-square-brackets-in-selection"
  ]);
  const replace = env.plugin.commands.find((c) => c.id === "replace-square-brackets-in-selection");
  replace.callback();
  assert.equal(env.editor.getValue(), "(שלום) (world)");
  for (const command of env.plugin.commands.slice(3, 6)) {
    await command.callback();
    assert.equal(env.editor.getValue(), "טקסט (plain)");
  }
  assert.equal(env.plugin.normalizeSpaces("  טקסט  { קטן }  "), "טקסט {קטן}");
});

for (const bundle of [false, true]) {
  test(`${bundle ? "bundle" : "source"}: every compatibility case preserves other bytes and uses at most one transaction`, async () => {
    for (const fixture of require("./compatibility-fixtures")) {
      const env = setup(fixture.text, { bundle, line: fixture.line });
      const before = Buffer.from(fixture.text);
      await env.plugin.copyLocationLink(env.editor, env.view);
      if (fixture.abort) {
        assert.equal(env.edits, 0, fixture.name);
        assert.equal(env.writes.length, 0, fixture.name);
        assert.equal(env.events.includes("save"), false, fixture.name);
        assert.deepEqual(Buffer.from(env.editor.getValue()), before);
      } else {
        assert.equal(env.writes.length, 1, fixture.name);
        if (fixture.id) {
          assert.equal(env.edits, 0);
          assert.equal(env.events.includes("save"), false);
          assert.deepEqual(Buffer.from(env.editor.getValue()), before);
        } else {
          assert.equal(env.transactions.length, 1);
          assert.equal(env.transactions[0].origin, "aag-smart-paste-location-link");
          const edit = env.transactions[0].change.changes[0];
          const offset = fixture.text.split("\n").slice(0, edit.from.line).reduce((n, s) => n + s.length + 1, 0) + edit.from.ch;
          const after = env.editor.getValue();
          assert.deepEqual(Buffer.from(after.slice(0, offset) + after.slice(offset + edit.text.length)), before);
        }
        const once = env.editor.getValue();
        const edits = env.edits;
        await env.plugin.copyLocationLink(env.editor, env.view);
        assert.equal(env.edits, edits);
        assert.equal(env.editor.getValue(), once);
        assert.equal(env.writes[0], env.writes[1]);
      }
    }
  });
}

test("normalized CRLF is refused before editing, but an existing ID copies without saving", async () => {
  const env = setup("Text\nNext", { persisted: "Text\r\nNext" });
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.edits, 0);
  assert.equal(env.events.includes("save"), false);
  assert.match(env.notices.at(-1), /סיומות השורה/);
  const reuse = setup("Text ^foreign\n", { persisted: "Text ^foreign\r\n" });
  await reuse.plugin.copyLocationLink(reuse.editor, reuse.view);
  assert.equal(reuse.edits, 0);
  assert.equal(reuse.events.includes("save"), false);
  assert.equal(reuse.writes.length, 1);
});

test("dirty notes and a selection changed during preflight abort without edits", async () => {
  for (const options of [
    { persisted: "Older text" },
    { onRead({ editor }) { editor.setSelections([{ anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 1 } }]); } }
  ]) {
    const env = setup("Text", options);
    await env.plugin.copyLocationLink(env.editor, env.view);
    assert.equal(env.edits, 0);
    assert.equal(env.events.includes("save"), false);
    assert.equal(env.writes.length, 0);
  }
});

test("caret at insertion and forward/reverse selections retain their original text positions", async () => {
  for (const [text, selection, expected] of [
    ["Text", { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 4 } }, null],
    ["Text", { anchor: { line: 0, ch: 1 }, head: { line: 0, ch: 3 } }, null],
    ["Text", { anchor: { line: 0, ch: 3 }, head: { line: 0, ch: 1 } }, null],
    ["> Quote\n\nOther", { anchor: { line: 0, ch: 1 }, head: { line: 2, ch: 2 } },
      { anchor: { line: 0, ch: 1 }, head: { line: 4, ch: 2 } }]
  ]) {
    const env = setup(text);
    env.editor.setSelections([selection]);
    await env.plugin.copyLocationLink(env.editor, env.view);
    assert.equal(env.writes.length, 1);
    assert.equal(JSON.stringify(env.editor.listSelections()), JSON.stringify([expected || selection]));
  }
});

test("multiple selections are declined without disturbing them", async () => {
  const env = setup("Text");
  const selections = [
    { anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
    { anchor: { line: 0, ch: 2 }, head: { line: 0, ch: 2 } }
  ];
  env.editor.setSelections(selections);
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.equal(env.edits, 0);
  assert.deepEqual(env.editor.listSelections(), selections);
});

test("synchronous third-party changes are preserved and cancel further writes", async () => {
  const env = setup("Text", { onTransaction({ editor }) {
    editor.replaceRange("{other-plugin} ", { line: 0, ch: 0 });
  } });
  await env.plugin.copyLocationLink(env.editor, env.view);
  assert.match(env.editor.getValue(), /^\{other-plugin\}/);
  assert.equal(env.events.includes("save"), false);
  assert.equal(env.writes.length, 0);
  assert.match(env.notices.at(-1), /ההעתקה נעצרה/);
});

for (const bundle of [false, true]) {
  for (const mode of ["Live Preview", "Source"]) {
    test(`${bundle ? "bundle" : "source"}: ${mode} simulated decorated editor uses logical Markdown coordinates`, async () => {
      for (const fixture of require("./gui-regression-fixtures")) {
        const cursor = { line: fixture.line, ch: fixture.ch };
        const env = setup(fixture.text, { bundle, cursor });
        // Presentation-only fields must never participate in safety decisions.
        for (const property of ["containerEl", "contentEl", "previewMode", "sourceMode"]) {
          Object.defineProperty(env.view, property, { get() { throw new Error(`Read decoration DOM: ${property}`); } });
        }
        Object.defineProperty(env.editor, "cm", { get() { throw new Error("Read CodeMirror decoration state"); } });
        // Source and Live Preview both report source; only the execution gate reads it.
        env.view.getMode = () => "source";
        await env.plugin.onload();
        const command = env.plugin.commands.find((c) => c.id === "copy-external-link-to-current-location");
        await command.callback();
        assert.equal(env.writes.length, 1, fixture.name);
        assert.deepEqual(JSON.parse(JSON.stringify(env.editor.listSelections())), [{ anchor: cursor, head: cursor }]);
        const once = env.editor.getValue();
        await command.callback();
        assert.equal(env.editor.getValue(), once);
        assert.equal(env.writes[0], env.writes[1]);
        assert.equal(env.transactions.length, fixture.id ? 0 : 1);
        assert.match(env.notices.at(-1), /הועתק/);
      }
    });
  }
}

for (const bundle of [false, true]) {
  test(`${bundle ? "bundle" : "source"}: association action saves stable marker and delegates exact URI only to Bridge`, async () => {
    const env = setup("Location", { bundle });
    const requests = [];
    env.plugin.app.plugins = { getPlugin: id => {
      assert.equal(id, "aag-anki-bridge");
      return { async associateObsidianLocation(request) { requests.push(request); env.events.push("bridge"); } };
    } };
    delete env.clipboard.writeText;
    await env.plugin.onload();
    const command = env.plugin.commands.find(c => c.id === "associate-current-location-with-anki");
    await command.callback();
    assert.deepEqual(env.events, ["read", "edit", "save", "read", "bridge"]);
    const uri = new URL(requests[0].uri);
    assert.equal(uri.searchParams.get("block"), env.editor.getValue().split("^").at(-1));
    assert.equal(uri.searchParams.get("file"), env.view.file.path);
    assert.deepEqual(Object.keys(requests[0]), ["uri"], "SmartPaste has no Anki target or profile responsibilities");
    await command.callback();
    assert.equal(requests[1].uri, requests[0].uri);
    assert.equal(env.edits, 1);
    assert.deepEqual(env.writes, []);
  });
  test(`${bundle ? "bundle" : "source"}: missing or legacy Bridge prevents association action from editing`, async () => {
    const env = setup("Location", { bundle });
    env.plugin.app.plugins = { getPlugin: () => ({ sendCurrentNote() { throw Error("Must not use open action"); } }) };
    await env.plugin.onload();
    await env.plugin.commands.find(c => c.id === "associate-current-location-with-anki").callback();
    assert.equal(env.edits, 0);
    assert.deepEqual(env.writes, []);
    assert.match(env.notices.at(-1), /coordinated AAG Anki Bridge/);
  });
}
