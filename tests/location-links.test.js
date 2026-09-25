const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
globalThis.crypto ??= webcrypto;
const { planLocationLink, createBlockId, buildBlockUri, LocationLinkError } = require("../src/location-links");
const { supported, unsupported, applyPlan } = require("./fixtures");

for (const fixture of supported) {
  test(fixture.name, () => {
    const cursor = { line: fixture.line, ch: 0 };
    const plan = planLocationLink(fixture.text, cursor, () => "1234567890abcdef");
    assert.equal(plan.id, fixture.id || "smartpasteblockID-1234567890abcdef");
    assert.equal(Boolean(plan.structured), Boolean(fixture.structured));
    if (fixture.id) assert.equal(plan.edit, null);
    else assert.ok(plan.edit);
    const result = applyPlan(fixture.text, plan);
    const again = planLocationLink(result, cursor);
    assert.equal(again.id, plan.id);
    assert.equal(again.edit, null, "repeated invocation must not edit");
    if (plan.edit) assert.equal(result.replace(plan.edit.text, ""), fixture.text);
  });
}

for (const fixture of unsupported) {
  test(`refuses ${fixture.name}`, () => {
    assert.throws(() => planLocationLink(fixture.text, { line: fixture.line, ch: 0 }), LocationLinkError);
  });
}

test("IDs use 64 random bits and are unique in a 10,000-ID sample", () => {
  const ids = new Set(Array.from({ length: 10000 }, () => createBlockId("")));
  assert.equal(ids.size, 10000);
  for (const id of ids) assert.match(id, /^smartpasteblockID-[a-f0-9]{16}$/);
});

test("collision retries, including case-insensitive IDs and code", () => {
  const values = ["ABC", "def", "123"];
  assert.equal(createBlockId("Text ^SMARTPASTEBLOCKID-abc\n\n```\n^smartpasteblockID-def\n```", () => values.shift()), "smartpasteblockID-123");
  assert.throws(() => createBlockId("^smartpasteblockID-same", () => "same"), /ייחודי/);
});

test("duplicate existing IDs are rejected case-insensitively", () => {
  assert.throws(() => planLocationLink("First ^same\n\nSecond ^SAME", { line: 0, ch: 0 }), /כפילות/);
});

for (const path of [
  'חזרות/חזרות שו"ע יו"ד סימן סט.md',
  "nested/folder/a note.md",
  "folder/quotes' and (parentheses)! & ? = + %,;@.md",
  "literal%20filename.md",
  "emoji/שלום😀.md",
  "reserved/#^|.md"
]) {
  test(`URI round trip: ${path}`, () => {
    const uri = buildBlockUri("AAG Vault", path, "aag-123");
    const parsed = new URL(uri);
    assert.equal(parsed.protocol, "obsidian:");
    assert.equal(parsed.hostname, "smartpaste");
    assert.equal(parsed.hash, "");
    assert.equal(parsed.searchParams.get("vault"), "AAG Vault");
    assert.equal(parsed.searchParams.get("file"), path);
    assert.match(uri, /vault=AAG%20Vault&file=/);
    assert.equal(parsed.searchParams.get("block"), "aag-123");
    assert.match(uri, /&block=aag-123$/);
    assert.doesNotMatch(uri, /[\s"'()!]/);
  });
}
