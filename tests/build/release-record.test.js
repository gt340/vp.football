'use strict';
/* R1-0: the release record (release/release.json) versus the immutable Phase 5 baseline record
 * (tests/fixtures/baseline.json). The build gates on the release record; the baseline record is pinned here. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { REPO, copyRepo, node, rm } = require('./helpers');

const APPROVED_SHA = '03c0380585d65b29368e3e6ca8dfd6cad245f61d28b3527b3783869ccd0f45dd';
const APPROVED_BYTES = 187177;
// The original baseline record, pinned byte for byte. Changing tests/fixtures/baseline.json must fail this test.
const BASELINE_RECORD_FILE_SHA256 = 'a5318a7a292995e0c625cbe0c89fdb6b61cc7d41c71edcb04bf558357f9b8166';
const BASELINE_RECORD_FILE_BYTES = 451;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (root, rel) => fs.readFileSync(path.join(root, rel));
const readJson = (root, rel) => JSON.parse(read(root, rel).toString('utf8'));
const writeJson = (root, rel, obj) => fs.writeFileSync(path.join(root, rel), JSON.stringify(obj, null, 2) + '\n');
const flipHex = (h) => (h[0] === '0' ? '1' : '0') + h.slice(1);
function withCopy(fn) { const tmp = copyRepo(); try { return fn(tmp); } finally { rm(tmp); } }
function build(tmp, args = ['--check']) { return node('scripts/build.js', args, tmp); }

test('release record identifies the current R1-1 artifact (sha256, bytes, name, kind)', () => {
  const r = readJson(REPO, 'release/release.json');
  assert.equal(r.recordVersion, 1);
  assert.equal(r.kind, 'release');
  assert.equal(r.name, 'r1-1-screen-router');
  assert.equal(r.artifact.path, 'football-game.html');
  assert.equal(r.artifact.sha256, APPROVED_SHA);
  assert.equal(r.artifact.bytes, APPROVED_BYTES);
});

test('the original baseline record is immutable: pinned byte for byte, with the Phase 5 identity', () => {
  const raw = read(REPO, 'tests/fixtures/baseline.json');
  assert.equal(raw.length, BASELINE_RECORD_FILE_BYTES);
  assert.equal(sha(raw), BASELINE_RECORD_FILE_SHA256);
  const b = JSON.parse(raw.toString('utf8'));
  assert.equal(b.sha256, APPROVED_SHA);
  assert.equal(b.bytes, APPROVED_BYTES);
});

test('the release record references the baseline record and agrees with it', () => {
  const r = readJson(REPO, 'release/release.json');
  const b = readJson(REPO, 'tests/fixtures/baseline.json');
  assert.equal(r.derivedFromBaseline.record, 'tests/fixtures/baseline.json');
  assert.equal(r.derivedFromBaseline.sha256, b.sha256);
  assert.equal(r.derivedFromBaseline.bytes, b.bytes);
});

test('the committed football-game.html equals the release record (independent hash and byte count)', () => {
  const r = readJson(REPO, 'release/release.json');
  const html = read(REPO, 'football-game.html');
  assert.equal(html.length, r.artifact.bytes);
  assert.equal(sha(html), r.artifact.sha256);
});

test('build:check verifies against the release record and reports which records it used', () => withCopy((tmp) => {
  const r = build(tmp);
  assert.equal(r.code, 0, r.out);
  const summary = JSON.parse(r.out.trim().split('\n').pop());
  assert.equal(summary.release, 'r1-1-screen-router');
  assert.equal(summary.matchesBaseline, false);
  assert.equal(summary.sha256, APPROVED_SHA);
  assert.equal(summary.bytes, APPROVED_BYTES);
}));

test('MISMATCH: a wrong release hash is detected (exit 2) and both identities are reported', () => withCopy((tmp) => {
  const r = readJson(tmp, 'release/release.json');
  r.artifact.sha256 = flipHex(r.artifact.sha256);
  writeJson(tmp, 'release/release.json', r);
  const out = build(tmp);
  assert.equal(out.code, 2);
  assert.match(out.out, /does not match the release record/);
  assert.match(out.out, new RegExp(APPROVED_SHA));          // what was built
  assert.match(out.out, new RegExp(r.artifact.sha256));     // what the release record claimed
  assert.match(out.out, /original Phase 5 baseline/);       // the immutable baseline is named separately
}));

test('MISMATCH: a wrong release byte count is detected (exit 2)', () => withCopy((tmp) => {
  const r = readJson(tmp, 'release/release.json');
  r.artifact.bytes += 1;
  writeJson(tmp, 'release/release.json', r);
  const out = build(tmp);
  assert.equal(out.code, 2);
  assert.match(out.out, /does not match the release record/);
}));

test('MISMATCH: wrong hash AND size together are still detected (exit 2), in build mode too', () => withCopy((tmp) => {
  const r = readJson(tmp, 'release/release.json');
  r.artifact.sha256 = 'f'.repeat(64);
  r.artifact.bytes = 1;
  writeJson(tmp, 'release/release.json', r);
  assert.equal(build(tmp).code, 2);
  const before = read(tmp, 'football-game.html');
  assert.equal(build(tmp, []).code, 2);
  assert.ok(before.equals(read(tmp, 'football-game.html')), 'a failed build must not touch the artifact');
}));

test('invalid release records fail the build (exit 1): missing, bad JSON, wrong kind/version, bad hash or size, wrong path, baseline mismatch', () => {
  const cases = {
    'missing file': (tmp) => fs.rmSync(path.join(tmp, 'release/release.json')),
    'not JSON': (tmp) => fs.writeFileSync(path.join(tmp, 'release/release.json'), '{ nope'),
    'wrong kind': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.kind = 'baseline'; writeJson(tmp, 'release/release.json', r); },
    'wrong version': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.recordVersion = 2; writeJson(tmp, 'release/release.json', r); },
    'uppercase hash': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.artifact.sha256 = r.artifact.sha256.toUpperCase(); writeJson(tmp, 'release/release.json', r); },
    'short hash': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.artifact.sha256 = r.artifact.sha256.slice(0, 63); writeJson(tmp, 'release/release.json', r); },
    'bytes as string': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.artifact.bytes = String(r.artifact.bytes); writeJson(tmp, 'release/release.json', r); },
    'zero bytes': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.artifact.bytes = 0; writeJson(tmp, 'release/release.json', r); },
    'artifact path differs from the manifest output': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.artifact.path = 'other.html'; writeJson(tmp, 'release/release.json', r); },
    'derivedFromBaseline differs from baseline.json': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.derivedFromBaseline.sha256 = flipHex(r.derivedFromBaseline.sha256); writeJson(tmp, 'release/release.json', r); },
    'wrong derivedFromBaseline record path': (tmp) => { const r = readJson(tmp, 'release/release.json'); r.derivedFromBaseline.record = 'somewhere-else.json'; writeJson(tmp, 'release/release.json', r); },
    'no name': (tmp) => { const r = readJson(tmp, 'release/release.json'); delete r.name; writeJson(tmp, 'release/release.json', r); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    withCopy((tmp) => { mutate(tmp); const out = build(tmp); assert.equal(out.code, 1, `${name}: expected exit 1, got ${out.code}\n${out.out}`); });
  }
});

test('a tampered baseline record is rejected by the build when it disagrees with the release record (exit 1)', () => withCopy((tmp) => {
  const b = readJson(tmp, 'tests/fixtures/baseline.json');
  b.bytes += 1;
  writeJson(tmp, 'tests/fixtures/baseline.json', b);
  const out = build(tmp);
  assert.equal(out.code, 1);
  assert.match(out.out, /derivedFromBaseline does not match/);
}));

test('FUTURE RELEASES: a changed slice fails until the release record is deliberately updated; the baseline record stays untouched', () => withCopy((tmp) => {
  const baselineBefore = read(tmp, 'tests/fixtures/baseline.json');
  fs.appendFileSync(path.join(tmp, 'src/engine/init.js'), '// a deliberate future change\n');
  // 1. without updating the release record the gate fails, exactly as before
  const blocked = build(tmp, []);
  assert.equal(blocked.code, 2);
  assert.match(blocked.out, /does not match the release record/);
  // 2. with a deliberate release-record update the build succeeds and says it differs from the baseline
  const manifest = readJson(tmp, 'src/manifest.json');
  const bytes = Buffer.concat(manifest.files.map((f) => read(tmp, f)));
  const r = readJson(tmp, 'release/release.json');
  r.name = 'future-test-release'; r.artifact.sha256 = sha(bytes); r.artifact.bytes = bytes.length;
  writeJson(tmp, 'release/release.json', r);
  const ok = build(tmp, []);
  assert.equal(ok.code, 0, ok.out);
  const summary = JSON.parse(ok.out.trim().split('\n').pop());
  assert.equal(summary.matchesBaseline, false);
  assert.equal(summary.release, 'future-test-release');
  assert.equal(build(tmp).code, 0);                                   // --check now sees no drift
  assert.notEqual(sha(read(tmp, 'football-game.html')), APPROVED_SHA);
  // 3. the baseline record itself was never touched
  assert.ok(baselineBefore.equals(read(tmp, 'tests/fixtures/baseline.json')));
}));

test('the build is deterministic and writes exactly the release artifact', () => {
  const a = copyRepo(), b = copyRepo();
  try {
    for (const d of [a, b]) { fs.rmSync(path.join(d, 'football-game.html')); assert.equal(build(d, []).code, 0); }
    const ha = read(a, 'football-game.html'), hb = read(b, 'football-game.html');
    assert.ok(ha.equals(hb));
    assert.equal(ha.length, APPROVED_BYTES);
    assert.equal(sha(ha), APPROVED_SHA);
  } finally { rm(a); rm(b); }
});

/* ---- verify-artifact now defaults to the release record ---- */
function serve(body) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => { res.writeHead(200); res.end(body); }).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
function verify(root, url, extra = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(root, 'scripts/verify-artifact.js'), '--base-url', url, ...extra], (err, out) => resolve({ code: err ? err.code : 0, out }));
  });
}

test('verify-artifact takes its default expectation from the release record', async () => {
  const good = read(REPO, 'football-game.html');
  const { s, url } = await serve(good);
  const tmp = copyRepo();
  try {
    assert.equal((await verify(tmp, url)).code, 0);                   // unmodified record: served bytes match
    const r = readJson(tmp, 'release/release.json');
    r.artifact.sha256 = flipHex(r.artifact.sha256);
    writeJson(tmp, 'release/release.json', r);
    const bad = await verify(tmp, url);                               // record says something else: mismatch detected
    assert.equal(bad.code, 1);
    assert.match(bad.out, /FAIL/);
    assert.equal((await verify(tmp, url, ['--sha256', APPROVED_SHA])).code, 0); // explicit override still works
  } finally { s.close(); rm(tmp); }
});
