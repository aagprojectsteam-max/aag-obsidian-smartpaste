const MarkdownIt = require("markdown-it");
const { buildBlockUri } = require("./protocol-target");

// Parse the live editor snapshot, never asynchronously cached section offsets.
const markdown = new MarkdownIt({ html: true });
const BLOCK_ID = /^[A-Za-z0-9-]+$/;
const STANDALONE_ID = /^ {0,3}\^([A-Za-z0-9-]+)$/;

class LocationLinkError extends Error {}

function unsupported() {
  throw new LocationLinkError("לא ניתן ליצור קישור בטוח במיקום הזה. יש לבחור פסקה או פריט רשימה רגיל.");
}

function createBlockId(text, random = () => {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}) {
  // Reserve even ID-like text in code/references, so no existing ID is duplicated.
  const used = new Set(Array.from(text.matchAll(/\^([A-Za-z0-9-]+)/g), (m) => m[1].toLowerCase()));
  for (let attempt = 0; attempt < 32; attempt++) {
    const id = "smartpasteblockID-" + random();
    if (BLOCK_ID.test(id) && !used.has(id.toLowerCase())) return id;
  }
  throw new LocationLinkError("לא ניתן ליצור מזהה ייחודי. יש לנסות שוב.");
}

function parseBlocks(text) {
  // Parsing views may omit CR; edits always address the untouched input.
  const lines = text.split(/\r?\n/);
  const protectedLines = new Set();
  // Obsidian-specific constructs that the CommonMark parser does not recognize.
  let yaml = lines[0]?.replace(/^\uFEFF/, "").trim() === "---";
  let comment = false;
  let math = false;
  const htmlTags = [];
  const tokens = markdown.parse(text, {});
  const opaque = tokens.filter((t) => ["fence", "code_block", "html_block"].includes(t.type));
  for (let line = 0; line < lines.length; line++) {
    const value = lines[line];
    if (yaml) {
      protectedLines.add(line);
      if (line > 0 && /^(---|\.\.\.)\s*$/.test(value)) yaml = false;
      continue;
    }
    if (opaque.some((t) => t.type !== "html_block" && t.map[0] <= line && line < t.map[1])) continue;
    if (htmlTags.length) protectedLines.add(line);
    for (const tag of value.matchAll(/<\/?([A-Za-z][\w-]*)\b[^>]*>/g)) {
      protectedLines.add(line);
      const name = tag[1].toLowerCase();
      if (tag[0].startsWith("</")) {
        const index = htmlTags.lastIndexOf(name);
        if (index !== -1) htmlTags.splice(index);
      } else if (!/\/>$/.test(tag[0]) && !/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(name)) {
        htmlTags.push(name);
      }
    }
    if (opaque.some((t) => t.map[0] <= line && line < t.map[1])) continue;
    const unescaped = (pattern) => Array.from(value.matchAll(pattern)).filter((match) => {
      let backslashes = 0;
      for (let index = match.index - 1; index >= 0 && value[index] === "\\"; index--) backslashes++;
      return backslashes % 2 === 0;
    });
    const comments = unescaped(/%%/g);
    const maths = unescaped(/\$\$/g);
    if (comment || math || comments.length || maths.length) protectedLines.add(line);
    if (comments.length % 2) comment = !comment;
    if (maths.length % 2) math = !math;
  }

  const blocks = [];
  const stack = [];
  for (const token of tokens) {
    if (token.nesting === -1) {
      stack.pop();
      continue;
    }
    const mappedParent = token.type === "inline" ? stack.slice().reverse().find((parent) => parent.map) : null;
    const map = token.map || mappedParent?.map;
    if (map && token.block) {
      let end = map[1];
      while (end > map[0] + 1 && !lines[end - 1].trim()) end--;
      blocks.push({ token, parents: stack.slice(), start: map[0], end });
    }
    if (token.nesting === 1) stack.push(token);
  }
  return { lines, blocks, protectedLines };
}

function standaloneAfter(lines, end) {
  let line = end;
  while (line < lines.length && !lines[line].trim()) line++;
  const match = lines[line]?.match(STANDALONE_ID);
  if (line > end && match && (!lines[line + 1] || !lines[line + 1].trim())) {
    return { id: match[1], line };
  }
  return null;
}

function hasUnknownSyntax(value, allowNativeId = false) {
  // Recognized native references are preserved, not rewritten. Everything else
  // resembling attributes, metadata, directives, or foreign anchors is opaque.
  const nativeText = (allowNativeId ? value.replace(/(?:^|\s)\^[A-Za-z0-9-]+$/, "") : value)
    .replace(/!?\[\[[^\]\n]+\]\]/g, "")
    .replace(/^\[![A-Za-z0-9_-]+\][+-]?(?=\s|$)/, "")
    .replace(/^\[[ xX]\](?=\s|$)/, "")
    .replace(/\{([^{}]+)\}/gu, (span, content, offset, source) => {
      // Literal braced prose is ordinary Markdown text (and is also produced by
      // Paste Small Text As Braces). Inspect only; never rewrite the note.
      // Require preceding prose, balanced nonnested braces, multiple words,
      // ordinary punctuation, and no assignment / template / attribute shapes.
      const prefix = source.slice(0, offset);
      const words = content.trim().split(/\s+/u).filter((word) => /\p{L}/u.test(word));
      const proseOnly = /^[\p{L}\p{M}\p{N}\s.,;:!?'"“”‘’״׳()־–—-]+$/u.test(content);
      const assignment = /^\s*[\p{L}\p{N}_-]+\s*[:=]\s*\S/u.test(content) ||
        /[A-Za-z_][A-Za-z0-9_.-]*\s*[:=]\s*\S/u.test(content);
      return /\p{L}/u.test(prefix) && words.length >= 2 && proseOnly && !assignment ? "" : span;
    });
  return /[<>{}\[\]\\^$⟦⟧]|::|%%|(?:^|\s)[@~]/.test(nativeText);
}

function assertSafeInsertion(lines, blocks, target) {
  for (const block of blocks) {
    if (block.token.type !== "inline" || block.start >= target.end || block.end <= target.start) continue;
    let textRun = "";
    const checkText = () => {
      if (hasUnknownSyntax(textRun)) unsupported();
      textRun = "";
    };
    for (const child of block.token.children || []) {
      if (child.type === "text") textRun += child.content;
      else if (child.type === "softbreak" || child.type === "hardbreak") textRun += "\n";
      else {
        checkText();
        if (child.type === "html_inline") unsupported();
      }
    }
    checkText();
  }
  // Comments/directives on adjacent nonblank lines may own the block boundary.
  for (const direction of [-1, 1]) {
    let line = direction < 0 ? target.start - 1 : target.end;
    while (line >= 0 && line < lines.length && !lines[line].trim()) line += direction;
    if (line >= 0 && line < lines.length && hasUnknownSyntax(lines[line], true)) unsupported();
  }
}

function resolveLocation(text, cursor, random, existingOnly = false) {
  const { lines, blocks, protectedLines } = parseBlocks(text);
  if (!Number.isInteger(cursor.line) || !lines[cursor.line]?.trim()) unsupported();
  const covers = (b) => b.start <= cursor.line && cursor.line < b.end;
  const containing = blocks.filter(covers);
  if (protectedLines.has(cursor.line) || containing.some((b) =>
    ["fence", "code_block", "html_block", "heading_open"].includes(b.token.type))) unsupported();

  // A quotation/callout/table is addressed as a whole, outside its syntax.
  let target = containing.find((b) =>
    ["blockquote_open", "table_open"].includes(b.token.type) && b.parents.length === 0);
  let structured = Boolean(target);
  if (!target) {
    target = containing.find((b) => b.token.type === "paragraph_open");
    if (!target) unsupported();
    // Never append into table cells, nested quotations, or extension containers.
    if (target.parents.some((p) => !["bullet_list_open", "ordered_list_open", "list_item_open"].includes(p.type))) unsupported();
    const items = target.parents.filter((p) => p.type === "list_item_open");
    const item = items[items.length - 1];
    // Multi-paragraph list items need a more involved insertion strategy.
    if (item && (target.start !== item.map[0] || blocks.filter((b) =>
      b.token.type === "paragraph_open" && b.parents[b.parents.length - 1] === item).length !== 1)) unsupported();
  }

  // Invoking on a standalone identifier addresses the block preceding it.
  if (target.end === target.start + 1 && STANDALONE_ID.test(lines[target.start])) {
    const previousBlocks = blocks.filter((b) => b.parents.length === 0 &&
      ["paragraph_open", "blockquote_open", "table_open", "bullet_list_open", "ordered_list_open"].includes(b.token.type) &&
      standaloneAfter(lines, b.end)?.line === target.start);
    const previous = previousBlocks[previousBlocks.length - 1];
    if (!previous) unsupported();
    target = previous;
    structured = target.token.type !== "paragraph_open";
  }

  for (let line = target.start; line < target.end; line++) {
    if (protectedLines.has(line)) unsupported();
  }
  const source = lines.slice(target.start, target.end).join("\n");
  if (structured && blocks.some((b) => ["fence", "code_block", "html_block"].includes(b.token.type) &&
    b.start < target.end && b.end > target.start)) unsupported();
  // An unclosed HTML comment cannot prove ownership of a trailing ID.
  if ((source.match(/<!--/g) || []).length !== (source.match(/-->/g) || []).length || /\[\^[^\]]+\]:/.test(source)) unsupported();

  const standalone = target.parents.length === 0 ? standaloneAfter(lines, target.end) : null;
  const inlineMatch = source.match(/(?:^|\s)\^([A-Za-z0-9-]+)$/);
  const inlineIds = inlineMatch ? [inlineMatch[1]] : [];
  const existingIds = [...inlineIds, ...(standalone ? [standalone.id] : [])];
  if (existingIds.length > 1) {
    throw new LocationLinkError("לבלוק יש מספר מזהים. יש להשאיר מזהה יחיד לפני ההעתקה.");
  }
  if (existingIds.length) {
    const id = existingIds[0];
    const definitions = Array.from(text.matchAll(/(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*\r?$/gm), (m) => m[1]);
    if (definitions.filter((value) => value.toLowerCase() === id.toLowerCase()).length !== 1) {
      throw new LocationLinkError("מזהה הבלוק מופיע יותר מפעם אחת בפתק. יש לתקן את הכפילות.");
    }
    return { id, edit: null, structured };
  }

  if (existingOnly) return null;
  assertSafeInsertion(lines, blocks, target);
  // A single newline style can be preserved exactly; ambiguous styles abort.
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  if (/\r(?!\n)/.test(text) || (newline === "\r\n" && /(^|[^\r])\n/.test(text))) unsupported();
  const id = createBlockId(text, random);
  const line = target.end - 1;
  const trailingWhitespace = lines[line] !== lines[line].trimEnd();
  if (trailingWhitespace && target.parents.length) unsupported();
  if (structured || trailingWhitespace) {
    // Reuse existing separation after the block. EOF needs no extra blank line.
    const separator = target.end < lines.length && lines[target.end].trim() ? newline : "";
    return { id, structured, edit: {
      from: { line, ch: lines[line].length },
      text: `${newline}${newline}^${id}${separator}`
    } };
  }
  const trimmed = lines[line].trimEnd();
  if (!trimmed || /\\$/.test(trimmed) || /^\s*(?:[-+*]|\d+[.)])\s*(?:\[[ xX]\])?\s*$/.test(trimmed)) unsupported();
  return { id, structured, edit: { from: { line, ch: trimmed.length }, text: " ^" + id } };
}

function planLocationLink(text, cursor, random) {
  return resolveLocation(text, cursor, random);
}

function findExistingLocationAnchor(text, cursor) {
  return resolveLocation(text, cursor, undefined, true);
}

module.exports = { LocationLinkError, buildBlockUri, createBlockId, planLocationLink, findExistingLocationAnchor };
