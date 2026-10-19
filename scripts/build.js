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
 * Exit codes: 0 ok | 1 manifest/record/source problem | 2 release-record mismatch | 3 committed artifact drift
 *
 * Two separate records are involved:
 *   tests/fixtures/baseline.json  the IMMUTABLE record of the original Phase 5 artifact (never a build gate target for new work)
 *   release/release.json          the approved release artifact; the build output must equal it
 * The release record must reference the baseline record's identity (derivedFromBaseline), so neither can be changed silently.
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

// ---- records: the immutable Phase 5 baseline and the current release record ----
const SHA_RE = /^[0-9a-f]{64}$/;
const BASELINE_REC = 'tests/fixtures/baseline.json';
const RELEASE_REC = 'release/release.json';
function readRecord(rel) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) die(1, `${rel} is missing`);
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { die(1, `${rel} is not valid JSON: ${e.message}`); }
}
function checkIdentity(id, label) {
  if (!id || typeof id.sha256 !== 'string' || !SHA_RE.test(id.sha256) || !Number.isInteger(id.bytes) || id.bytes <= 0) {
    die(1, `${label} must have a 64-character lowercase hex sha256 and a positive integer bytes`);
  }
}
const baseline = readRecord(BASELINE_REC);
checkIdentity(baseline, BASELINE_REC);
const release = readRecord(RELEASE_REC);
if (!release || release.recordVersion !== 1 || release.kind !== 'release') die(1, `${RELEASE_REC} must have recordVersion 1 and kind "release"`);
if (typeof release.name !== 'string' || !release.name) die(1, `${RELEASE_REC} needs a non-empty name`);
checkIdentity(release.artifact, `${RELEASE_REC} artifact`);
if (release.artifact.path !== manifest.output) die(1, `${RELEASE_REC} artifact.path "${release.artifact.path}" must equal the manifest output "${manifest.output}"`);
checkIdentity(release.derivedFromBaseline, `${RELEASE_REC} derivedFromBaseline`);
if (release.derivedFromBaseline.sha256 !== baseline.sha256 || release.derivedFromBaseline.bytes !== baseline.bytes) {
  die(1, `${RELEASE_REC} derivedFromBaseline does not match ${BASELINE_REC} (the original baseline is immutable)`);
}

// ---- release gate: the rebuilt artifact must equal the approved release record ----
if (built.length !== release.artifact.bytes || digest !== release.artifact.sha256) {
  die(2, `built artifact does not match the release record (${RELEASE_REC}).\n  built:    ${built.length} bytes, sha256 ${digest}\n  release:  ${release.artifact.bytes} bytes, sha256 ${release.artifact.sha256}\n  (original Phase 5 baseline, ${BASELINE_REC}: ${baseline.bytes} bytes, sha256 ${baseline.sha256})`);
}
summary.release = release.name;
summary.matchesBaseline = built.length === baseline.bytes && digest === baseline.sha256;

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
