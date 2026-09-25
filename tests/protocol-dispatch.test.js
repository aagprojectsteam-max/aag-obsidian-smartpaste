const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { buildBlockUri, parseProtocolTarget } = require("../src/protocol-target");
const { setup, loadNavigation } = require("./protocol-navigation-harness");

const id = "smartpasteblockID-0123456789abcdef";

test("exact emitted URI retains vault for host routing and encodes each field once", () => {
  assert.equal(buildBlockUri("AAG Vault", "folder/a note.md", id),
    "obsidian://smartpaste?vault=AAG%20Vault&file=folder%2Fa%20note.md&block=" + id);
});

for (const vault of ["AAG Vault", "כספת בעברית"]) {
  test(`desktop consumes vault before handler dispatch: ${vault}`, async () => {
    const env = setup({ vault, path: 'חזרות/פתק עם רווח%20.md' });
    const uri = new URL(buildBlockUri(vault, env.file.path, env.target.block));
    const params = { ...Object.fromEntries(uri.searchParams), action: uri.hostname };
    assert.equal(params.vault, vault);
    delete params.vault; // Proven desktop main-process contract; native test below.
    assert.deepEqual(parseProtocolTarget(params, vault), env.target);
    await env.handlers.get("smartpaste")(params);
    assert.deepEqual(env.notices, []);
    assert.equal(env.editor.getSelection(), "");
    assert.deepEqual(env.calls.find(c => c[0] === "cursor")[1], { line: 2, ch: 0 });
    assert.equal(env.editor.getValue(), env.doc);
  });
}

test("explicit invalid/mismatched vaults are still rejected", () => {
  for (const vault of ["Other", "", null, undefined, 42]) {
    assert.throws(() => parseProtocolTarget({ action: "smartpaste", file: "note.md", block: id, vault }, "AAG Vault"));
  }
});

test("omitting vault does not relax required fields, action, traversal or unknown-parameter checks", () => {
  for (const bad of [
    { action: "smartpaste", block: id }, { action: "smartpaste", file: "note.md" },
    { action: "open", file: "note.md", block: id },
    { action: "smartpaste", file: "../note.md", block: id },
    { action: "smartpaste", file: "note.md", block: "bad_id" },
    { action: "smartpaste", file: "note.md", block: id, command: "anything" }
  ]) assert.throws(() => parseProtocolTarget(bad, "AAG Vault"));
});

for (const bundle of [false, true]) {
  test(`${bundle ? "built artifact" : "source"}: command URI dispatches to registered handler across plugin reload`, async () => {
    const env = setup({ register: false, vault: "כספת עם רווח", path: "חזרות/פתק%20 עם רווח.md" });
    const writes = [];
    env.app.vault.read = async () => env.doc;
    env.app.workspace.getActiveViewOfType = () => env.view;
    env.editor.getCursor = () => ({ line: 2, ch: 0 });
    class Plugin {
      app = env.app;
      commands = [];
      addCommand(command) { this.commands.push(command); }
      registerEditorExtension() {}
      register(fn) { env.plugin.register(fn); }
      registerObsidianProtocolHandler(action, handler) { env.plugin.registerObsidianProtocolHandler(action, handler); }
    }
    const obsidian = { ...env.obsidian, Plugin };
    const context = { module: { exports: {} }, crypto: webcrypto, console, setTimeout, clearTimeout,
      navigator: { clipboard: { async writeText(uri) { writes.push(uri); } } },
      require(name) {
        if (name === "obsidian") return obsidian;
        if (name === "./editor-command") return require("./editor-command-harness").loadEditorCommand(obsidian);
        if (name === "./remove-location-command") return require("./location-removal-harness").loadRemovalCommand(obsidian);
        if (name === "./protocol-navigation") return loadNavigation(obsidian);
        if (name.startsWith("./")) return require("../src/" + name.slice(2));
        return require(name);
      }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve(bundle ? "../main.js" : "../src/main.js"), "utf8"), context);
    let plugin = new context.module.exports();
    await plugin.onload();
    assert.equal(env.handlers.size, 1, "onload registers before command use");
    const command = plugin.commands.find(c => c.id === "copy-external-link-to-current-location");
    await command.callback();
    assert.equal(writes.length, 1);
    assert.equal(writes[0], buildBlockUri(env.target.vault, env.target.file, env.target.block));
    const url = new URL(writes[0]);
    const params = { ...Object.fromEntries(url.searchParams), action: url.hostname };
    delete params.vault;
    const old = env.handlers.get("smartpaste");
    await old(params);
    assert.deepEqual(env.notices.filter(text => !text.includes("הועתק")), []);
    assert.equal(env.editor.getSelection(), "");
    env.plugin.unload();
    assert.equal(env.handlers.size, 0);
    const count = env.calls.length;
    await old(params);
    assert.equal(env.calls.length, count);
    plugin = new context.module.exports();
    await plugin.onload();
    await env.handlers.get("smartpaste")(params);
    assert.equal(env.handlers.size, 1);
    assert.equal(env.editor.getSelection(), "");
    assert.equal(env.editor.getValue(), env.doc);
  });
}

// Execute the actual installed desktop router, not a reimplementation. These
// function names belong to the inspected 1.13.7 archive; no app code is vendored.
function installedRouter(vault, receive) {
  const archive = fs.readFileSync(process.env.OBSIDIAN_ASAR);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)).toString());
  const main = header.files["main.js"];
  const offset = 8 + archive.readUInt32LE(4) + Number(main.offset);
  const source = archive.subarray(offset, offset + main.size).toString();
  const between = (start, next) => {
    const from = source.indexOf(start), to = source.indexOf(next, from);
    assert.ok(from >= 0 && to > from, "installed protocol router source changed; inspect its contract again");
    return source.slice(from, to);
  };
  const context = { gt: "obsidian://", X: false, console: { log() {} },
    He(name) { assert.equal(name, vault); return "test-vault"; },
    Oe: () => "test-vault", ft(_vault, args) { receive(args); },
    l: { dialog: { showErrorBox() { throw new Error("Vault route failed"); } } }
  };
  vm.runInNewContext(between("function St(", "var $e=") + between("function Vt(", "var W=process.platform") +
    between("function Ge(", "function ft("), context);
  return uri => context.Ge(uri);
}

for (const vault of ["AAG Vault", "כספת עם רווח"]) {
  test(`installed desktop router -> registered handler: ${vault}`, { skip: !process.env.OBSIDIAN_ASAR }, async () => {
    const env = setup({ vault });
    let args;
    const route = installedRouter(vault, received => { args = received; });
    route(buildBlockUri(vault, env.file.path, env.target.block));
    assert.equal(Object.hasOwn(args, "vault"), false, "desktop consumes the routing parameter");
    assert.equal(args.file, env.file.path);
    assert.equal(args.block, env.target.block);
    await env.handlers.get(args.action)(args);
    assert.deepEqual(env.notices, []);
    assert.equal(env.editor.getSelection(), "");
    route(`obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(env.file.path + "#^" + env.target.block)}`);
    assert.equal(args.action, "open");
    assert.equal(args.file, env.file.path + "#^" + env.target.block);
    assert.equal(Object.hasOwn(args, "vault"), false);
  });
}

test("installed router rejects malformed encoding and preserves literal encoded filenames", { skip: !process.env.OBSIDIAN_ASAR }, () => {
  let args;
  const route = installedRouter("AAG Vault", received => { args = received; });
  assert.throws(() => route("obsidian://smartpaste?vault=AAG%20Vault&file=%ZZ&block=" + id));
  assert.equal(args, undefined);
  route(buildBlockUri("AAG Vault", "literal%2e%2e%2f/פתק%20.md", id));
  assert.equal(args.file, "literal%2e%2e%2f/פתק%20.md");
});
