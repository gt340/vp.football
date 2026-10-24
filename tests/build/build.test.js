'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { REPO, copyRepo, node, rm } = require('./helpers');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/baseline.json'), 'utf8'));
const release = JSON.parse(fs.readFileSync(path.join(REPO, 'release/release.json'), 'utf8'));

test('recorded baseline fixture has the Phase 5 hash and size', () => {
  assert.equal(baseline.sha256, '84b1d74343df1b8093bfdd1797d90a691e39043627bb1f1483d3f1a8deef8a1d');
  assert.equal(baseline.bytes, 186426);
});

test('committed football-game.html matches the current release record (baseline remains separately pinned)', () => {
  const b = fs.readFileSync(path.join(REPO, 'football-game.html'));
  assert.equal(b.length, release.artifact.bytes);
  assert.equal(sha(b), release.artifact.sha256);
});

test('GATE: build from src slices reproduces the current release artifact, and --check finds no drift', () => {
  const tmp = copyRepo();
  try {
    fs.rmSync(path.join(tmp, 'football-game.html'));
    const r = node('scripts/build.js', [], tmp);
    assert.equal(r.code, 0, r.out);
    const built = fs.readFileSync(path.join(tmp, 'football-game.html'));
    assert.equal(built.length, release.artifact.bytes);
    assert.equal(sha(built), release.artifact.sha256);
    const c = node('scripts/build.js', ['--check'], tmp);
    assert.equal(c.code, 0, c.out);
  } finally { rm(tmp); }
});

test('build is deterministic: repeated builds in different directories give identical bytes', () => {
  const a = copyRepo(), b = copyRepo();
  try {
    for (const d of [a, b]) { fs.rmSync(path.join(d, 'football-game.html')); assert.equal(node('scripts/build.js', [], d).code, 0); }
    assert.ok(fs.readFileSync(path.join(a, 'football-game.html')).equals(fs.readFileSync(path.join(b, 'football-game.html'))));
    assert.equal(node('scripts/build.js', [], a).code, 0); // rebuilding over its own output is stable
    assert.equal(sha(fs.readFileSync(path.join(a, 'football-game.html'))), release.artifact.sha256);
  } finally { rm(a); rm(b); }
});

test('missing listed source file fails the build (exit 1)', () => {
  const tmp = copyRepo();
  try {
    fs.rmSync(path.join(tmp, 'src/engine/referee-system.js'));
    const r = node('scripts/build.js', [], tmp);
    assert.equal(r.code, 1);
    assert.match(r.out, /missing source file/);
  } finally { rm(tmp); }
});

test('unlisted source file fails the build (exit 1)', () => {
  const tmp = copyRepo();
  try {
    fs.writeFileSync(path.join(tmp, 'src/engine/extra.js'), '// not in the manifest\n');
    const r = node('scripts/build.js', [], tmp);
    assert.equal(r.code, 1);
    assert.match(r.out, /unlisted source file/);
  } finally { rm(tmp); }
});

test('a tampered source slice is caught by the release gate (exit 2)', () => {
  const tmp = copyRepo();
  try {
    const f = path.join(tmp, 'src/engine/ball-control.js');
    fs.appendFileSync(f, '// tamper\n');
    const r = node('scripts/build.js', [], tmp);
    assert.equal(r.code, 2);
    assert.match(r.out, /does not match the release record/);
  } finally { rm(tmp); }
});

test('a tampered committed artifact is caught by --check (exit 3, drift)', () => {
  const tmp = copyRepo();
  try {
    fs.appendFileSync(path.join(tmp, 'football-game.html'), '\n');
    const r = node('scripts/build.js', ['--check'], tmp);
    assert.equal(r.code, 3);
    assert.match(r.out, /drift/);
  } finally { rm(tmp); }
});

test('manifest errors fail the build: duplicate entry, path traversal, bad version', () => {
  for (const mutate of [
    (m) => { m.files.push(m.files[0]); },
    (m) => { m.files[1] = 'src/../scripts/build.js'; },
    (m) => { m.manifestVersion = 2; },
  ]) {
    const tmp = copyRepo();
    try {
      const mp = path.join(tmp, 'src/manifest.json');
      const m = JSON.parse(fs.readFileSync(mp, 'utf8'));
      mutate(m);
      fs.writeFileSync(mp, JSON.stringify(m));
      assert.equal(node('scripts/build.js', [], tmp).code, 1);
    } finally { rm(tmp); }
  }
});

test('split script refuses an input that is not the baseline and writes nothing', () => {
  const tmp = copyRepo();
  try {
    fs.rmSync(path.join(tmp, 'src'), { recursive: true });
    fs.appendFileSync(path.join(tmp, 'football-game.html'), ' ');
    const r = node('scripts/split-baseline.js', [tmp], tmp);
    assert.equal(r.code, 1);
    assert.match(r.out, /SPLIT FAILED/);
    assert.equal(fs.existsSync(path.join(tmp, 'src')), false);
  } finally { rm(tmp); }
});

test('baseline splitter refuses the evolved release artifact and leaves no partial source tree', () => {
  const tmp = copyRepo();
  try {
    fs.rmSync(path.join(tmp, 'src'), { recursive: true });
    const r = node('scripts/split-baseline.js', [tmp], tmp);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /SPLIT FAILED/);
    assert.equal(fs.existsSync(path.join(tmp, 'src')), false);
  } finally { rm(tmp); }
});

test('player renderer lives in its own contiguous slice and is verbatim', () => {
  const s = fs.readFileSync(path.join(REPO, 'src/rendering/player-renderer.js'), 'utf8');
  assert.match(s, /^const PLAYER_RENDER = \{/);
  assert.match(s, /function drawPlayer\(p\)/);
  assert.match(s, /function lighten\(hex, amt\)/);
});
