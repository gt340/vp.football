'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, scan, countEvents, playMatch } = require('../harness/game-api');

// Full-length AI-vs-AI matches (the human side is idle). Seeds are fixed, so results are repeatable.
for (const size of [5, 7, 11]) {
  test(`${size}v${size}: a full match reaches full time with zero NaN/invalid state/errors/warnings`, () => {
    const g = boot(size, { seed: 11 + size });
    const events = countEvents(g);
    const r = playMatch(g, { maxFrames: 20000 });
    assert.equal(r.finished, true, `match did not finish within ${r.frames} frames`);
    assert.deepEqual(r.problems, []);
    assert.equal(g.run('state.matchPeriod'), 'FULL_TIME');
    assert.deepEqual(g.logs.error, []);
    assert.deepEqual(g.logs.warn, []);
    assert.deepEqual(scan(g), []);
    const e = events();
    // Observed (not guaranteed by football): restarts occurred during the match.
    assert.ok((e.throwIn || 0) + (e.goalKick || 0) + (e.corner || 0) > 0, 'expected at least one restart event');
    assert.ok(Number.isInteger(g.run('state.scoreHome')) && Number.isInteger(g.run('state.scoreAway')));
  });
}

test('stress 11v11: sprint/dribble/pass/shoot/tackle/switch/substitute/red card all at once, no crash', () => {
  const g = boot(11, { seed: 99 });
  const problems = [];
  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space'];
  for (let f = 0; f < 6000; f++) {
    if (f % 17 === 0) g.run(`(() => { for (const k of ${JSON.stringify(keys)}) InputManager.keys[k] = Math.random() < 0.4; })()`);
    if (f % 40 === 0) g.run(`(() => { const c = getControlled(); if (!c) return; const r = Math.random();
      try { if (r < 0.2) doPass(c, false, false); else if (r < 0.3) doPass(c, true, true); else if (r < 0.45) doShoot(c, true, Math.random()); else if (r < 0.6) doTackle(c); }
      catch (e) { console.error(e.stack); } })()`);
    if (f % 700 === 350) g.run(`(() => { const home = Math.random() < 0.5; const on = home ? state.homePlayers : state.awayPlayers, bn = home ? state.homeBench : state.awayBench;
      const o = on.find(p => !p.isGK && p.id !== state.controlledId && !p.discipline.sentOff), i = bn.find(p => p.pos !== 'GK'); if (o && i) SubstitutionManager.request(home, o.id, i.id); })()`);
    if (f === 2500 || f === 4200) g.run(`(() => { const v = state.awayPlayers.find(p => !p.isGK && !p.discipline.sentOff); if (v) RefereeSystem.issueCard(v, 'red', null); })()`);
    g.frames(1);
    if (f % 20 === 0) { const p = scan(g); if (p.length) { problems.push(...p.slice(0, 2)); if (problems.length > 5) break; } }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(g.logs.error, []);
  assert.deepEqual(g.logs.warn, []);
});

test('timers do not grow without bound over a long run (no runaway timers)', () => {
  const g = boot(7, { seed: 5 });
  g.frames(3000);
  assert.ok(g.pendingTimers() < 50, 'pending timers: ' + g.pendingTimers());
});
