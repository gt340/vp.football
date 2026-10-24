'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadGame } = require('../harness/load-game');

function click(g, id) {
  return g.run(`document.getElementById(${JSON.stringify(id)}).onclick()`);
}

function prepareCustomMatch(g, { teamSize = 7, duration = 300 } = {}) {
  assert.equal(click(g, 'btn-custom-match'), undefined);
  assert.equal(g.run('ScreenRouter.current()'), 'custom-match-screen');
  g.run(`state.teamSize = ${teamSize}; state.duration = ${duration};`);
  assert.equal(click(g, 'btn-to-tactics'), true);
  assert.equal(g.run('ScreenRouter.current()'), 'tactics-screen');
}

test('Custom Match completes setup -> tactics -> squad -> kickoff with selections intact', () => {
  const g = loadGame({ seed: 17 });
  prepareCustomMatch(g, { teamSize: 7, duration: 300 });

  const chosen = g.run(`(() => {
    state.homeTeam = TEAMS[2];
    state.awayTeam = TEAMS.find(t => t.id !== state.homeTeam.id);
    state.homeTactics.formationId = '4-4-2';
    state.homeTactics.mentality = 'ATTACKING';
    state.homeTactics.style = 'PRESSING';
    return {
      home: state.homeTeam.id, away: state.awayTeam.id,
      formation: state.homeTactics.formationId,
      mentality: state.homeTactics.mentality, style: state.homeTactics.style
    };
  })()`);

  assert.equal(click(g, 'btn-tactics-back'), true);
  assert.equal(g.run('ScreenRouter.current()'), 'custom-match-screen');
  assert.equal(g.run('state.teamSize'), 7);
  assert.equal(g.run('state.duration'), 300);
  assert.equal(click(g, 'btn-to-tactics'), true);
  assert.equal(g.run('ScreenRouter.current()'), 'tactics-screen');
  assert.deepEqual(g.run(`({
    home: state.homeTeam.id, away: state.awayTeam.id,
    formation: state.homeTactics.formationId,
    mentality: state.homeTactics.mentality, style: state.homeTactics.style
  })`), chosen);

  assert.equal(click(g, 'btn-to-players'), undefined);
  assert.equal(g.run('Game.state.current'), 'SQUAD_SELECTION');
  assert.equal(g.run('ScreenRouter.current()'), 'players-screen');
  assert.equal(g.run('state.selectedPlayerIds.length'), 7);
  assert.equal(g.run('state.selectedPlayerIds.some(id => ALL_PLAYERS.find(p => p.id === id)?.pos === "GK")'), true);

  click(g, 'btn-kickoff');
  assert.equal(g.run('Game.state.current'), 'PLAYING');
  assert.equal(g.run('state.running'), true);
  assert.equal(g.run('state.match.matchDuration'), 300);
  assert.equal(g.run('state.match.homeTeam.id'), chosen.home);
  assert.equal(g.run('state.match.awayTeam.id'), chosen.away);
  assert.equal(g.run('state.homePlayers.length'), 7);
  assert.equal(g.run('state.awayPlayers.length'), 7);
  assert.equal(g.run('state.homeTactics.formationId'), '4-4-2');
  assert.equal(g.run('state.homeTactics.mentality'), 'ATTACKING');
  assert.equal(g.run('state.homeTactics.style'), 'PRESSING');
});

for (const teamSize of [5, 7, 11]) {
  test(`Custom Match starts a valid ${teamSize}v${teamSize} squad`, () => {
    const g = loadGame({ seed: 100 + teamSize });
    prepareCustomMatch(g, { teamSize, duration: 180 });
    assert.equal(click(g, 'btn-to-players'), undefined);
    assert.equal(g.run('state.selectedPlayerIds.length'), teamSize);
    assert.equal(g.run('state.selectedPlayerIds.some(id => ALL_PLAYERS.find(p => p.id === id)?.pos === "GK")'), true);
    click(g, 'btn-kickoff');
    assert.equal(g.run('Game.state.current'), 'PLAYING');
    assert.equal(g.run('state.homePlayers.length'), teamSize);
    assert.equal(g.run('state.awayPlayers.length'), teamSize);
  });
}

test('kickoff refuses a squad with the wrong player count', () => {
  const g = loadGame({ seed: 31 });
  prepareCustomMatch(g, { teamSize: 5 });
  click(g, 'btn-to-players');
  g.run('state.selectedPlayerIds = state.selectedPlayerIds.slice(0, 4)');
  click(g, 'btn-kickoff');
  assert.equal(g.run('Game.state.current'), 'SQUAD_SELECTION');
  assert.equal(g.run('state.running'), false);
  assert.equal(g.run('state.match'), null);
});

test('kickoff refuses a full squad that has no goalkeeper', () => {
  const g = loadGame({ seed: 32 });
  prepareCustomMatch(g, { teamSize: 5 });
  click(g, 'btn-to-players');
  g.run('state.selectedPlayerIds = ALL_PLAYERS.filter(p => p.pos !== "GK").slice(0, state.teamSize).map(p => p.id)');
  click(g, 'btn-kickoff');
  assert.equal(g.run('Game.state.current'), 'SQUAD_SELECTION');
  assert.equal(g.run('state.running'), false);
  assert.equal(g.run('state.match'), null);
});
