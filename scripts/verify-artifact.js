#!/usr/bin/env node
'use strict';
/*
 * Read-only HTTP check that served pages are byte-identical to an expected artifact.
 *   node scripts/verify-artifact.js [--base-url https://v-p-football.vercel.app] [--sha256 <hex>] [--bytes <n>] [--paths /,/football-game.html]
 * Defaults to the recorded baseline in tests/fixtures/baseline.json. Performs GET requests only. Needs network.
 * Exit code 0 only if every path returns 200 with the expected SHA-256 (and byte count).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'baseline.json'), 'utf8'));
const baseUrl = opt('--base-url', 'https://v-p-football.vercel.app').replace(/\/+$/, '');
const expectedSha = opt('--sha256', baseline.sha256);
const expectedBytes = Number(opt('--bytes', baseline.bytes));
const paths = opt('--paths', '/,/football-game.html').split(',');

(async () => {
  let failed = false;
  for (const p of paths) {
    const url = baseUrl + p;
    try {
      const res = await fetch(url, { redirect: 'manual' });
      const body = Buffer.from(await res.arrayBuffer());
      const sha = crypto.createHash('sha256').update(body).digest('hex');
      const ok = res.status === 200 && sha === expectedSha && body.length === expectedBytes;
      if (!ok) failed = true;
      console.log(`${ok ? 'PASS' : 'FAIL'} ${url} status=${res.status} bytes=${body.length} sha256=${sha}`);
    } catch (e) {
      failed = true;
      console.log(`FAIL ${url} ${e.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
})();
