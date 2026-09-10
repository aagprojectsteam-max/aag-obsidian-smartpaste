const test = require("node:test");
const assert = require("node:assert/strict");
const { planLocationLink, LocationLinkError } = require("../src/location-links");
const fixtures = require("./compatibility-fixtures");
const { applyPlan } = require("./fixtures");

for (const fixture of fixtures) {
  test(`third-party compatibility: ${fixture.name}`, () => {
    const before = Buffer.from(fixture.text);
    const cursor = { line: fixture.line, ch: 0 };
    if (fixture.abort) {
      for (let invocation = 0; invocation < 2; invocation++) {
        assert.throws(() => planLocationLink(fixture.text, cursor, () => "1234567890abcdef"), LocationLinkError);
        assert.deepEqual(Buffer.from(fixture.text), before);
      }
      return;
    }
    const plan = planLocationLink(fixture.text, cursor, () => "1234567890abcdef");
    const output = applyPlan(fixture.text, plan);
    if (fixture.id) {
      assert.equal(plan.id, fixture.id);
      assert.equal(plan.edit, null);
      assert.deepEqual(Buffer.from(output), before);
    } else {
      assert.ok(plan.edit);
      assert.match(plan.edit.text, /^[\r\n ]*\^smartpasteblockID-[a-f0-9]+[\r\n]*$/);
      const { line, ch } = plan.edit.from;
      const offset = fixture.text.split("\n").slice(0, line).reduce((n, s) => n + s.length + 1, 0) + ch;
      assert.equal(output.slice(0, offset), fixture.text.slice(0, offset));
      assert.equal(output.slice(offset + plan.edit.text.length), fixture.text.slice(offset));
      assert.deepEqual(Buffer.from(output.slice(0, offset) + output.slice(offset + plan.edit.text.length)), before);
      if (fixture.text.includes("\r\n")) assert.doesNotMatch(output, /(^|[^\r])\n/);
    }
    const repeated = planLocationLink(output, cursor);
    assert.equal(repeated.id, plan.id);
    assert.equal(repeated.edit, null);
    assert.equal(output.split("^" + plan.id).length - 1, 1);
  });
}
