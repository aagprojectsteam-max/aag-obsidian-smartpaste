const { MarkdownView, TFile, Notice } = require("obsidian");
const { PROTOCOL_ACTION, NavigationError, parseProtocolTarget } = require("./protocol-target");
const { clearTargetNavigationHighlight } = require("./navigation-highlight");

// Enable only for a deliberate local diagnostic build. No default console noise.
const DEBUG = false;
function debug(stage, detail = {}) {
  if (DEBUG) console.debug("AAG Smart Paste protocol:", stage, detail);
}

function cachedBlock(app, file, id) {
  const blocks = app.metadataCache.getFileCache(file)?.blocks;
  const matches = Object.entries(blocks || {}).filter(([key]) => key.toLowerCase() === id.toLowerCase());
  debug("block-lookup", { id, matches: matches.length });
  if (matches.length !== 1 || matches[0][1]?.id?.toLowerCase() !== id.toLowerCase()) {
    throw new NavigationError("מזהה הבלוק לא נמצא במטא־דאטה. אם הפתק נערך כעת, יש להמתין לאינדוקס ולנסות שוב.");
  }
  return matches[0][1];
}

function contentColumn(text, from) {
  let ch = from;
  // Structural prefixes are skipped only at the cached logical block start.
  let quote;
  while ((quote = /^[ \t]*>[ \t]*/.exec(text.slice(ch)))) ch += quote[0].length;
  const quoted = ch > from;
  const quoteEnd = ch;
  const list = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\](?:[ \t]+|$))?/.exec(text.slice(ch));
  if (list) ch += list[0].length;
  const heading = /^#{1,6}[ \t]+/.exec(text.slice(ch));
  if (heading) ch += heading[0].length;
  return { ch, quoted, quoteEnd };
}

function editableBlockStart(block, editor) {
  const { start, end } = block.position;
  const sourceStart = { line: start.line, ch: start.col };
  const hasContent = text => text.trim() && text.trim().toLowerCase() !== "^" + block.id.toLowerCase();
  const text = editor.getLine(start.line);
  const first = contentColumn(text, start.col);
  if (first.quoted && /^\[![^\]]+\][+-]?(?:[ \t]|$)/.test(text.slice(first.quoteEnd))) {
    // A callout's first line describes its type/title. Prefer its actual body.
    for (let line = start.line + 1; line <= end.line; line++) {
      const body = editor.getLine(line);
      const content = contentColumn(body, 0);
      if (!content.quoted) break;
      if (hasContent(body.slice(content.ch))) return { line, ch: content.ch };
    }
    return sourceStart;
  }
  return hasContent(text.slice(first.ch)) ? { line: start.line, ch: first.ch } : sourceStart;
}

function blockCursor(block, editor, id) {
  const start = block.position?.start;
  const end = block.position?.end;
  for (const pos of [start, end]) {
    if (!pos || !Number.isInteger(pos.line) || !Number.isInteger(pos.col) ||
        pos.line < 0 || pos.line >= editor.lineCount() ||
        pos.col < 0 || pos.col > editor.getLine(pos.line).length) {
      throw new NavigationError("מיקום הבלוק אינו עדכני. יש להמתין לאינדוקס ולנסות שוב.");
    }
  }
  if (start.line > end.line || (start.line === end.line && start.col > end.col)) {
    throw new NavigationError("מיקום הבלוק אינו תקין.");
  }
  // Check only the cached block end / adjacent standalone marker, not the file.
  const last = editor.getLine(end.line);
  let found = new RegExp(`(?:^|[\\t ])\\^${id}$`, "i").test(last.slice(0, end.col)) && !last.slice(end.col).trim();
  if (!found && !last.slice(end.col).trim()) {
    for (let line = end.line + 1; line < editor.lineCount(); line++) {
      const text = editor.getLine(line).trim();
      if (!text) continue;
      found = text.toLowerCase() === "^" + id.toLowerCase();
      break;
    }
  }
  if (!found) throw new NavigationError("תוכן הפתק אינו תואם למיקום הבלוק שבמטא־דאטה. יש להמתין לשמירה ולאינדוקס ולנסות שוב.");
  return editableBlockStart(block, editor);
}

async function navigateToBlock(app, target, cancelled = () => false) {
  if (cancelled()) return;
  target = parseProtocolTarget({ action: PROTOCOL_ACTION, ...target }, app.vault.getName());
  const file = app.vault.getAbstractFileByPath(target.file);
  debug("file-lookup", { path: target.file, found: file instanceof TFile });
  if (!(file instanceof TFile) || file.extension !== "md" || file.path !== target.file) {
    throw new NavigationError("הפתק המבוקש לא נמצא בכספת.");
  }
  // A just-saved marker can precede Obsidian's metadata update. A bounded
  // wait keeps that location intact; an unknown block still fails explicitly.
  for (let attempt = 0; ; attempt++) {
    if (cancelled()) return;
    try { cachedBlock(app, file, target.block); break; }
    catch (error) {
      if (!(error instanceof NavigationError) || attempt === 50) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  const workspace = app.workspace;
  let leaf = workspace.getLeavesOfType("markdown").find(leaf =>
    leaf.view instanceof MarkdownView && leaf.view.file === file) || workspace.getLeaf(false);
  // No subpath, line, startLoc/endLoc, or match: these trigger native highlighting.
  await leaf.openFile(file, { active: true, state: { mode: "source" }, eState: {} });
  debug("file-opened", { path: target.file });
  if (cancelled()) return;
  // Existing tab-management plugins may redirect openFile to another leaf.
  // Follow only a Markdown view holding the exact requested TFile; revealing
  // the original leaf would reactivate its previous note and lose the target.
  if (!(leaf.view instanceof MarkdownView) || leaf.view.file !== file) {
    const opened = workspace.getLeavesOfType("markdown").filter(candidate =>
      candidate.view instanceof MarkdownView && candidate.view.file === file);
    leaf = opened.find(candidate => candidate === workspace.activeLeaf) || opened[0] || leaf;
  }
  await workspace.revealLeaf(leaf);
  if (cancelled()) return;
  // Some installed view integrations resolve openFile/revealLeaf before the
  // target file and editor have finished replacing the previous view content.
  // Wait only for that exact requested view; never navigate the previous file.
  let view, block, cursor;
  let readinessError;
  for (let attempt = 0; attempt < 51; attempt++) {
    if (cancelled()) return;
    view = leaf.view;
    if (view instanceof MarkdownView && view.file === file && file.path === target.file && view.getMode() === "source") {
      try {
        block = cachedBlock(app, file, target.block);
        cursor = blockCursor(block, view.editor, target.block);
        break;
      } catch (error) {
        if (!(error instanceof NavigationError)) throw error;
        readinessError = error;
      }
    } else {
      readinessError = new NavigationError("לא ניתן לפתוח את הפתק המבוקש בעורך Markdown.");
    }
    if (attempt === 50) throw readinessError;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  if (cancelled()) return;
  view.editor.setCursor(cursor);
  view.editor.focus();
  view.editor.scrollIntoView({ from: cursor, to: cursor }, true);
  clearTargetNavigationHighlight(view.editor, block);
  debug("cursor-placed", { cursor });
}

function registerProtocolNavigation(plugin) {
  debug("plugin-onload-registration");
  let disposed = false;
  let releaseReady;
  const ready = new Promise(resolve => { releaseReady = resolve; });
  plugin.app.workspace.onLayoutReady(releaseReady);
  plugin.register(() => { disposed = true; releaseReady(); });
  let pending = Promise.resolve();
  // One awaited navigation API shared by URI dispatch and the coordinated bridge.
  plugin.navigateToLocation = target => {
    try { target = parseProtocolTarget({ action: PROTOCOL_ACTION, ...target }, plugin.app.vault.getName()); }
    catch (error) { return Promise.reject(error); }
    const request = pending.then(async () => {
      await ready;
      if (disposed) throw new NavigationError("SmartPaste is unloaded.");
      await navigateToBlock(plugin.app, target, () => disposed);
      if (disposed) throw new NavigationError("SmartPaste is unloaded.");
    });
    pending = request.catch(() => {});
    return request;
  };
  plugin.registerObsidianProtocolHandler(PROTOCOL_ACTION, params => {
    if (disposed) return Promise.resolve();
    let target;
    try { target = parseProtocolTarget(params, plugin.app.vault.getName()); }
    catch (error) { new Notice(error.message); return Promise.resolve(); }
    return plugin.navigateToLocation(target).catch(error => {
      if (!disposed) new Notice(error instanceof NavigationError ? error.message : "לא ניתן לנווט אל הפתק. יש לנסות שוב.");
    });
  });
  debug("handler-registered", { action: PROTOCOL_ACTION });
}

module.exports = { registerProtocolNavigation, navigateToBlock, blockCursor };
