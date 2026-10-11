'use strict';
/* Loads a built football-game.html's inline <script> into an isolated vm context with:
 *  - a seeded PRNG replacing Math.random (deterministic)
 *  - a fake millisecond clock (performance.now / Date.now) and fake timers
 *  - stubbed DOM/canvas (see fake-dom.js)
 * The game's top-level const/let live in the context's global lexical scope, so run('state') etc. work. */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { makeNoopContext, makeDocument } = require('./fake-dom');

const DEFAULT_FILE = path.resolve(__dirname, '..', '..', 'football-game.html');

function extractScript(html) {
  const a = html.indexOf('<script>');
  const b = html.lastIndexOf('</script>');
  if (a < 0 || b < a) throw new Error('no inline <script> found');
  return html.slice(a + '<script>'.length, b);
}

function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadGame(opts = {}) {
  const file = opts.file || DEFAULT_FILE;
  const script = extractScript(fs.readFileSync(file, 'utf8'));
  const logs = { error: [], warn: [], info: [] };
  let clock = 1_000_000;
  const random = mulberry32(opts.seed === undefined ? 1 : opts.seed);
  const timers = [];
  let timerSeq = 0;
  const store = {};

  const FakeMath = {};
  for (const k of Object.getOwnPropertyNames(Math)) FakeMath[k] = Math[k];
  FakeMath.random = random;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock])); }
    static now() { return clock; }
  }

  const ctx2d = opts.ctx2d || makeNoopContext();
  const sandbox = {
    console: {
      log() {}, info() {}, debug() {},
      warn: (...a) => logs.warn.push(a.map(String).join(' ')),
      error: (...a) => logs.error.push(a.map((x) => (x && x.stack) || String(x)).join(' ')),
    },
    document: makeDocument(ctx2d),
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    performance: { now: () => clock },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    setTimeout: (fn, ms) => { const id = ++timerSeq; timers.push({ id, at: clock + (ms || 0), fn }); return id; },
    clearTimeout: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: (fn, ms) => { const id = ++timerSeq; timers.push({ id, at: clock + ms, fn, every: ms }); return id; },
    clearInterval: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
    Math: FakeMath, Date: FakeDate,
    devicePixelRatio: 1, navigator: { vibrate() {}, userAgent: 'headless' },
    AudioContext: undefined, webkitAudioContext: undefined,
  };
  sandbox.window = new Proxy(sandbox, {
    get(t, k) {
      if (k === 'innerWidth') return 1280;
      if (k === 'innerHeight') return 720;
      if (k === 'addEventListener' || k === 'removeEventListener') return () => {};
      if (k === 'speechSynthesis') return undefined;
      return t[k];
    },
    set(t, k, v) { t[k] = v; return true; },
  });
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  new vm.Script(script, { filename: path.basename(file) }).runInContext(context);

  // Objects/arrays created inside the vm have a different realm's prototypes; return plain
  // JSON-safe copies so assertions (deepEqual) behave. Non-cloneable results are returned as-is.
  const run = (code) => {
    const v = vm.runInContext(code, context);
    if (v && typeof v === 'object') { try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; } }
    return v;
  };
  function advanceTimers(ms) {
    clock += ms;
    let guard = 0;
    for (;;) {
      const due = timers.filter((t) => t.at <= clock).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due || guard++ > 1000) break;
      if (due.every) due.at += due.every; else timers.splice(timers.indexOf(due), 1);
      try { due.fn(); } catch (e) { logs.error.push('timer: ' + (e && e.stack || e)); }
    }
  }
  // Advance n simulated frames (~60 fps) through the game's real loop(timestamp).
  function frames(n = 1) {
    for (let i = 0; i < n; i++) { advanceTimers(1000 / 60); run('loop(' + clock + ')'); }
  }
  return { run, frames, logs, advanceTimers, random, get clock() { return clock; }, pendingTimers: () => timers.length, file };
}

module.exports = { loadGame, extractScript, DEFAULT_FILE };
