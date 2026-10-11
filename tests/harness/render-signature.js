'use strict';
/* Draw-call "signature" of the toy-style player renderer.
 * We run the game's real drawPlayer() against a recording canvas context and capture every
 * method call and property assignment, with numbers rounded. This proves the drawing
 * INSTRUCTIONS are unchanged. It does not prove rasterised pixels (that needs a real browser). */
const crypto = require('node:crypto');
const { loadGame } = require('./load-game');

const SIGNATURE_VERSION = 1;
const ROUND = 1e4;
const rnd = (v) => (typeof v === 'number' ? Math.round(v * ROUND) / ROUND : v);

function makeRecordingContext() {
  const calls = [];
  let gradients = 0;
  const props = {};
  const ser = (v) => (v && typeof v === 'object' && v.__gradient ? `gradient#${v.__gradient}` : rnd(v));
  const proxy = new Proxy(props, {
    get(t, k) {
      if (typeof k === 'symbol') return undefined;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') {
        return (...args) => {
          const id = ++gradients;
          calls.push([String(k), ...args.map(rnd)]);
          return { __gradient: id, addColorStop: (o, c) => calls.push([`gradient#${id}.addColorStop`, rnd(o), c]) };
        };
      }
      if (k === 'measureText') return () => ({ width: 10 });
      if (k in t) return t[k];
      return (...args) => { calls.push([String(k), ...args.map(ser)]); };
    },
    set(t, k, v) { t[k] = v; calls.push([`set:${String(k)}`, ser(v)]); return true; },
  });
  return { ctx: proxy, calls };
}

// Fixed, representative inputs: two colour schemes (one with a white secondary, which takes a
// different branch), outfield + goalkeeper on each side, one controlled, one stunned.
const CASES = [
  { name: 'home-outfield-controlled', p: { id: 'sig-h1', x: 200, y: 300, isHome: true, isGK: false, number: 9, facing: 0, vx: 0, vy: 0, team: { primary: '#cc0000', secondary: '#ffffff' } }, controlled: true },
  { name: 'home-goalkeeper', p: { id: 'sig-h2', x: 120, y: 520, isHome: true, isGK: true, number: 1, facing: 0, vx: 0, vy: 0, team: { primary: '#cc0000', secondary: '#ffffff' } }, controlled: false },
  { name: 'away-outfield-stunned', p: { id: 'sig-a1', x: 640, y: 260, isHome: false, isGK: false, number: 7, facing: Math.PI, vx: 0, vy: 0, stunned: 30, team: { primary: '#1e40af', secondary: '#fbbf24' } }, controlled: false },
  { name: 'away-goalkeeper', p: { id: 'sig-a2', x: 1500, y: 600, isHome: false, isGK: true, number: 13, facing: Math.PI, vx: 0, vy: 0, team: { primary: '#1e40af', secondary: '#fbbf24' } }, controlled: false },
];

function captureSignature(file) {
  const rec = makeRecordingContext();
  const g = loadGame({ file, ctx2d: rec.ctx, seed: 1 });
  const out = { signatureVersion: SIGNATURE_VERSION, cases: {} };
  for (const c of CASES) {
    rec.calls.length = 0;
    g.run(`(() => { const p = ${JSON.stringify(c.p)}; state.controlledId = ${c.controlled ? JSON.stringify(c.p.id) : 'null'}; drawPlayer(p); })()`);
    if (g.logs.error.length) throw new Error('drawPlayer threw: ' + g.logs.error[0]);
    out.cases[c.name] = rec.calls.map((x) => x.slice());
  }
  return out;
}

// Exact comparison. threshold = number of differing calls tolerated (0 for the base geometry).
function compareSignatures(expected, actual, threshold = 0) {
  const diffs = [];
  const names = new Set([...Object.keys(expected.cases), ...Object.keys(actual.cases)]);
  for (const n of names) {
    const a = expected.cases[n], b = actual.cases[n];
    if (!a || !b) { diffs.push({ case: n, index: -1, expected: !!a, actual: !!b, note: 'case missing' }); continue; }
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) diffs.push({ case: n, index: i, expected: a[i], actual: b[i] });
    }
  }
  return { differences: diffs.length, threshold, pass: diffs.length <= threshold, first: diffs.slice(0, 5) };
}

const hashSignature = (sig) => crypto.createHash('sha256').update(JSON.stringify(sig)).digest('hex');

module.exports = { captureSignature, compareSignatures, hashSignature, CASES, SIGNATURE_VERSION };
