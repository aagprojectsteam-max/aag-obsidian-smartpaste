const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EditorState, StateField, StateEffect } = require('@codemirror/state');
const { Decoration, EditorView } = require('@codemirror/view');
const { clearTargetNavigationHighlight } = require('../src/navigation-highlight');
const { setup } = require('./protocol-navigation-harness');

function host(native = false) {
  const add = StateEffect.define(), filter = StateEffect.define();
  let field = StateField.define({ create: () => Decoration.none, update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(add)) value = value.update({ add: effect.value, sort: true });
      if (effect.is(filter)) value = value.update({ filter: effect.value });
    }
    return value;
  }});
  const mark = Decoration.mark({ class: 'is-flashing' });
  let hasHighlight = function(name) { const value = this.cm.state.field(field); return value.size > 0; };
  let removeHighlights = function(name) {
    if (this.cm.dom.isShown() && this.hasHighlight(name)) this.cm.dispatch({ effects: filter.of((a,b,value) => value !== mark) });
  };
  if (native) {
    const archive = fs.readFileSync(process.env.OBSIDIAN_ASAR);
    const header = JSON.parse(archive.subarray(16, 16 + archive.readUInt32LE(12)));
    const entry = header.files['app.js'];
    const offset = 8 + archive.readUInt32LE(4) + Number(entry.offset);
    const source = archive.subarray(offset, offset + entry.size).toString();
    const nativeField = source.match(/nO=ke\.define\(\{create:function\(\)\{return nn\.none\}[\s\S]*?provide:function\(e\)\{return Jo\.decorations\.from\(e\)\}\}\)/)?.[0];
    const method = name => source.match(new RegExp('t\\.prototype\\.' + name + '=(function[\\s\\S]*?)(?=,t\\.prototype\\.)'))?.[1];
    assert.ok(nativeField && method('removeHighlights') && method('hasHighlight'), 'installed native contract must be inspected if changed');
    const context = { ke: StateField, nn: Decoration, Jo: EditorView, JL: add, eO: filter, tO: new Map([['is-flashing',mark]]) };
    vm.runInNewContext(nativeField, context);
    field = context.nO;
    hasHighlight = vm.runInNewContext('(' + method('hasHighlight') + ')', context);
    removeHighlights = vm.runInNewContext('(' + method('removeHighlights') + ')', context);
  }
  let state = EditorState.create({ doc: 'Other\n\nטקסט הפסקה', selection: { anchor: 7 }, extensions: [field] });
  const originalState = state;
  let dispatches = 0;
  const cm = { get state() { return state; }, dom: { isShown: () => true }, dispatch(tr) {
    dispatches++;
    state = tr.state || state.update(tr).state;
  }};
  const editor = { cm, hasHighlight, removeHighlights };
  const block = { position: { start: { line: 2, col: 0 }, end: { line: 2, col: 10 } } };
  const addMarks = ranges => { state = state.update({ effects: add.of(ranges) }).state; };
  const ranges = () => { const result=[]; state.field(field).between(0,state.doc.length,(from,to,value)=>result.push([from,to,value])); return result; };
  return { editor, block, mark, addMarks, ranges, originalState, get dispatches() { return dispatches; } };
}

for (const native of [false,true]) test(`target-only native filter, preserves unrelated same-class marks (${native ? 'installed host' : 'mock'})`, { skip: native && !process.env.OBSIDIAN_ASAR }, () => {
  const env = host(native);
  const other = Decoration.mark({ class: 'is-flashing' }); // a different plugin owns this value
  const search = Decoration.mark({ class: 'search-result' });
  env.addMarks([env.mark.range(7,17),env.mark.range(0,5),other.range(7,17),search.range(7,17)]);
  const before = env.ranges().filter(([a,b,v])=>!(a===7 && b===17 && v===env.mark));
  assert.equal(clearTargetNavigationHighlight(env.editor,env.block),true);
  assert.deepEqual(env.ranges(),before);
  assert.equal(env.dispatches,1);
  assert.equal(env.editor.cm.state.doc,env.originalState.doc);
  assert.equal(env.editor.cm.state.selection,env.originalState.selection);
  assert.equal(clearTargetNavigationHighlight(env.editor,env.block),false);
  assert.equal(env.dispatches,1);
  env.addMarks([env.mark.range(7,17)]); // subsequent ordinary/native navigation still works
  assert.ok(env.ranges().some(([a,b,v])=>a===7 && b===17 && v===env.mark));
});

test('cursor/scroll alone retain native visual marking despite collapsed selection', () => {
  const env=host(); env.addMarks([env.mark.range(7,17)]);
  env.editor.cm.dispatch(env.editor.cm.state.update({ selection:{anchor:7}, effects:EditorView.scrollIntoView(7) }));
  assert.equal(env.editor.cm.state.selection.main.empty,true);
  assert.equal(env.ranges().length,1);
});

test('no mark, partial overlap and another block do not cause a cleanup transaction', () => {
  for (const range of [null,[0,5],[6,17],[8,17],[7,16]]) {
    const env=host();if(range)env.addMarks([env.mark.range(...range)]);
    assert.equal(clearTargetNavigationHighlight(env.editor,env.block),false);
    assert.equal(env.dispatches,0);
  }
});

test('absent or changed internal host contract fails closed without edits', () => {
  for (const removeHighlights of [undefined, function(){ throw Error('changed'); }, function(){this.cm.dispatch({changes:{from:0,insert:'bad'}});},function(){this.cm.dispatch({effects:[{},{}]});}]) {
    const env=host();env.addMarks([env.mark.range(7,17)]);env.editor.removeHighlights=removeHighlights;
    assert.equal(clearTargetNavigationHighlight(env.editor,env.block),false);
    assert.equal(env.dispatches,0);assert.equal(env.ranges().length,1);
  }
});

test('navigation opens file only, reveals direct zero-length position, repeated requests stay safe', async () => {
  const env=setup();
  env.leaf.setEphemeralState=()=>assert.fail('no block ephemeral state');
  env.view.setEphemeralState=()=>assert.fail('no block ephemeral state');
  env.app.workspace.openLinkText=()=>assert.fail('no native subpath navigation');
  env.editor.addHighlights=()=>assert.fail('no native flash request');
  for(let n=0;n<3;n++) {
    await env.request();
    assert.equal(env.state.selection.main.empty,true);
    assert.equal(env.editor.getValue(),env.doc);
  }
  for(const call of env.calls) {
    if(call[0]==='open') assert.deepEqual(call[2],{active:true,state:{mode:'source'},eState:{}});
    if(call[0]==='scroll') assert.deepEqual(call.slice(1),[{from:{line:2,ch:0},to:{line:2,ch:0}},true]);
  }
  assert.deepEqual(env.notices,[]);
});
