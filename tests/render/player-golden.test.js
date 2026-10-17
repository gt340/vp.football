'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { REPO, copyRepo, node, rm } = require('../build/helpers');
const { captureSignature, compareSignatures, hashSignature, CASES } = require('../harness/render-signature');

const goldenPath = path.join(REPO, 'tests/golden/player-base.v1.json');
const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
const THRESHOLD = 0; // the base toy-player geometry must have ZERO differing draw calls

function report(label, r) {
  const lines = [`${label}: differences=${r.differences} threshold=${r.threshold}`];
  for (const d of r.first) lines.push(`  case=${d.case} call#${d.index} expected=${JSON.stringify(d.expected)} actual=${JSON.stringify(d.actual)}`);
  return lines.join('\n');
}

test('golden file records the Commander approval (limited scope) and is tied to the recorded baseline', () => {
  assert.equal(golden.status, 'APPROVED_DRAWING_INSTRUCTION_REFERENCE');
  assert.equal(golden.approval.by, 'Commander');
  assert.match(golden.approval.scope, /not approval of future visual changes/i);
  assert.match(golden.approval.limitations, /headless Chromium/);
  assert.match(golden.approval.limitations, /No Android Chrome, physical-device, GPU, or cross-browser equivalence is claimed/);
  const baseline = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/baseline.json'), 'utf8'));
  assert.equal(golden.capturedFrom.sha256, baseline.sha256);
  assert.deepEqual(Object.keys(golden.cases), CASES.map((c) => c.name));
});

test('golden file integrity: stored signature hash matches its own contents', () => {
  const h = crypto.createHash('sha256').update(JSON.stringify({ signatureVersion: golden.signatureVersion, cases: golden.cases })).digest('hex');
  assert.equal(h, golden.signatureSha256);
});

test('GATE: committed artifact draws the original toy-style player with ZERO differences', () => {
  const sig = captureSignature(path.join(REPO, 'football-game.html'));
  const r = compareSignatures(golden, sig, THRESHOLD);
  assert.ok(r.pass, report('committed artifact vs golden', r));
  assert.equal(hashSignature(sig), golden.signatureSha256);
});

test('GATE: an artifact rebuilt from the src slices draws the player with ZERO differences', () => {
  const tmp = copyRepo();
  try {
    fs.rmSync(path.join(tmp, 'football-game.html'));
    assert.equal(node('scripts/build.js', [], tmp).code, 0);
    const sig = captureSignature(path.join(tmp, 'football-game.html'));
    const r = compareSignatures(golden, sig, THRESHOLD);
    assert.ok(r.pass, report('rebuilt artifact vs golden', r));
  } finally { rm(tmp); }
});

test('signature capture is deterministic', () => {
  const f = path.join(REPO, 'football-game.html');
  assert.deepEqual(captureSignature(f), captureSignature(f));
});

test('the signature covers body, head, kit colours, goalkeeper, controlled ring and stunned states', () => {
  const flat = (n) => golden.cases[n].map((c) => c.join(' ')).join('\n');
  assert.match(flat('home-outfield-controlled'), /ellipse/); // shadow
  assert.match(flat('home-outfield-controlled'), /createRadialGradient/); // head
  assert.match(flat('home-outfield-controlled'), /#cc0000/); // team colour present
  assert.ok(golden.cases['home-outfield-controlled'].length !== golden.cases['away-outfield-stunned'].length, 'controlled and stunned draw differently');
  assert.ok(golden.cases['home-goalkeeper'].length > 0 && golden.cases['away-goalkeeper'].length > 0);
});

test('comparison reports differences, the failing call index, and the threshold (mutation check)', () => {
  const mutated = JSON.parse(JSON.stringify(golden));
  mutated.cases['home-goalkeeper'][3][1] = 'MUTATED';
  const r = compareSignatures(golden, mutated, 0);
  assert.equal(r.pass, false);
  assert.equal(r.differences, 1);
  assert.equal(r.first[0].case, 'home-goalkeeper');
  assert.equal(r.first[0].index, 3);
  assert.equal(compareSignatures(golden, mutated, 1).pass, true); // an explicit threshold would tolerate it; base geometry uses 0
});

test('a changed renderer slice is detected as a visual regression', () => {
  const tmp = copyRepo();
  try {
    const f = path.join(tmp, 'football-game.html');
    const html = fs.readFileSync(f, 'utf8');
    assert.ok(html.includes('function drawPlayer(p) {'));
    fs.writeFileSync(f, html.replace('function drawPlayer(p) {', 'function drawPlayer(p) { p = { ...p, x: p.x + 1 };'));
    const sig = captureSignature(f);
    const r = compareSignatures(golden, sig, THRESHOLD);
    assert.equal(r.pass, false);
    assert.ok(r.differences > 0);
  } finally { rm(tmp); }
});

test('golden:propose writes only a candidate and never touches the approved golden', () => {
  const tmp = copyRepo();
  try {
    fs.mkdirSync(path.join(tmp, 'tests/harness'), { recursive: true });
    fs.cpSync(path.join(REPO, 'tests/harness'), path.join(tmp, 'tests/harness'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tests/golden'), { recursive: true });
    fs.copyFileSync(goldenPath, path.join(tmp, 'tests/golden/player-base.v1.json'));
    const before = fs.readFileSync(path.join(tmp, 'tests/golden/player-base.v1.json'));
    const r = node('scripts/golden-propose.js', [], tmp);
    assert.equal(r.code, 0, r.out);
    assert.ok(before.equals(fs.readFileSync(path.join(tmp, 'tests/golden/player-base.v1.json'))), 'approved golden was modified');
    const cand = JSON.parse(fs.readFileSync(path.join(tmp, 'tests/golden/player-base.v1.candidate.json'), 'utf8'));
    assert.equal(cand.status, 'CANDIDATE_NOT_APPROVED');
  } finally { rm(tmp); }
});
