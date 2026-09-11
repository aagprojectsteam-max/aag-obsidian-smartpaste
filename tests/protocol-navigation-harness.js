const fs = require("node:fs");
const vm = require("node:vm");
const { EditorState } = require("@codemirror/state");

function loadNavigation(obsidian) {
  const context = { setTimeout, clearTimeout, module: { exports: {} }, require(name) {
    if (name === "obsidian") return obsidian;
    if (name === "./protocol-target") return require("../src/protocol-target");
    if (name === "./navigation-highlight") return require("../src/navigation-highlight");
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/protocol-navigation"), "utf8"), context);
  return context.module.exports;
}

function setup(options = {}) {
  const id = options.id || "smartpasteblockID-1234567890abcdef";
  const doc = options.doc || `Intro\n\nטקסט הפסקה ^${id}`;
  let state = EditorState.create({ doc, selection: { anchor: 0, head: doc.length } });
  const calls = [], notices = [], handlers = new Map(), cleanups = [];
  class TFile {}
  class MarkdownView { getMode() { return this.mode; } }
  const obsidian = { TFile, MarkdownView, Notice: class { constructor(text) { notices.push(text); } } };
  const file = Object.assign(new TFile(), { path: options.path || 'דוגמאות/פתק עם רווח.md', extension: "md" });
  const lines = doc.split("\n");
  const start = options.start || { line: 2, col: 0 };
  const end = options.end || { line: lines.length - 1, col: lines.at(-1).length };
  let cache = { blocks: { [id.toLowerCase()]: { id, position: { start, end } } } };
  const editor = {
    lineCount: () => state.doc.lines,
    getLine: line => state.doc.line(line + 1).text,
    getValue: () => state.doc.toString(),
    getSelection: () => state.sliceDoc(state.selection.main.from, state.selection.main.to),
    listSelections: () => state.selection.ranges.map(r => ({ anchor: r.anchor, head: r.head })),
    setCursor(pos) {
      calls.push(["cursor", { ...pos }]);
      const offset = state.doc.line(pos.line + 1).from + pos.ch;
      const tr = state.update({ selection: { anchor: offset } });
      if (tr.docChanged) throw new Error("Navigation edited document");
      state = tr.state;
    },
    focus() { calls.push(["focus"]); },
    scrollIntoView(range, center) { calls.push(["scroll", JSON.parse(JSON.stringify(range)), center]); },
    replaceRange() { throw new Error("Unexpected document write"); },
    setValue() { throw new Error("Unexpected document write"); }
  };
  const view = Object.assign(new MarkdownView(), { file, editor, mode: options.reading ? "preview" : "source" });
  const leaf = { view, async openFile(opened, state) {
    calls.push(["open", opened, JSON.parse(JSON.stringify(state))]);
    view.mode = state.state.mode;
    if (options.onOpen) await options.onOpen(env);
  } };
  let layoutReady;
  const app = {
    vault: {
      getName: () => options.vault || "Example Vault",
      getAbstractFileByPath: path => options.missingFile || path !== file.path ? null : file,
      modify() { throw new Error("Unexpected vault write"); },
      create() { throw new Error("Unexpected vault write"); },
      read() { throw new Error("Unnecessary full-file read"); }
    },
    metadataCache: { getFileCache() { calls.push(["metadata"]); return cache; } },
    workspace: {
      onLayoutReady(callback) { layoutReady = callback; if (!options.cold) callback(); },
      getLeavesOfType: () => options.noExistingLeaf ? [] : [leaf],
      getLeaf(newLeaf) { calls.push(["leaf", newLeaf]); return leaf; },
      async revealLeaf(revealed) { calls.push(["reveal", revealed]); if (options.onReveal) await options.onReveal(env); }
    }
  };
  const plugin = {
    app,
    register(callback) { cleanups.push(callback); },
    registerObsidianProtocolHandler(action, handler) {
      if (handlers.has(action)) throw new Error("Protocol action already registered");
      handlers.set(action, handler);
      this.register(() => handlers.delete(action));
    },
    unload() { for (const callback of cleanups.reverse()) callback(); }
  };
  const navigation = loadNavigation(obsidian);
  const target = { vault: app.vault.getName(), file: file.path, block: id };
  const env = { plugin, app, navigation, target, file, view, leaf, editor, calls, notices, handlers, doc, obsidian,
    get state() { return state; }, get cache() { return cache; }, set cache(value) { cache = value; },
    ready() { layoutReady(); },
    request(extra = {}) { return handlers.get("smartpaste")({ action: "smartpaste", ...target, ...extra }); }
  };
  if (options.register !== false) navigation.registerProtocolNavigation(plugin);
  return env;
}

module.exports = { setup, loadNavigation };
