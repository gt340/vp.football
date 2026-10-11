#!/usr/bin/env node
'use strict';
/*
 * Builds football-game.html by concatenating the files listed in src/manifest.json, byte for byte,
 * in the listed order. No timestamps, no transformation, no dependencies: same inputs => same bytes.
 *
 *   node scripts/build.js            build and write football-game.html
 *   node scripts/build.js --check    build in memory and fail if the committed artifact differs (drift)
 *   --root <dir>                     operate on another checkout (used by the tests)
 *
 * Exit codes: 0 ok | 1 manifest/source problem | 2 baseline mismatch | 3 committed artifact drift
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const root = path.resolve(opt('--root') || path.join(__dirname, '..'));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
function die(code, msg) { console.error(`BUILD FAILED [${code}]: ${msg}`); process.exit(code); }

// ---- manifest ----
const manifestPath = path.join(root, 'src', 'manifest.json');
if (!fs.existsSync(manifestPath)) die(1, 'src/manifest.json is missing');
let manifest;
try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (e) { die(1, 'src/manifest.json is not valid JSON: ' + e.message); }
if (manifest.manifestVersion !== 1) die(1, 'unsupported manifestVersion');
if (typeof manifest.output !== 'string' || !manifest.output || manifest.output.includes('/') || manifest.output.includes('..')) die(1, 'manifest.output must be a plain file name');
if (!Array.isArray(manifest.files) || manifest.files.length === 0) die(1, 'manifest.files must be a non-empty array');

const seen = new Set();
for (const rel of manifest.files) {
  if (typeof rel !== 'string' || !rel.startsWith('src/') || rel.includes('..') || rel.includes('\\')) die(1, `invalid manifest path: ${JSON.stringify(rel)}`);
  if (seen.has(rel)) die(1, `duplicate manifest entry: ${rel}`);
  seen.add(rel);
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) die(1, `missing source file listed in manifest: ${rel}`);
}

// ---- every source-type file under src/ must be listed (no silent orphans) ----
const SOURCE_EXT = new Set(['.html', '.css', '.js']);
(function scan(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) { scan(abs); continue; }
    const rel = path.relative(root, abs).split(path.sep).join('/');
    if (SOURCE_EXT.has(path.extname(name)) && !seen.has(rel)) die(1, `unlisted source file (add it to src/manifest.json or remove it): ${rel}`);
  }
})(path.join(root, 'src'));

// ---- concatenate ----
const built = Buffer.concat(manifest.files.map((rel) => fs.readFileSync(path.join(root, rel))));
const digest = sha(built);
const summary = { output: manifest.output, bytes: built.length, sha256: digest, files: manifest.files.length };

// ---- R0 baseline gate: the rebuilt artifact must equal the recorded Phase 5 baseline ----
const baselinePath = path.join(root, 'tests', 'fixtures', 'baseline.json');
if (!fs.existsSync(baselinePath)) die(1, 'tests/fixtures/baseline.json is missing');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
if (built.length !== baseline.bytes || digest !== baseline.sha256) {
  die(2, `built artifact does not match the recorded baseline.\n  built:    ${built.length} bytes, sha256 ${digest}\n  baseline: ${baseline.bytes} bytes, sha256 ${baseline.sha256}`);
}

// ---- write or check ----
const outPath = path.join(root, manifest.output);
if (flag('--check')) {
  if (!fs.existsSync(outPath)) die(3, `${manifest.output} is missing (nothing to compare)`);
  const committed = fs.readFileSync(outPath);
  if (!committed.equals(built)) die(3, `${manifest.output} differs from a fresh build (drift). committed sha256 ${sha(committed)}, built ${digest}`);
  console.log(JSON.stringify({ ...summary, mode: 'check', status: 'identical' }));
} else {
  const tmp = outPath + '.tmp-build';
  fs.writeFileSync(tmp, built);
  fs.renameSync(tmp, outPath);
  console.log(JSON.stringify({ ...summary, mode: 'build', status: 'written' }));
}
