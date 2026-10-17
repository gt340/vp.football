'use strict';
/* Thin helpers over the game's own globals. Only reads/uses existing game APIs. */
const crypto = require('node:crypto');
const { loadGame } = require('./load-game');

function boot(size, opts = {}) {
  const g = loadGame(opts);
  g.run(`(() => {
    state.teamSize = ${size};
    const gk = ALL_PLAYERS.find(p => p.pos === 'GK');
    const rest = ALL_PLAYERS.filter(p => p.pos !== 'GK').slice(0, ${size} - 1);
    state.selectedPlayerIds = [gk.id, ...rest.map(p => p.id)];
    Game.state.transition(GameStates.SQUAD_SELECTION);
    Game.state.transition(GameStates.PRE_MATCH);
  })()`);
  g.run('startMatch()');
  return g;
}

// Returns a list of integrity problems (empty = clean): NaN/Infinity, stamina bounds,
// invalid/stale ball ownership, sent-off owner/controlled player.
function scan(g) {
  return g.run(`(() => {
    const out = [];
    const fin = (v) => typeof v === 'number' && isFinite(v);
    const b = state.ball;
    for (const k of ['x', 'y', 'vx', 'vy']) if (!fin(b[k])) out.push('ball.' + k + '=' + b[k]);
    const everyone = [...state.homePlayers, ...state.awayPlayers, ...state.homeBench, ...state.awayBench];
    for (const p of everyone) {
      for (const k of ['x', 'y', 'vx', 'vy', 'facing']) if (!fin(p[k])) out.push(p.id + '.' + k + '=' + p[k]);
      const st = p.squadStatus && p.squadStatus.stamina;
      if (!fin(st) || st < 0 || st > STAMINA_CONFIG.max + 1e-9) out.push(p.id + '.stamina=' + st);
    }
    if (b.ownerId != null) {
      const o = findPlayerById(b.ownerId);
      if (!o) out.push('ball owner ' + b.ownerId + ' does not exist');
      else if (o.discipline && o.discipline.sentOff) out.push('ball owner ' + o.id + ' is sent off');
      else if (!activePlayers().includes(o)) out.push('ball owner ' + o.id + ' is not on the pitch');
    }
    const c = getControlled();
    if (!c) out.push('no controlled player'); else if (c.discipline && c.discipline.sentOff) out.push('controlled player is sent off');
    if (!fin(state.scoreHome) || !fin(state.scoreAway)) out.push('score is not finite');
    return out;
  })()`);
}

// A short hash of the simulation state (rounded), for repeatability checks.
function fingerprint(g) {
  const snap = g.run(`JSON.stringify((() => {
    const r = (v) => Math.round(v * 1e6) / 1e6;
    const all = [...state.homePlayers, ...state.awayPlayers, ...state.homeBench, ...state.awayBench];
    return {
      b: [r(state.ball.x), r(state.ball.y), r(state.ball.vx), r(state.ball.vy), state.ball.ownerId],
      p: all.map(p => [p.id, r(p.x), r(p.y), r(p.vx), r(p.vy), r(p.squadStatus.stamina)]),
      s: [state.scoreHome, state.scoreAway, state.matchPeriod],
    };
  })())`);
  return crypto.createHash('sha256').update(snap).digest('hex');
}

// Counts every GameEvents event seen from now on.
function countEvents(g) {
  g.run('window.__eventCounts = {}; for (const k of Object.values(GameEvents)) EventBus.on(k, () => { __eventCounts[k] = (__eventCounts[k] || 0) + 1; });');
  return () => JSON.parse(g.run('JSON.stringify(__eventCounts)'));
}

// Plays until the match ends (state.running false) or maxFrames. Scans periodically.
function playMatch(g, { maxFrames = 20000, scanEvery = 25, onFrame } = {}) {
  const problems = [];
  let n = 0;
  while (n < maxFrames && g.run('state.running')) {
    g.frames(1);
    n++;
    if (onFrame) onFrame(n);
    if (n % scanEvery === 0) { const p = scan(g); if (p.length) { problems.push(...p.slice(0, 3)); if (problems.length > 6) break; } }
  }
  return { frames: n, finished: !g.run('state.running'), problems };
}

module.exports = { boot, scan, fingerprint, countEvents, playMatch };
