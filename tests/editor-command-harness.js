const fs = require('node:fs');
const vm = require('node:vm');

function loadEditorCommand(obsidian) {
  const context = { module: { exports: {} }, require(name) {
    if (name === 'obsidian') return obsidian;
    throw new Error(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/editor-command'), 'utf8'), context);
  return context.module.exports;
}

module.exports = { loadEditorCommand };
