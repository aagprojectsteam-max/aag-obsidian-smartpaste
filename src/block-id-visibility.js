const { StateField } = require("@codemirror/state");
const { Decoration, EditorView } = require("@codemirror/view");
const { syntaxTree, tokenClassNodeProp } = require("@codemirror/language");

// Reserved generator namespace, not a substring/prefix match for arbitrary text.
function isSmartPasteBlockId(token) {
  return /^\^(?:aag|smartpasteblockID)-[0-9a-f]{16}$/.test(token);
}

function isNativeBlockId(node) {
  // Obsidian's stream parser exposes semantic token classes. Its node names
  // encode the same classes with underscores on versions without this prop.
  const classes = tokenClassNodeProp && node.type.prop(tokenClassNodeProp);
  return typeof classes === "string"
    ? classes.split(/\s+/).includes("blockid")
    : node.type.name.split("_").includes("blockid");
}

function hiddenBlockIds(state, tree, livePreview) {
  if (!livePreview) return Decoration.none;
  const doc = state.doc;
  const ranges = [];
  tree.iterate({ enter(node) {
    if (!isNativeBlockId(node)) return;
    const token = doc.sliceString(node.from, node.to);
    if (!isSmartPasteBlockId(token)) return;
    const line = doc.lineAt(node.from);
    if (node.to !== line.to) return;

    let from = node.from;
    let to = node.to;
    if (line.text === token && line.number > 1) {
      const previous = doc.line(line.number - 1);
      const next = line.number < doc.lines ? doc.line(line.number + 1) : null;
      if (!previous.text.trim() && (!next || !next.text.trim())) {
        // Collapse the dedicated ID line without a widget/placeholder. Direct
        // StateField decorations may replace line breaks (ViewPlugins may not).
        from = previous.to;
        to = next ? line.to + 1 : line.to;
        if (!next && !previous.text) from = Math.max(0, previous.from - 1);
      }
    } else if (node.from > line.from && doc.sliceString(node.from - 1, node.from) === " ") {
      // The generator adds one separator space. Leave other whitespace intact.
      from--;
    }
    ranges.push({ from, to });
  } });
  ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  const decorations = [];
  let end = -1;
  for (const range of ranges) {
    if (range.from < end) continue;
    decorations.push(Decoration.replace({ inclusive: false }).range(range.from, range.to));
    end = range.to;
  }
  return Decoration.set(decorations, true);
}

function createBlockIdVisibilityExtension(livePreviewField) {
  const read = (state) => {
    const tree = syntaxTree(state);
    const livePreview = Boolean(livePreviewField && state.field(livePreviewField, false));
    return { tree, livePreview, decorations: hiddenBlockIds(state, tree, livePreview) };
  };
  const field = StateField.define({
    create: read,
    update(previous, transaction) {
      const tree = syntaxTree(transaction.state);
      const livePreview = Boolean(livePreviewField && transaction.state.field(livePreviewField, false));
      return transaction.docChanged || tree !== previous.tree || livePreview !== previous.livePreview
        ? read(transaction.state) : previous;
    },
    provide: (self) => [
      EditorView.decorations.from(self, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(self, false)?.decorations || Decoration.none)
    ]
  });
  return field;
}

module.exports = { createBlockIdVisibilityExtension, isSmartPasteBlockId };
