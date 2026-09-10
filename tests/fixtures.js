const supported = [
  { name: "paragraph", text: "First line\nSecond line", line: 0, start: 0 },
  { name: "Hebrew", text: "פסקה בעברית עם סימני פיסוק: שו\"ע יו\"ד.", line: 0, start: 0 },
  { name: "adjacent heading", text: "# Heading\nParagraph\n## Next", line: 1, start: 1 },
  { name: "bullet item", text: "- First\n- Second", line: 1, start: 1 },
  { name: "ordered item", text: "1. First\n2. Second", line: 0, start: 0 },
  { name: "task item", text: "- [ ] משימה", line: 0, start: 0 },
  { name: "nested item", text: "- Parent\n  - Child\n  - Sibling", line: 1, start: 1 },
  { name: "parent item", text: "- Parent\n  - Child", line: 0, start: 0 },
  { name: "list-level ID stays separate from item", text: "- First\n- Second\n\n^whole", line: 1, start: 1 },
  { name: "cursor on list-level ID", text: "- First\n- Second\n\n^whole", line: 3, start: 0, id: "whole", structured: true },
  { name: "continued item", text: "- First line\n  continuation\n- Second", line: 1, start: 0 },
  { name: "quote", text: "> First\n> Second", line: 1, start: 0, structured: true },
  { name: "callout", text: "> [!note] כותרת\n> תוכן", line: 1, start: 0, structured: true },
  { name: "table", text: "| A | B |\n| --- | --- |\n| א | ב |", line: 2, start: 0, structured: true },
  { name: "table before heading", text: "| A |\n| --- |\n| B |\n# Next", line: 2, start: 0, structured: true },
  { name: "quote before paragraph", text: "> Quote\n\nFollowing", line: 0, start: 0, structured: true },
  { name: "quote trailing newline", text: "> Quote\n", line: 0, start: 0, structured: true },
  { name: "after code", text: "```js\ncode\n```\n\nParagraph", line: 4, start: 4 },
  { name: "after YAML", text: "---\ntitle: test\n---\n\nParagraph", line: 4, start: 4 },
  { name: "hard break", text: "First  \nSecond  ", line: 0, start: 0 },
  { name: "trailing whitespace", text: "Text \t", line: 0, start: 0 },
  { name: "inline code", text: "Text `code` here", line: 0, start: 0 },
  { name: "inline existing", text: "Text ^Keep-123", line: 0, start: 0, id: "Keep-123" },
  { name: "continued existing", text: "First\nSecond ^keep", line: 0, start: 0, id: "keep" },
  { name: "ID on next line", text: "First\n^keep", line: 0, start: 0, id: "keep" },
  { name: "standalone existing", text: "Text\n\n^keep\n", line: 0, start: 0, id: "keep" },
  { name: "cursor on standalone", text: "Text\n\n^keep\n", line: 2, start: 0, id: "keep" },
  { name: "quote existing", text: "> Quote\n\n^keep", line: 0, start: 0, id: "keep", structured: true },
  { name: "quote inline existing", text: "> Quote ^keep", line: 0, start: 0, id: "keep", structured: true },
  { name: "table existing", text: "| A |\n| --- |\n| B |\n\n^keep", line: 2, start: 0, id: "keep", structured: true },
  { name: "nested existing", text: "- Parent\n  - Child ^keep", line: 1, start: 1, id: "keep" },
  { name: "ID in inline code", text: "Text `^fake`", line: 0, start: 0 },
  { name: "inline link", text: "Text [[note]] and [label](https://example.com)", line: 0, start: 0 }
];

const unsupported = [
  { name: "invalid ID with trailing space", text: "Text ^fake ", line: 0 },
  { name: "ID-like marker mid paragraph", text: "First ^fake\nSecond", line: 0 },
  { name: "escaped marker", text: "Text \\^fake", line: 0 },
  { name: "empty note", text: "", line: 0 },
  { name: "blank line", text: "First\n\nSecond", line: 1 },
  { name: "empty item", text: "- ", line: 0 },
  { name: "empty task", text: "- [ ] ", line: 0 },
  { name: "heading", text: "# Title", line: 0 },
  { name: "setext heading", text: "Title\n=====", line: 0 },
  { name: "fenced code", text: "```js\ncode\n```", line: 1 },
  { name: "unclosed fence", text: "```\ncode\n\nmore", line: 3 },
  { name: "tilde fence", text: "~~~\ncode\n~~~", line: 1 },
  { name: "indented code", text: "    code", line: 0 },
  { name: "nested fence", text: "- Item\n  ```\n  code\n  ```", line: 2 },
  { name: "quote fence", text: "> ```\n> code\n> ```", line: 1 },
  { name: "quote containing code", text: "> Text\n> ```\n> code\n> ```", line: 0 },
  { name: "YAML", text: "---\ntitle: x\n---", line: 1 },
  { name: "unclosed YAML", text: "---\ntitle: x\n\nbody", line: 3 },
  { name: "HTML", text: "<div>\n\ntext\n</div>", line: 2 },
  { name: "inline HTML", text: "text <span>span</span>", line: 0 },
  { name: "unclosed HTML", text: "<div>\n\ntext", line: 2 },
  { name: "inline HTML across paragraphs", text: "Text <span>\n\ntext\n</span>", line: 2 },
  { name: "HTML comment", text: "<!--\n\ntext\n-->", line: 2 },
  { name: "Obsidian comment", text: "%%\n\nhidden\n%%", line: 2 },
  { name: "math", text: "$$\nx + y\n$$", line: 1 },
  { name: "math blank line", text: "$$\n\nx\n$$", line: 2 },
  { name: "footnote", text: "[^1]: Text", line: 0 },
  { name: "multi paragraph item", text: "- First\n\n  Second", line: 2 },
  { name: "list trailing whitespace", text: "- Item  ", line: 0 },
  { name: "nested quote", text: "- Item\n  > Quote", line: 1 },
  { name: "thematic break", text: "---", line: 0 },
  { name: "backslash break", text: "Text\\", line: 0 },
  { name: "orphan ID", text: "^orphan", line: 0 }
];

function applyPlan(text, plan) {
  if (!plan.edit) return text;
  const { line, ch } = plan.edit.from;
  const offset = text.split("\n").slice(0, line).reduce((total, value) => total + value.length + 1, 0) + ch;
  return text.slice(0, offset) + plan.edit.text + text.slice(offset);
}

module.exports = { supported, unsupported, applyPlan };
