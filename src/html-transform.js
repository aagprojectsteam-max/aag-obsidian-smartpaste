const SAFE_TAGS = new Set([
  "a", "blockquote", "br", "code", "del", "div", "em", "h1", "h2", "h3",
  "h4", "h5", "h6", "hr", "i", "li", "ol", "p", "pre", "s", "small",
  "span", "strong", "table", "tbody", "td", "tfoot", "th", "thead", "tr",
  "u", "ul"
]);
const DROP_TAGS = new Set([
  "base", "button", "embed", "form", "iframe", "input", "link", "meta",
  "object", "option", "script", "select", "style", "textarea"
]);
const BLOCK_TAGS = [
  "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li",
  "ol", "p", "pre", "table", "tr", "ul"
];

function fixSquareBrackets(text) {
  return String(text).replace(/\[/g, "(").replace(/\]/g, ")");
}
function normalizeInlineSpaces(text) {
  return String(text).replace(/[ \t]+/g, " ").replace(/\s+\{/g, " {")
    .replace(/\}\s+/g, "} ").replace(/\{\s+/g, "{").replace(/\s+\}/g, "}")
    .replace(/ {2,}/g, " ").trim();
}
function safeStyle(styleText) {
  const declarations = [];
  for (const raw of String(styleText || "").split(";")) {
    const index = raw.indexOf(":");
    if (index < 0) continue;
    const property = raw.slice(0, index).trim().toLowerCase();
    const value = raw.slice(index + 1).trim().toLowerCase();
    if (property === "font-size" &&
        /^(?:\d+(?:\.\d+)?(?:px|pt|em|rem|%)|small|smaller|medium|large|larger|x-small|x-large|xx-small|xx-large)$/.test(value)) {
      declarations.push("font-size:" + value);
    } else if (property === "text-align" && /^(?:left|right|center|justify|start|end)$/.test(value)) {
      declarations.push("text-align:" + value);
    } else if (property === "direction" && /^(?:rtl|ltr)$/.test(value)) {
      declarations.push("direction:" + value);
    }
  }
  return declarations.join("; ");
}
function sanitizeTree(doc, { preserveFormattingStyle = false } = {}) {
  for (const el of Array.from(doc.body.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) { el.remove(); continue; }
    if (!SAFE_TAGS.has(tag)) { el.replaceWith(...Array.from(el.childNodes)); continue; }
    const style = preserveFormattingStyle ? safeStyle(el.getAttribute("style")) : "";
    for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    if (style) el.setAttribute("style", style);
  }
}
function replaceTag(doc, selector, tagName) {
  for (const oldEl of Array.from(doc.body.querySelectorAll(selector))) {
    const replacement = doc.createElement(tagName);
    const style = oldEl.getAttribute("style");
    if (style) replacement.setAttribute("style", style);
    while (oldEl.firstChild) replacement.appendChild(oldEl.firstChild);
    oldEl.replaceWith(replacement);
  }
}
function ownedHtml(doc) {
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("class", "aag-smart-paste-html");
  while (doc.body.firstChild) wrapper.appendChild(doc.body.firstChild);
  return wrapper.outerHTML;
}
function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeTree(doc, { preserveFormattingStyle: true });
  replaceTag(doc, "p", "div");
  replaceTag(doc, "b", "strong");
  return fixSquareBrackets(ownedHtml(doc).trim());
}
function plainTextPreservingBlocks(root) {
  const clone = root.cloneNode(true);
  const doc = clone.ownerDocument;
  for (const br of Array.from(clone.querySelectorAll("br"))) br.replaceWith(doc.createTextNode("\n"));
  for (const el of Array.from(clone.querySelectorAll(BLOCK_TAGS.join(",")))) {
    el.before(doc.createTextNode("\n"));
    el.after(doc.createTextNode("\n"));
  }
  return (clone.textContent || "").split(/\r?\n/).map(normalizeInlineSpaces).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
function smallToBraces(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeTree(doc);
  for (const small of Array.from(doc.body.querySelectorAll("small"))) {
    const text = fixSquareBrackets((small.textContent || "").trim());
    small.replaceWith(doc.createTextNode(" {" + text + "} "));
  }
  return fixSquareBrackets(plainTextPreservingBlocks(doc.body));
}
function smallToColors(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitizeTree(doc);
  for (const small of Array.from(doc.body.querySelectorAll("small"))) {
    const span = doc.createElement("span");
    span.setAttribute("style", "color:#2563eb;");
    span.textContent = fixSquareBrackets(small.textContent || "");
    small.replaceWith(span);
  }
  return fixSquareBrackets(ownedHtml(doc).trim());
}
module.exports = { cleanHtml, smallToBraces, smallToColors, safeStyle, plainTextPreservingBlocks };
