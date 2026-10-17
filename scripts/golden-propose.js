#!/usr/bin/env node
'use strict';
/*
 * Captures a player-renderer draw-call signature from football-game.html and writes it as a CANDIDATE:
 *   tests/golden/player-base.v1.candidate.json
 * It never writes or replaces the approved baseline (tests/golden/player-base.v1.json).
 * Promoting a candidate is a deliberate, reviewed commit that needs explicit Commander approval.
 */
const fs = require('node:fs');
const path = require('node:path');
const { captureSignature, hashSignature } = require('../tests/harness/render-signature');

const root = path.join(__dirname, '..');
const candidatePath = path.join(root, 'tests', 'golden', 'player-base.v1.candidate.json');
const sig = captureSignature(path.join(root, 'football-game.html'));
const doc = { golden: 'player-base', status: 'CANDIDATE_NOT_APPROVED', signatureSha256: hashSignature(sig), ...sig };
fs.writeFileSync(candidatePath, JSON.stringify(doc, null, 1) + '\n');
console.log('wrote candidate (NOT approved): ' + path.relative(root, candidatePath) + ' signatureSha256=' + doc.signatureSha256);
