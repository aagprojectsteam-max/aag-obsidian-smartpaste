// Obsidian's editor retains native navigation marks across cursor/scroll updates.
// Its internal removeHighlights API only accepts a class, not a source range.
// Obtain its native filter effect on an isolated receiver (no host monkey patch),
// then narrow that filter to the validated target. Unknown API shapes fail closed.
function clearTargetNavigationHighlight(editor, block) {
  const cm = editor.cm;
  if (!cm?.state || typeof editor.removeHighlights !== "function" ||
      typeof editor.hasHighlight !== "function") return false;
  try {
    const state = cm.state;
    const { start, end } = block.position;
    const from = state.doc.line(start.line + 1).from + start.col;
    const to = state.doc.line(end.line + 1).from + end.col;
    if (from >= to) return false;
    const captured = [];
    const receiver = {
      cm: { state, dom: cm.dom, dispatch: spec => captured.push(spec) },
      hasHighlight: editor.hasHighlight
    };
    editor.removeHighlights.call(receiver, "is-flashing");
    if (captured.length !== 1 || Object.keys(captured[0]).join() !== "effects") return false;
    const effects = Array.isArray(captured[0].effects) ? captured[0].effects : [captured[0].effects];
    const effect = effects[0];
    if (effects.length !== 1 || typeof effect?.value !== "function" ||
        typeof effect.type?.of !== "function" || cm.state !== state) return false;
    let removed = false;
    const scoped = effect.type.of((a, b, decoration) => {
      if (a !== from || b !== to || decoration?.spec?.class !== "is-flashing") return true;
      const keep = effect.value(a, b, decoration);
      if (keep === false) removed = true;
      return keep;
    });
    const transaction = state.update({ effects: scoped });
    // CodeMirror evaluates StateField updates lazily on first state access.
    const next = transaction.state;
    if (!removed || transaction.docChanged || transaction.selection || next.doc !== state.doc) return false;
    cm.dispatch(transaction);
    return true;
  } catch (_) {
    // Internal host API unavailable/changed: preserve all decorations and text.
    return false;
  }
}

module.exports = { clearTargetNavigationHighlight };
