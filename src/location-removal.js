const { LocationLinkError, findExistingLocationAnchor } = require("./location-links");

function planLocationRemoval(text, cursor) {
  let anchor;
  try {
    anchor = findExistingLocationAnchor(text, cursor);
  } catch (error) {
    if (error instanceof LocationLinkError) return null;
    throw error;
  }
  // The legacy aag namespace is deliberately NOT proof of deletion ownership.
  if (!anchor || !/^smartpasteblockID-[0-9a-f]{16}$/.test(anchor.id)) return null;
  const token = "^" + anchor.id;
  const lines = text.split(/\r?\n/);
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (!value.endsWith(token)) continue;
    const ch = value.length - token.length;
    if (ch && !/[ \t]/.test(value[ch - 1])) continue;
    // The shared resolver has already proved that this definition is unique and
    // belongs to the cursor's block. Delete only its literal source token.
    let from = ch;
    // Only the generator's unambiguous single inline separator can be removed.
    // Preserve indentation, multiple spaces, tabs, hard breaks and all newlines.
    const prefix = value.slice(0, ch - 1);
    const structuralOnly = /^[ \t]*(?:(?:[-+*]|\d+[.)])(?:[ \t]+\[[ xX]\])?|>+|#{1,6})$/.test(prefix);
    if (ch > 1 && value[ch - 1] === " " && !/[\s\\]/u.test(value[ch - 2]) && !structuralOnly) from--;
    return { id: anchor.id, from: { line, ch: from }, to: { line, ch: value.length }, text: "" };
  }
  return null;
}

function mapPositionAfterRemoval(position, edit) {
  if (position.line !== edit.from.line || position.ch <= edit.from.ch) return { ...position };
  return { line: position.line, ch: Math.max(edit.from.ch, position.ch - (edit.to.ch - edit.from.ch)) };
}

module.exports = { planLocationRemoval, mapPositionAfterRemoval };
