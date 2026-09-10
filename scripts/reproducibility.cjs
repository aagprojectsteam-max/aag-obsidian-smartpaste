const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const before = readFileSync('main.js');
require('./build.js');
assert.deepEqual(readFileSync('main.js'), before, 'Generated bundle must reproduce byte-for-byte');
console.log('Bundle reproducibility PASS');
