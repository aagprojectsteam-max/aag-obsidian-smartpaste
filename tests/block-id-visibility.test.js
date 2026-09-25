const test = require("node:test");
const assert = require("node:assert/strict");
const { EditorState, StateField, StateEffect, Compartment } = require("@codemirror/state");
const { EditorView, Decoration } = require("@codemirror/view");
const { Language, defineLanguageFacet, languageDataProp } = require("@codemirror/language");
const { Parser, Tree, NodeType, NodeProp } = require("@lezer/common");
const { createBlockIdVisibilityExtension, isSmartPasteBlockId } = require("../src/block-id-visibility");
const { planLocationLink, buildBlockUri } = require("../src/location-links");
const { applyPlan } = require("./fixtures");

const legacy = "^aag-1234567890abcdef";
const current = "^smartpasteblockID-1234567890abcdef";
const mode = StateEffect.define();
const livePreview = StateField.define({
  create: () => true,
  update: (value, tr) => tr.effects.reduce((v, effect) => effect.is(mode) ? effect.value : v, value)
});

// Explicit semantic fixtures, NOT an imitation Markdown parser. Real CM state,
// syntax trees, replacement ranges, reconfiguration, and facets run below.
function language(tokens, tokenProp) {
  const data = defineLanguageFacet();
  const root = NodeType.define({ id: 0, name: "Document", top: true, props: [[languageDataProp, data]] });
  class FixtureParser extends Parser {
    createParse(input) {
      return {
        parsedPos: 0, stoppedAt: null,
        stopAt(pos) { this.stoppedAt = pos; },
        advance() {
          const text = input.read(0, input.length);
          const found = tokens.map(([token, name = "blockid", classes]) => ({ token, name, classes, from: text.indexOf(token) }))
            .filter(t => t.from >= 0).sort((a, b) => a.from - b.from);
          this.parsedPos = input.length;
          return new Tree(root, found.map((t, i) => new Tree(
            NodeType.define({ id: i + 1, name: t.name, props: tokenProp ? [[tokenProp, t.classes]] : [] }), [], [], t.token.length
          )), found.map(t => t.from), input.length);
        }
      };
    }
  }
  return new Language(data, new FixtureParser());
}

function setup(doc, tokens = [[current]], extra = [], hasMode = true) {
  const field = createBlockIdVisibilityExtension(livePreview);
  const compartment = new Compartment();
  const state = EditorState.create({ doc, extensions: [
    language(tokens), hasMode ? livePreview : [], compartment.of(field), extra
  ] });
  return { state, field, compartment };
}
function ranges(state, field) {
  const result = [];
  state.field(field).decorations.between(0, state.doc.length, (from, to, decoration) => {
    assert.equal(decoration.spec.widget, undefined, "no visible placeholder");
    result.push([from, to]);
  });
  return result;
}
function displayed(state, field) {
  let text = state.doc.toString();
  for (const [from, to] of ranges(state, field).reverse()) text = text.slice(0, from) + text.slice(to);
  return text;
}

for (const token of [legacy, current]) {
  test(`reserved ownership: ${token}`, () => assert.equal(isSmartPasteBlockId(token), true));
  for (const text of ["טקסט הפסקה", "An English paragraph", "טקסט עם English ו־123"]) {
    test(`replacement removes separator and caret: ${text} ${token}`, () => {
      const doc = `${text} ${token}`;
      const { state, field } = setup(doc, [[token, "formatting_blockid"]]);
      assert.equal(displayed(state, field), text);
      assert.equal(state.doc.toString(), doc, "rendering never edits source");
      assert.deepEqual(ranges(state, field), [[text.length, doc.length]]);
    });
  }
  test(`standalone marker collapses without losing surrounding blank line: ${token}`, () => {
    const { state, field } = setup(`> ציטוט\n\n${token}\n\nNext`, [[token]]);
    assert.equal(displayed(state, field), "> ציטוט\n\nNext");
  });
  test(`standalone marker at EOF leaves no blank area: ${token}`, () => {
    const { state, field } = setup(`> Quote\n\n${token}`, [[token]]);
    assert.equal(displayed(state, field), "> Quote");
  });
  test(`reusing ${token} preserves source and external URI across hiding`, () => {
    const doc = `טקסט ${token}`;
    const before = planLocationLink(doc, { line: 0, ch: 0 });
    const { state, field } = setup(doc, [[token]]);
    assert.equal(displayed(state, field), "טקסט");
    const after = planLocationLink(state.doc.toString(), { line: 0, ch: 0 });
    assert.equal(before.edit, null);
    assert.equal(after.edit, null);
    assert.equal(after.id, token.slice(1));
    assert.equal(state.doc.toString(), doc, "no migration of legacy IDs");
    assert.equal(buildBlockUri("AAG Vault", "פתק.md", before.id), buildBlockUri("AAG Vault", "פתק.md", after.id));
  });
}

for (const token of ["^abc123", "^my-user-id", "^sidenotes-1234567890abcdef", "^aag-custom",
  "^smartpasteblockID-custom", "^aag-1234567890abcde", "^smartpasteblockID-1234567890abcdef0",
  "^smartpasteblockID-1234567890abcdeF", "^SMARTPASTEBLOCKID-1234567890abcdef"]) {
  test(`foreign/manual/non-generated native marker stays visible: ${token}`, () => {
    assert.equal(isSmartPasteBlockId(token), false);
    const { state, field } = setup(`Text ${token}`, [[token]]);
    assert.deepEqual(ranges(state, field), []);
  });
}

for (const [doc, kind] of [
  [`\`\`\`\n${current}\n\`\`\``, "code"], [`\`${current}\``, "inline-code"],
  [`<span>${current}</span>`, "html"], [`[[note#${current}]]`, "link"],
  [`Text ${current}`, "text"], [`Text ${current}`, "notblockid"]
]) {
  test(`ID-like text without native blockid semantics stays visible: ${kind}`, () => {
    const { state, field } = setup(doc, [[current, kind]]);
    assert.deepEqual(ranges(state, field), []);
    assert.equal(state.doc.toString(), doc);
  });
}

test("new insertion uses only the new namespace and remains idempotent after rendering", () => {
  const original = "שלום";
  const plan = planLocationLink(original, { line: 0, ch: 0 }, () => "1234567890abcdef");
  assert.equal(plan.id, current.slice(1));
  const doc = applyPlan(original, plan);
  assert.equal(doc, `${original} ${current}`);
  const { state, field } = setup(doc);
  assert.equal(displayed(state, field), original);
  assert.equal(planLocationLink(state.doc.toString(), { line: 0, ch: 0 }).edit, null);
  assert.equal(state.doc.toString(), doc);
});

test("both namespaces in one document are hidden; third-party ID remains visible", () => {
  const doc = `עברית ${legacy}\n\nEnglish ${current}\n\nOther ^sidenotes-123`;
  const { state, field } = setup(doc, [[legacy], [current], ["^sidenotes-123"]]);
  assert.equal(displayed(state, field), "עברית\n\nEnglish\n\nOther ^sidenotes-123");
});

test("Source mode reveals raw IDs and switching back hides them without a document change", () => {
  const { state, field } = setup(`Text ${current}`);
  const tr = state.update({ effects: mode.of(false) });
  assert.equal(tr.docChanged, false);
  assert.equal(displayed(tr.state, field), state.doc.toString());
  const back = tr.state.update({ effects: mode.of(true) });
  assert.equal(back.docChanged, false);
  assert.equal(displayed(back.state, field), "Text");
});

test("missing Live Preview field fails open with raw source visible", () => {
  const { state, field } = setup(`Text ${current}`, [[current]], [], false);
  assert.deepEqual(ranges(state, field), []);
});

test("edits relocate decorations; removing ownership reveals changed text", () => {
  const { state, field } = setup(`Text ${current}`);
  const shifted = state.update({ changes: { from: 0, insert: "עוד " } }).state;
  assert.equal(displayed(shifted, field), "עוד Text");
  const from = shifted.doc.toString().indexOf(current);
  const changed = shifted.update({ changes: { from, to: shifted.doc.length, insert: "^user" } }).state;
  assert.equal(displayed(changed, field), "עוד Text ^user");
});

test("only the generator separator is hidden; other whitespace is preserved", () => {
  const { state, field } = setup(`Text  ${current}`);
  assert.equal(displayed(state, field), "Text ");
});

test("nonterminal token is never hidden", () => {
  const { state, field } = setup(`Text ${current} suffix`);
  assert.deepEqual(ranges(state, field), []);
});

test("atomic cursor ranges match replacement ranges; selection-only transactions keep them stable", () => {
  const { state, field } = setup(`Text ${current}`);
  const provider = state.facet(EditorView.atomicRanges)[0];
  assert.equal(provider({ state }), state.field(field).decorations);
  const tr = state.update({ selection: { anchor: 2 } });
  assert.equal(tr.docChanged, false);
  assert.equal(tr.state.field(field).decorations, state.field(field).decorations);
});

test("extension removal restores text and leaves other plugins' decorations intact", () => {
  const foreign = Decoration.set([Decoration.mark({ class: "third-party-test" }).range(0, 4)]);
  const { state, field, compartment } = setup(`Text ${current}`, [[current]], EditorView.decorations.of(foreign));
  assert.equal(state.facet(EditorView.decorations).includes(foreign), true);
  const tr = state.update({ effects: compartment.reconfigure([]) });
  assert.equal(tr.docChanged, false);
  assert.equal(tr.state.field(field, false), undefined);
  assert.deepEqual(tr.state.facet(EditorView.decorations), [foreign]);
  assert.equal(tr.state.facet(EditorView.atomicRanges).length, 0);
  assert.equal(tr.state.doc.toString(), state.doc.toString());
});

test("syntax-only reconfiguration refreshes semantic recognition without editing Markdown", () => {
  const syntax = new Compartment();
  const field = createBlockIdVisibilityExtension(livePreview);
  const state = EditorState.create({ doc: `Text ${current}`, extensions: [
    livePreview, field, syntax.of(language([[current, "text"]]))
  ] });
  assert.deepEqual(ranges(state, field), []);
  const tr = state.update({ effects: syntax.reconfigure(language([[current]])) });
  assert.equal(tr.docChanged, false);
  assert.equal(displayed(tr.state, field), "Text");
});

test("Obsidian semantic token property takes precedence over node names", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const tokenClassNodeProp = new NodeProp();
  const context = { module: { exports: {} }, require(name) {
    return name === "@codemirror/language"
      ? { ...require(name), tokenClassNodeProp } : require(name);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/block-id-visibility"), "utf8"), context);
  for (const [name, classes, expected] of [
    ["opaque-token-name", "formatting blockid", "Text"],
    ["blockid", "inline-code", `Text ${current}`]
  ]) {
    const field = context.module.exports.createBlockIdVisibilityExtension(livePreview);
    const state = EditorState.create({ doc: `Text ${current}`, extensions: [
      livePreview, field, language([[current, name, classes]], tokenClassNodeProp)
    ] });
    assert.equal(displayed(state, field), expected);
  }
});

test("confirmed removal transaction updates Live Preview decoration and atomic ranges", () => {
  const { planLocationRemoval } = require('../src/location-removal');
  const foreign='^sidenotes-123';
  const doc=`Text ${current}\n\nLegacy ${legacy}\n\nOther ${foreign}`;
  const {state,field}=setup(doc,[[current],[legacy],[foreign]]);
  const edit=planLocationRemoval(doc,{line:0,ch:0});
  assert.equal(ranges(state,field).length,2);
  const tr=state.update({changes:{from:edit.from.ch,to:edit.to.ch,insert:''}});
  assert.equal(tr.docChanged,true);
  assert.equal(ranges(tr.state,field).length,1,'removed ID no longer has a replacement');
  assert.equal(displayed(tr.state,field),`Text\n\nLegacy\n\nOther ${foreign}`);
  assert.equal(tr.state.facet(EditorView.atomicRanges)[0]({state:tr.state}).size,1);
  assert.equal(tr.state.doc.toString(),`Text\n\nLegacy ${legacy}\n\nOther ${foreign}`);
});
