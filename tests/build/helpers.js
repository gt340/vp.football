'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');

// Copies exactly what the build needs into a fresh temp directory.
function copyRepo() {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'vpf-'));
  for (const p of ['src', 'scripts', 'tests/fixtures', 'football-game.html', 'package.json']) {
    fs.mkdirSync(path.dirname(path.join(dst, p)), { recursive: true });
    fs.cpSync(path.join(REPO, p), path.join(dst, p), { recursive: true });
  }
  return dst;
}
function node(script, args, cwd) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });

module.exports = { REPO, copyRepo, node, rm };
