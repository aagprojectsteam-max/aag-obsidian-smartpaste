const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../scripts/publication.cjs');
const root = path.resolve(__dirname, '..');
function scratch(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-release-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('manifest, stable ID, versions, package and lockfile agree', () => p.metadata());
test('source has valid JavaScript syntax and a public file allowlist', () => { p.syntax(); p.scan(); });
test('release contains only three byte-identical runtime assets', t => {
  const dir = scratch(t); const checksums = p.stage(dir);
  assert.equal(Object.keys(checksums).length, 3);
  assert.ok(fs.readFileSync(path.join(dir, 'styles.css'), 'utf8').trim().length > 20);
  fs.writeFileSync(path.join(dir, 'data.json'), '{}');
  assert.throws(() => p.validateAssets(dir), /Exactly three/);
  assert.throws(() => p.stage(dir), /extra files/);
});
test('missing and corrupted artifacts fail validation', t => {
  const dir = scratch(t); p.stage(dir); fs.writeFileSync(path.join(dir, 'main.js'), '');
  assert.throws(() => p.validateAssets(dir), /nonempty/);
  fs.unlinkSync(path.join(dir, 'main.js')); assert.throws(() => p.validateAssets(dir), /Exactly three/);
});
test('metadata mismatches and forbidden public files fail closed', t => {
  const dir = scratch(t);
  for (const f of p.files(root, new Set(['.git', 'node_modules', 'dist']))) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(dir, f));
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'))); pkg.version = '999.0.0';
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg)); assert.throws(() => p.metadata(dir));
  for (const file of ['data.json', 'deployment.json', '.local-backups/capture.txt']) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), '{}');
    assert.throws(() => p.scan(dir), /allowlist/); fs.unlinkSync(path.join(dir, file));
  }
});
test('privacy and credential detection rejects synthetic unsafe content without exposing it', () => {
  for (const value of ['/' + 'home/' + 'example/file', '/' + 'mnt/' + 'data/file', 'ghp_' + 'A'.repeat(36), '-----BEGIN ' + 'PRIVATE KEY-----', ['192','168','1','4'].join('.')]) assert.ok(p.findings(value).length);
});
test('release tags must be bare versions equal to the manifest', () => {
  const version = p.metadata().version; p.tag(version);
  for (const tag of ['v' + version, '9.9.9', version + '-beta', version + ';echo']) assert.throws(() => p.tag(tag));
});
test('reviewed parser exceptions are digest-bound, never directory exclusions', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'publication.json')));
  for (const [file, record] of Object.entries(policy.reviewedContent)) {
    assert.equal(p.hash(fs.readFileSync(path.join(root, file))), record.sha256);
    assert.throws(() => p.scanText(file, Buffer.concat([fs.readFileSync(path.join(root, file)), Buffer.from(' unsafe change')])));
  }
});
