const test = require("node:test");
const assert = require("node:assert/strict");
const { planLocationLink, LocationLinkError } = require("../src/location-links");
const { applyPlan } = require("./fixtures");
const fixtures = require("./gui-regression-fixtures");

for (const fixture of fixtures) {
  test(`GUI classifier regression: ${fixture.name}`, () => {
    const cursor = { line: fixture.line, ch: fixture.ch };
    const plan = planLocationLink(fixture.text, cursor, () => "9876543210abcdef");
    const result = applyPlan(fixture.text, plan);
    assert.equal(plan.id, fixture.id || "smartpasteblockID-9876543210abcdef");
    if (fixture.id) assert.equal(plan.edit, null);
    else {
      const { from, text } = plan.edit;
      const offset = fixture.text.split("\n").slice(0, from.line).reduce((sum, line) => sum + line.length + 1, 0) + from.ch;
      assert.deepEqual(Buffer.from(result.slice(0, offset) + result.slice(offset + text.length)), Buffer.from(fixture.text));
      const endLine = fixture.name === "multiple logical source lines" ? 4
        : fixture.name === "multiline braced explanation" ? 2 : fixture.line;
      assert.equal(from.line, endLine);
    }
    const repeated = planLocationLink(result, cursor);
    assert.equal(repeated.id, plan.id);
    assert.equal(repeated.edit, null);
  });
}

for (const [name, text, line] of [
  ["brace marker in target", "פסקה עם {plugin-id: 17}", 0],
  ["standalone brace marker before target", "{plugin-start}\n\nפסקה רגילה", 2],
  ["standalone brace marker after target", "פסקה רגילה\n\n{plugin-end}", 0],
  ["comment boundary", "<!-- plugin:start -->\n\nפסקה רגילה", 2],
  ["directive boundary", ":::plugin\n\nפסקה רגילה", 2],
  ["unbalanced neighboring braces", "פסקה קודמת {plugin-start\n\nפסקה רגילה", 2],
  ["no blank paragraph separation", "פסקה אחרת {סימון}\nפסקה רגילה", 1],
  ["multiword attribute", "פסקה רגילה {plugin-id: two words}", 0],
  ["Hebrew attribute", "פסקה רגילה {מזהה: הערה פרטית}", 0],
  ["custom attribute name", "פסקה רגילה {custom_attr two words}", 0],
  ["template braces", "פסקה רגילה {{שתי מילים בעברית}}", 0],
  ["hyphenated foreign ID", "פסקה רגילה {plugin-id}", 0],
  ["single foreign marker", "פסקה רגילה {custom}", 0],
  ["numeric foreign marker", "פסקה רגילה {plugin 17}", 0],
  ["standalone prose-shaped marker", "{שתי מילים בעברית}\n\nפסקה רגילה", 2]
]) {
  test(`GUI regression safety retained: ${name}`, () => {
    assert.throws(() => planLocationLink(text, { line, ch: 0 }), LocationLinkError);
  });
}
