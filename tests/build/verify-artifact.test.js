'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO } = require('./helpers');

const good = fs.readFileSync(path.join(REPO, 'football-game.html'));

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}
function run(url) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(REPO, 'scripts/verify-artifact.js'), '--base-url', url], (err, out) => resolve({ code: err ? err.code : 0, out }));
  });
}

test('verify-artifact passes when / and /football-game.html serve the exact baseline', async () => {
  const { s, url } = await serve((req, res) => { res.writeHead(200); res.end(good); });
  const r = await run(url); s.close();
  assert.equal(r.code, 0, r.out);
  assert.equal((r.out.match(/PASS/g) || []).length, 2);
});

test('verify-artifact detects a tampered body (mismatch)', async () => {
  const bad = Buffer.concat([good, Buffer.from(' ')]);
  const { s, url } = await serve((req, res) => { res.writeHead(200); res.end(req.url === '/' ? bad : good); });
  const r = await run(url); s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /FAIL .*\/ status=200/);
});

test('verify-artifact detects the Vercel-style 404 on the root route', async () => {
  const { s, url } = await serve((req, res) => { if (req.url === '/') { res.writeHead(404); res.end('NOT_FOUND'); } else { res.writeHead(200); res.end(good); } });
  const r = await run(url); s.close();
  assert.equal(r.code, 1);
  assert.match(r.out, /status=404/);
});

test('vercel.json keeps the root rewrite to football-game.html (root route compatibility)', () => {
  const v = JSON.parse(fs.readFileSync(path.join(REPO, 'vercel.json'), 'utf8'));
  assert.deepEqual(v.rewrites, [{ source: '/', destination: '/football-game.html' }]);
});
