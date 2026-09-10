const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadEditorCommand } = require('./editor-command-harness');
const { loadRemovalCommand } = require('./location-removal-harness');
const { loadNavigation } = require('./protocol-navigation-harness');

const expected = {
  'remove-smartpaste-location-point': 'מחק נקודת הפניה של SmartPaste מהפסקה',
  'copy-external-link-to-current-location': 'העתק קישור חיצוני למיקום הנוכחי',
  'paste-html-with-font-sizes': 'Paste HTML With Font Sizes',
  'paste-small-as-braces': 'Paste Small Text As Braces',
  'paste-small-as-colors': 'Paste Small Text As Colors',
  'replace-square-brackets-in-selection': 'Replace [] With () In Selection'
};

function hostMethods() {
  if (!process.env.OBSIDIAN_ASAR) return null;
  const archive = fs.readFileSync(process.env.OBSIDIAN_ASAR);
  const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
  const entry = header.files['app.js'];
  const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
  const source = archive.subarray(offset, offset + entry.size).toString();
  const start = source.indexOf('var s5=function');
  assert.ok(start >= 0, 'inspect changed host contract if extraction changes');
  const manager = source.slice(start, source.indexOf('l5=function', start));
  const method = name => manager.match(new RegExp('t\\.prototype\\.' + name + '=(function[\\s\\S]*?)(?=,t\\.prototype\\.)'))?.[1];
  assert.ok(method('addCommand') && method('listCommands'));
  return { add: method('addCommand'), list: method('listCommands') };
}

async function setup(options = {}) {
  const notices = [], registrations = [], cleanups = [], events = [], errors = [];
  let activeView = null, recentLeaf = null, prohibitContextRead = true;
  class MarkdownView { getMode() { return this.mode || 'source'; } }
  const view = Object.assign(new MarkdownView(), {
    file: { path: 'פתק.md', extension: 'md' }, editor: {},
    inlineTitleEl: { isActiveElement: () => false }, titleEl: { isActiveElement: () => false }
  });
  const app = { workspace: {
    get activeEditor() { return activeView; },
    getActiveViewOfType() { assert.equal(prohibitContextRead, false, 'do not resolve editor during registration'); return activeView; },
    getMostRecentLeaf() { assert.equal(prohibitContextRead, false); return recentLeaf; },
    onLayoutReady(fn) { fn(); }
  }, hotkeyManager: { addDefaultHotkeys() {} } };
  const registry = { commands: {}, editorCommands: {}, app, trigger() {},
    addCommand(command) {
      // Mock the relevant native availability behavior; installed-source test below.
      if (command.editorCallback) command.checkCallback = checking => {
        const current = app.workspace.activeEditor;
        if (!current) return null;
        if (current.getMode() === 'preview') return undefined;
        if (!checking) command.editorCallback(current.editor, current);
        return true;
      };
      this.commands[command.id] = command;
    },
    listCommands() { return Object.values(this.commands).filter(c => !c.checkCallback || c.checkCallback(true)); }
  };
  if (options.native) {
    const methods = hostMethods();
    const context = { rd: { isMobile: false }, i5: MarkdownView, activeDocument: { activeElement: { closest: () => null } } };
    registry.addCommand = vm.runInNewContext('(' + methods.add + ')', context);
    registry.listCommands = vm.runInNewContext('(' + methods.list + ')', context);
  }
  app.commands = registry;
  class Plugin {
    app = app;
    addCommand(command) {
      registrations.push(command.id);
      assert.equal(registry.commands[command.id], undefined, 'unique command ID');
      registry.addCommand(command);
      this.register(() => delete registry.commands[command.id]);
    }
    register(fn) { cleanups.push(fn); }
    registerEditorExtension() { events.push('decoration'); if (options.failDecoration) throw Error('decoration failed'); }
    registerObsidianProtocolHandler() { events.push('protocol'); if (options.failProtocol) throw Error('protocol failed'); }
  }
  const obsidian = { Plugin, MarkdownView, Notice: class { constructor(message) { notices.push(message); } },
    Modal: class { constructor() { assert.fail('removal confirmation must not be constructed during startup'); } }
  };
  const context = { module: { exports: {} }, console: { error: (...args) => errors.push(args) }, require(name) {
    if (name === 'obsidian') return obsidian;
    if (name === './editor-command') return loadEditorCommand(obsidian);
    if (name === './remove-location-command') return loadRemovalCommand(obsidian);
    if (name === './protocol-navigation') return loadNavigation(obsidian);
    if (name.startsWith('./')) return require('../src/' + name.slice(2));
    return require(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve(options.bundle ? '../main.js' : '../src/main.js'), 'utf8'), context);
  const plugin = new context.module.exports();
  await plugin.onload();
  prohibitContextRead = false;
  return { plugin, registry, view, notices, registrations, events, errors,
    set active(value) { activeView = value; }, set recent(value) { recentLeaf = value; },
    visible: () => Array.from(registry.listCommands(), c => c.id),
    unload() { cleanups.reverse().forEach(fn => fn()); }
  };
}

for (const bundle of [false, true]) {
  test(`${bundle ? 'bundle' : 'source'}: all six unique commands register during onload without an editor`, async () => {
    const env = await setup({ bundle });
    assert.deepEqual(env.registrations.sort(), Object.keys(expected).sort());
    for (const [id, name] of Object.entries(expected)) {
      const command = env.registry.commands[id];
      assert.equal(command.name, name);
      assert.equal(typeof command.callback, 'function');
      for (const property of ['editorCallback', 'editorCheckCallback', 'checkCallback']) assert.equal(command[property], undefined);
    }
    assert.equal(env.visible().length, 6);
    assert.deepEqual(env.errors, []);
    env.unload();
    assert.equal(env.visible().length, 0, 'normal unload disposes commands');
  });
  for (const failure of ['failDecoration', 'failProtocol']) {
    test(`${bundle ? 'bundle' : 'source'}: ${failure} does not prevent any command or the other integration`, async () => {
      const env = await setup({ bundle, [failure]: true });
      assert.equal(env.visible().length, 6);
      assert.deepEqual(env.events, ['decoration', 'protocol']);
      assert.equal(env.errors.length, 1);
      assert.equal(env.notices.length, 1);
    });
  }
  test(`${bundle ? 'bundle' : 'source'}: absent/reading/non-Markdown contexts remain discoverable and fail gracefully`, async () => {
    const env = await setup({ bundle });
    for (const recent of [null, { view: {}, isVisible: () => true }, { view: env.view, isVisible: () => false }]) {
      env.recent = recent;
      assert.equal(env.visible().length, 6);
      for (const command of Object.values(env.registry.commands)) await command.callback();
    }
    env.active = env.view; env.view.mode = 'preview';
    for (const command of Object.values(env.registry.commands)) await command.callback();
    assert.equal(env.visible().length, 6);
    assert.equal(env.notices.length, 24);
  });
  test(`${bundle ? 'bundle' : 'source'}: sidebar/palette focus resolves the most recent visible main Markdown editor`, async () => {
    const env = await setup({ bundle });
    env.recent = { view: env.view, isVisible: () => true };
    const calls = [];
    env.plugin.copyLocationLink = (editor, view) => calls.push([editor, view]);
    await env.registry.commands['copy-external-link-to-current-location'].callback();
    assert.deepEqual(calls, [[env.view.editor, env.view]]);
    assert.deepEqual(env.notices, []);
  });
}

test('active Markdown view takes precedence over another recent note; selection is checked only on invocation', async () => {
  const env = await setup();
  env.active = env.view;
  env.recent = { get view() { assert.fail('must not use another note'); }, isVisible: () => true };
  let selections = 0;
  env.view.editor.getSelection = () => { selections++; return ''; };
  assert.equal(env.visible().length, 6); assert.equal(selections, 0);
  await env.registry.commands['replace-square-brackets-in-selection'].callback();
  assert.equal(selections, 1); assert.equal(env.notices.at(-1), 'No text selected.');
});

test('installed Obsidian filters original editorCallback commands when activeEditor disappears, while fixed commands stay visible', {
  skip: !process.env.OBSIDIAN_ASAR
}, async () => {
  const env = await setup({ bundle: true, native: true });
  env.registry.addCommand({ id: 'original-shape', editorCallback() { assert.fail('enumeration is read-only'); } });
  env.active = env.view;
  assert.equal(env.registry.commands['original-shape'].checkCallback(true), true);
  assert.equal(env.visible().length, 7);
  env.active = null; // Search sidebar is active even though a source note is visible.
  assert.equal(env.registry.commands['original-shape'].checkCallback(true), null);
  assert.deepEqual(env.visible().sort(), Object.keys(expected).sort());
});
