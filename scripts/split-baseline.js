#!/usr/bin/env node
'use strict';
/*
 * R0-2: one-time, lossless extraction of the Phase 5 baseline into source slices.
 *
 * - Refuses to run unless the input file matches tests/fixtures/baseline.json
 *   (SHA-256 + byte count). Nothing is split from an unknown file.
 * - Cuts the file only at the line numbers below, and only if the first
 *   characters of each cut line match the recorded marker (guards against
 *   a shifted or edited input).
 * - Writes each slice byte-for-byte (no normalisation, no added bytes).
 * - Concatenates the slices again and requires an exact byte match with the input
 *   BEFORE anything is left on disk; otherwise it deletes what it wrote and exits 1.
 * - Writes src/manifest.json (explicit build order).
 * - Refuses to overwrite an existing src/ tree.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const inputPath = path.join(root, 'football-game.html');
const baseline = JSON.parse(fs.readFileSync(path.join(root, 'tests', 'fixtures', 'baseline.json'), 'utf8'));

// [relative path, first line (1-based), marker = leading text of that line]
const SLICES = [
  ['src/shell/head.html', 1, '<!DOCTYPE html>'],
  ['src/shell/styles.css', 8, '  * { box-sizing: border-box; margin'],
  ['src/shell/body.html', 228, '</style>'],
  ['src/data/static-data.js', 386, '/* ================================='],
  ['src/engine/events-and-config.js', 462, '/* ---------- EVENT SYSTEM (Step 13)'],
  ['src/engine/state-and-persistence.js', 931, '/* ---------- GAME STATE MACHINE (St'],
  ['src/input/input-manager.js', 1312, '/* ---------- INPUT SYSTEM (Step 10)'],
  ['src/engine/audio-and-commentary.js', 1339, '/* ---------- AUDIO FOUNDATION (Step'],
  ['src/ui/menu-and-panels.js', 1470, '/* ---------- MENU / SQUAD SELECTION'],
  ['src/input/touch-controls.js', 1715, '/* ---------- Stick + buttons (touch'],
  ['src/rendering/camera.js', 1775, '/* ---------- CAMERA FOUNDATION (Ste'],
  ['src/engine/match-flow.js', 1808, '/* ---------- MATCH ENGINE FOUNDATIO'],
  ['src/engine/gameplay-core.js', 2101, '/* ---------- GAME LOOP ----------'],
  ['src/engine/ball-control.js', 2665, '/* ================================='],
  ['src/engine/stamina-and-tactics.js', 2741, '/* ================================='],
  ['src/engine/substitution-manager.js', 2984, '/* ================================='],
  ['src/engine/referee-system.js', 3081, '/* ================================='],
  ['src/engine/set-piece-manager.js', 3242, '/* ================================='],
  ['src/engine/boundary-engine.js', 3330, '/* ---------- OUT-OF-BOUNDS ENGINE E'],
  ['src/rendering/pitch-renderer.js', 3408, '/* ---------- RENDERER ---------- */'],
  ['src/rendering/player-renderer.js', 3464, 'const PLAYER_RENDER = {'],
  ['src/engine/pitch-geometry-check.js', 3533, '/* ---------- PITCH GEOMETRY INTEGRI'],
  ['src/engine/init.js', 3559, '/* ---------- INIT ---------- */'],
  ['src/shell/tail.html', 3565, '</script>'],
];

function fail(msg) { console.error('SPLIT FAILED: ' + msg); process.exit(1); }
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const input = fs.readFileSync(inputPath);
if (input.length !== baseline.bytes) fail(`input is ${input.length} bytes, baseline is ${baseline.bytes}`);
if (sha(input) !== baseline.sha256) fail(`input SHA-256 ${sha(input)} != baseline ${baseline.sha256}`);
if (fs.existsSync(path.join(root, 'src'))) fail('src/ already exists; refusing to overwrite');

// Line start offsets (a line includes its terminating \n).
const starts = [0];
for (let i = 0; i < input.length; i++) if (input[i] === 0x0a && i + 1 < input.length) starts.push(i + 1);
const lineText = (n) => input.subarray(starts[n - 1], Math.min(starts[n - 1] + 80, input.length)).toString('latin1');

const parts = [];
SLICES.forEach(([rel, first, marker], i) => {
  if (first < 1 || first > starts.length) fail(`${rel}: line ${first} is out of range`);
  if (!lineText(first).startsWith(marker)) fail(`${rel}: line ${first} does not start with expected marker`);
  const from = starts[first - 1];
  const to = i + 1 < SLICES.length ? starts[SLICES[i + 1][1] - 1] : input.length;
  if (to <= from) fail(`${rel}: empty or reversed slice`);
  parts.push({ rel, bytes: input.subarray(from, to) });
});
if (SLICES[0][1] !== 1) fail('first slice must start at line 1');

const rebuilt = Buffer.concat(parts.map((p) => p.bytes));
if (!rebuilt.equals(input)) fail('in-memory concatenation differs from the input; nothing written');

const written = [];
try {
  for (const p of parts) {
    const abs = path.join(root, p.rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, p.bytes);
    written.push(abs);
  }
  const manifest = {
    manifestVersion: 1,
    output: 'football-game.html',
    description: 'Ordered, verbatim slices of the Phase 5 baseline. Concatenation order IS the build.',
    files: parts.map((p) => p.rel),
  };
  const mpath = path.join(root, 'src', 'manifest.json');
  fs.writeFileSync(mpath, JSON.stringify(manifest, null, 2) + '\n');
  written.push(mpath);
  // Re-read from disk and verify again.
  const again = Buffer.concat(manifest.files.map((r) => fs.readFileSync(path.join(root, r))));
  if (!again.equals(input) || sha(again) !== baseline.sha256) throw new Error('on-disk concatenation differs from the input');
} catch (e) {
  for (const f of written) { try { fs.unlinkSync(f); } catch (_) { /* ignore */ } }
  fail(String(e.message || e));
}
console.log(`OK: ${parts.length} slices, ${input.length} bytes, sha256 ${baseline.sha256}`);
