const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { wrap } = require('node:module');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const ASSETS = Object.freeze(['main.js', 'manifest.json', 'styles.css']);
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const json = (file, root = ROOT) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const hash = b => crypto.createHash('sha256').update(b).digest('hex');
function metadata(root = ROOT) {
  const m = json('manifest.json', root), p = json('package.json', root), v = json('versions.json', root), policy = json('publication.json', root);
  for (const k of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) assert.equal(typeof m[k], 'string', `Manifest ${k}`);
  assert.equal(typeof m.isDesktopOnly, 'boolean');
  assert.match(m.id, /^[a-z-]+$/); assert.equal(m.id, policy.id, 'Stable plugin ID');
  assert.ok(!m.id.includes('obsidian') && !m.id.endsWith('plugin'));
  assert.ok(!/obsidian|plugin/i.test(m.name), 'Public display name');
  assert.match(m.version, semver); assert.match(m.minAppVersion, semver);
  assert.ok(m.description.length <= 250 && m.description.endsWith('.'));
  assert.equal(p.version, m.version); assert.equal(p.license, 'MIT');
  const lock = json('package-lock.json', root);
  assert.equal(lock.version, m.version); assert.equal(lock.packages[''].version, m.version);
  for (const key of ['dependencies', 'devDependencies']) assert.deepEqual(lock.packages[''][key] || {}, p[key] || {});
  assert.equal(v[m.version], m.minAppVersion);
  for (const [version, minimum] of Object.entries(v)) { assert.match(version, semver); assert.match(minimum, semver); }
  assert.match(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8'), /MIT License[\s\S]*Copyright \(c\) 2026 AAG/);
  return m;
}
function files(root, skip = new Set()) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(e => {
    if (skip.has(e.name)) return [];
    assert.ok(!e.isSymbolicLink(), `Symlink forbidden: ${e.name}`);
    return e.isDirectory() ? files(path.join(root, e.name), skip).map(f => `${e.name}/${f}`) : [e.name];
  }).sort();
}
function findings(text) {
  const checks = [
    ['private-path', new RegExp('/(?:home|Users)/|/mnt/' + 'data(?:/|\\b)|[A-Z]:\\\\Users\\\\')],
    ['private-key', new RegExp('-----BEGIN (?:RSA |OPENSSH |EC )?' + 'PRIVATE KEY-----')],
    ['credential-signature', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{30,})\b/],
    ['credential-assignment', /(?:api[_-]?key|password|passwd|secret|access[_-]?token)\s*["']?\s*[:=]\s*["'][^"'\s]{8,}["']/i],
    ['credential-url', /https?:\/\/[^\s/"']+:[^\s/"']+@/],
    ['local-address', /\b(?:local(?:host)|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/]
  ];
  return checks.filter(([, r]) => r.test(text)).map(([category]) => category);
}
function scanText(file, bytes, root = ROOT) {
  const hits = findings(bytes.toString('utf8'));
  const exceptions = json('publication.json', root).reviewedContent || {};
  const exception = exceptions[file];
  if (hits.length && exception && exception.sha256 === hash(bytes) && hits.every(h => exception.categories.includes(h))) return;
  assert.deepEqual(hits, [], `${file}: privacy/secret categories (values redacted)`);
  const sourceMap = bytes.toString('utf8').match(/sourceMappingURL=data:application\/json;base64,([^\s]+)/);
  if (sourceMap) assert.deepEqual(findings(Buffer.from(sourceMap[1], 'base64').toString()), [], `${file}: embedded source map`);
}
function scan(root = ROOT) {
  const expected = json('publication-files.json', root).sort();
  const actual = files(root, new Set(['.git', 'node_modules', 'dist']));
  assert.deepEqual(actual, expected, 'Public source allowlist: review additions explicitly');
  for (const file of actual) {
    assert.ok(!/(^|\/)(?:data\.json|deployment\.json|\.env(?:\..*)?|\.local-backups|\.obsidian)(?:$|\/)|\.(?:log|tmp|bak|db|sqlite|asar)$/.test(file), `Forbidden file: ${file}`);
    scanText(file, fs.readFileSync(path.join(root, file)), root);
  }
  return actual;
}
function syntax(root = ROOT) {
  for (const file of files(root, new Set(['.git', 'node_modules', 'dist'])).filter(f => /\.(?:js|cjs)$/.test(f))) {
    new vm.Script(wrap(fs.readFileSync(path.join(root, file), 'utf8')), { filename: file });
  }
}
function validateAssets(dir, root = ROOT) {
  const m = metadata(root);
  assert.deepEqual(files(dir), [...ASSETS].sort(), 'Exactly three individual runtime assets');
  assert.deepEqual(json('manifest.json', dir), m);
  const checksums = {};
  for (const f of ASSETS) {
    const b = fs.readFileSync(path.join(dir, f)); assert.ok(b.length > 0, `${f}: nonempty`);
    assert.equal(hash(b), hash(fs.readFileSync(path.join(root, f))), `${f}: matches source build`);
    scanText(f, b, root); checksums[f] = hash(b);
  }
  const js = fs.readFileSync(path.join(dir, 'main.js'), 'utf8');
  const allow = new Set(json('publication.json', root).runtimeExternals);
  for (const m of js.matchAll(/require\(["']([^"']+)["']\)/g)) assert.ok(allow.has(m[1]), 'Unexpected runtime dependency');
  if (json('publication.json', root).bundledNotices) {
    const notices = fs.readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    for (const name of ['markdown-it', 'entities', 'linkify-it', 'mdurl', 'punycode.js', 'uc.micro']) {
      assert.ok(js.includes(name), `Missing bundle notice: ${name}`); assert.ok(notices.includes(name), `Missing notice document: ${name}`);
    }
    assert.ok(js.includes('Redistribution and use in source and binary forms'), 'BSD notice retained');
    assert.ok(js.includes('Permission is hereby granted'), 'MIT notices retained');
  }
  return checksums;
}
function stage(dir = path.join(ROOT, 'dist', 'release'), root = ROOT) {
  metadata(root); scan(root); syntax(root);
  fs.mkdirSync(dir, { recursive: true });
  assert.deepEqual(files(dir).filter(f => !ASSETS.includes(f)), [], 'Refuse output directory with extra files');
  for (const f of ASSETS) fs.copyFileSync(path.join(root, f), path.join(dir, f));
  return validateAssets(dir, root);
}
function tag(value, root = ROOT) { assert.match(value || '', semver); assert.equal(value, metadata(root).version, 'Tag must exactly equal manifest.version'); }
module.exports = { metadata, files, findings, scanText, scan, syntax, stage, validateAssets, tag, ASSETS, hash };
if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'check') { metadata(); syntax(); }
  else if (cmd === 'scan') scan();
  else if (cmd === 'stage') console.log(JSON.stringify(stage(process.argv[3]), null, 2));
  else if (cmd === 'assets') console.log(JSON.stringify(validateAssets(process.argv[3] || path.join(ROOT, 'dist', 'release')), null, 2));
  else if (cmd === 'tag') tag(process.env.RELEASE_TAG);
  else throw Error('Unknown publication command');
}
