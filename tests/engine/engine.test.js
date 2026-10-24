'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { boot, scan, fingerprint } = require('../harness/game-api');

const SIZES = [5, 7, 11];

test('pitch configuration: full 1800x1208, playable 1680x1088, 105:68, geometry validates', () => {
  const g = boot(5);
  assert.equal(g.run('PITCH.w'), 1800);
  assert.equal(g.run('PITCH.h'), 1208);
  assert.equal(g.run('PITCH_CONFIG.playableLength'), 1680);
  assert.equal(g.run('PITCH_CONFIG.playableWidth'), 1088);
  assert.ok(Math.abs(1680 / 1088 - 105 / 68) < 0.002);
  assert.equal(g.run('validatePitchGeometry().length'), 0);
});

for (const size of SIZES) {
  test(`${size}v${size}: correct squad sizes, clean state after 600 frames, no errors or warnings`, () => {
    const g = boot(size, { seed: 40 + size });
    assert.equal(g.run('state.homePlayers.length'), size);
    assert.equal(g.run('state.awayPlayers.length'), size);
    assert.equal(g.run('state.homePlayers.filter(p => p.isGK).length'), 1);
    g.frames(600);
    assert.deepEqual(scan(g), []);
    assert.deepEqual(g.logs.error, []);
    assert.deepEqual(g.logs.warn, []);
  });
  test(`${size}v${size}: players stay inside the pitch and the ball owner is always valid`, () => {
    const g = boot(size, { seed: 50 + size });
    for (let i = 0; i < 400; i++) {
      g.frames(1);
      assert.equal(g.run('allPlayers().every(p => p.x >= 0 && p.x <= PITCH.w && p.y >= 0 && p.y <= PITCH.h)'), true, 'player left the pitch at frame ' + i);
      assert.equal(g.run('state.ball.ownerId == null || !!findPlayerById(state.ball.ownerId)'), true);
    }
  });
}

test('tactics: every formation has 11 slots and exactly one goalkeeper, with coordinates in range', () => {
  const g = boot(11);
  const rows = g.run('Object.entries(FORMATIONS).map(([k, f]) => ({ k, n: f.slots.length, gk: f.slots.filter(s => s.role === "GK").length, ok: f.slots.every(s => s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1) }))');
  assert.ok(rows.length >= 5);
  for (const r of rows) { assert.equal(r.n, 11, r.k); assert.equal(r.gk, 1, r.k); assert.equal(r.ok, true, r.k); }
});

for (const size of SIZES) {
  test(`tactics ${size}v${size}: roles assigned, goalkeepers present, TacticalSystem.validate reports no issues`, () => {
    const g = boot(size, { seed: 7 });
    g.frames(120);
    assert.deepEqual(g.run('TacticalSystem.validate(state.homePlayers)'), []);
    assert.deepEqual(g.run('TacticalSystem.validate(state.awayPlayers)'), []);
    assert.equal(g.run('state.homePlayers.every(p => typeof p.role === "string" && p.role.length > 0)'), true);
    // KNOWN BASELINE QUIRK (documented, not changed in R0): the away side is filled from the leftover player
    // pool, so it can contain several goalkeeper-position players (some playing outfield roles). We only
    // require at least one goalkeeper here; fixing squad composition belongs to a later phase.
    assert.ok(g.run('state.awayPlayers.filter(p => p.isGK).length') >= 1);
  });
}

test('tactics: changing formation, mentality and style mid-match keeps the match stable', () => {
  const g = boot(11, { seed: 9 });
  g.frames(60);
  g.run(`(() => { state.homeTactics.formationId = '4-4-2'; state.homeTactics.mentality = 'ATTACKING'; state.homeTactics.style = 'COUNTER'; })()`);
  g.frames(600);
  assert.deepEqual(scan(g), []);
  assert.deepEqual(g.logs.error, []);
});

test('rules: a second yellow card becomes a red card and sends the player off', () => {
  const g = boot(7, { seed: 3 });
  const r = g.run(`(() => { const v = state.awayPlayers.find(p => !p.isGK); RefereeSystem.issueCard(v, 'yellow', null); const a = v.discipline.sentOff; RefereeSystem.issueCard(v, 'yellow', null); return { afterFirst: a, sentOff: v.discipline.sentOff, red: v.discipline.redCard }; })()`);
  assert.equal(r.afterFirst, false);
  assert.equal(r.sentOff, true);
  assert.equal(r.red, true);
});

test('sent-off player: never owns the ball, is never controlled, and play continues cleanly', () => {
  const g = boot(7, { seed: 4 });
  g.frames(30);
  g.run(`(() => { const v = state.homePlayers.find(p => !p.isGK && p.id !== state.controlledId); window.__off = v.id; RefereeSystem.issueCard(v, 'red', null); })()`);
  for (let i = 0; i < 900; i++) {
    g.frames(1);
    if (i % 30 === 0) {
      assert.deepEqual(scan(g), []);
      assert.equal(g.run('state.ball.ownerId !== __off && getControlled().id !== __off'), true);
    }
  }
});

test('sent-off controlled player: control passes to a valid player', () => {
  const g = boot(7, { seed: 5 });
  g.frames(20);
  g.run('RefereeSystem.issueCard(getControlled(), "red", null)');
  g.frames(120);
  assert.deepEqual(scan(g), []);
});

test('substitutions: limit is enforced, bench/pitch swap, no stale ownership', () => {
  const g = boot(11, { seed: 6 });
  g.frames(30);
  const max = g.run('SQUAD_CONFIG.maxSubstitutions');
  let ok = 0;
  for (let i = 0; i < max + 3; i++) {
    const r = g.run(`(() => {
      const out = state.homePlayers.find(p => !p.isGK && p.id !== state.controlledId && !p.discipline.sentOff);
      const inn = state.homeBench.find(p => p.pos !== 'GK');
      if (!out || !inn) return { ok: false, reason: 'none available' };
      return SubstitutionManager.request(true, out.id, inn.id);
    })()`);
    if (r.ok) ok++;
    g.frames(8);
  }
  assert.ok(ok >= 1, 'at least one substitution succeeded');
  assert.ok(ok <= max, `limit exceeded: ${ok} > ${max}`);
  assert.deepEqual(scan(g), []);
  assert.equal(g.run('state.homePlayers.length'), 11);
});

test('stamina: stays finite and within bounds under sustained sprinting, and drains', () => {
  const g = boot(7, { seed: 8 });
  const before = g.run('getControlled().squadStatus.stamina');
  g.run('InputManager.keys["ShiftLeft"] = true; InputManager.keys["KeyD"] = true;');
  for (let i = 0; i < 1500; i++) { g.frames(1); if (i % 50 === 0) assert.deepEqual(scan(g), []); }
  const after = g.run('getControlled().squadStatus.stamina');
  assert.ok(Number.isFinite(after) && after >= 0 && after <= 100);
  assert.ok(after < before, `stamina should drain while sprinting (${before} -> ${after})`);
});

test('integrity: the detector flags NaN and a dangling owner, and the game repairs bad numbers', () => {
  const g = boot(5, { seed: 11 });
  g.run('state.ball.x = NaN');
  assert.ok(scan(g).length > 0, 'scan must flag a NaN ball');
  g.frames(2);
  assert.deepEqual(scan(g), [], 'sanitizeAllEntities should repair NaN on the next frames');
  g.run('state.ball.ownerId = "no-such-player"');
  assert.ok(scan(g).some((s) => /does not exist/.test(s)), 'scan must flag a dangling owner');
});

test('repeatability: the same seed gives an identical simulation; different seeds differ', () => {
  const run = (seed) => { const g = boot(7, { seed }); g.frames(1500); return fingerprint(g); };
  assert.equal(run(123), run(123));
  assert.notEqual(run(123), run(124));
});


test('R1-6: forgiving ball pickup radius grants possession at the configured edge', () => {
  const g = boot(7, { seed: 61 });
  const result = g.run(`(() => {
    const p = getControlled();
    for (const other of activePlayers()) {
      if (other.id !== p.id) { other.x = 100; other.y = 100; }
    }
    p.x = 900; p.y = 600;
    state.ball.x = p.x + BALL_CONTROL_CONFIG.possessionRadius - 1;
    state.ball.y = p.y;
    state.ball.vx = 0; state.ball.vy = 0;
    state.ball.ownerId = null; state.ball.aerial = false;
    updateBallControl(1);
    return { ownerId: state.ball.ownerId, playerId: p.id, radius: BALL_CONTROL_CONFIG.possessionRadius };
  })()`);
  assert.equal(result.ownerId, result.playerId);
  assert.ok(result.radius > 20 * g.run('WORLD_RADIAL_SCALE'));
});

test('R1-6: passing is accepted near the extended mobile-friendly action range', () => {
  const g = boot(7, { seed: 62 });
  const result = g.run(`(() => {
    const p = getControlled();
    const mates = state.homePlayers.filter(v => v.id !== p.id && !v.discipline.sentOff);
    for (const other of mates) { other.x = 100; other.y = 100; }
    const target = mates[0];
    p.x = 500; p.y = 500; p.facing = 0; p.cooldown = 0;
    target.x = 800; target.y = 500;
    state.ball.x = p.x + p.r + state.ball.r + PLAYER_CONFIG.passRange - 1;
    state.ball.y = p.y; state.ball.vx = 0; state.ball.vy = 0;
    state.ball.ownerId = p.id;
    doPass(p, false, false);
    return { cooldown: p.cooldown, expected: PLAYER_CONFIG.passCooldown, vx: state.ball.vx };
  })()`);
  assert.equal(result.cooldown, result.expected);
  assert.ok(result.vx > 0, 'pass should propel the ball toward the teammate');
});
