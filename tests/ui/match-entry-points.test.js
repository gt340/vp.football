'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness(overrides = {}) {
  const buttons = new Map(['btn-quick-match', 'btn-custom-match', 'btn-custom-back'].map((id) => [id, { onclick: null }]));
  const teams = [{ id: 'home' }, { id: 'away' }, { id: 'third' }];
  const players = [{ id: 1, pos: 'GK' }, { id: 2, pos: 'GK' }, { id: 3, pos: 'DF' }, { id: 4, pos: 'DF' }, { id: 5, pos: 'MF' }, { id: 6, pos: 'MF' }, { id: 7, pos: 'FW' }, { id: 8, pos: 'FW' }, { id: 9, pos: 'FW' }, { id: 10, pos: 'DF' }, { id: 11, pos: 'MF' }];
  const transitions = { MENU: ['SQUAD_SELECTION'], SQUAD_SELECTION: ['PRE_MATCH'], PRE_MATCH: ['PLAYING'] };
  const gameState = { current: overrides.current || 'MENU', is(next) { return this.current === next; }, transition(next) { if (!(transitions[this.current] || []).includes(next)) return false; this.current = next; return true; } };
  const state = { homeTeam: teams[0], awayTeam: teams[1], teamSize: 7, duration: 180, selectedPlayerIds: [], ...(overrides.state || {}) };
  let starts = 0, audioEnsures = 0;
  const destinations = [];
  const context = {
    document: { getElementById: (id) => buttons.get(id) || null }, Game: { state: gameState },
    GameStates: { MENU: 'MENU', SQUAD_SELECTION: 'SQUAD_SELECTION', PRE_MATCH: 'PRE_MATCH' },
    MATCH_CONFIG: { teamSizes: [5, 7, 11], defaultTeamSize: 7, durations: [180, 300, 480], defaultDuration: 180 },
    TEAMS: teams, ALL_PLAYERS: players, state, AudioManager: { ensure() { audioEnsures++; } },
    ScreenRouter: { show(id) { destinations.push(id); } },
    startMatch() { starts++; gameState.current = 'PLAYING'; },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/ui/match-entry-points.js'), 'utf8');
  vm.runInNewContext(source, context);
  return { buttons, state, gameState, destinations, get starts() { return starts; }, get audioEnsures() { return audioEnsures; } };
}
test('Quick Match selects a valid squad and starts immediately', () => {
  const h = harness();
  assert.equal(h.buttons.get('btn-quick-match').onclick(), true);
  assert.deepEqual(Array.from(h.state.selectedPlayerIds), [1, 3, 4, 5, 6, 7, 8]);
  assert.equal(h.gameState.current, 'PLAYING');
  assert.equal(h.starts, 1);
  assert.equal(h.audioEnsures, 1);
  assert.deepEqual(h.destinations, []);
});
test('Quick Match respects team size and repairs duplicate team selection', () => {
  const h = harness({ state: { teamSize: 5, homeTeam: { id: 'home' }, awayTeam: { id: 'home' } } });
  assert.equal(h.buttons.get('btn-quick-match').onclick(), true);
  assert.equal(h.state.selectedPlayerIds.length, 5);
  assert.notEqual(h.state.homeTeam.id, h.state.awayTeam.id);
  assert.equal(h.starts, 1);
});
test('Quick Match refuses to start outside the menu state', () => {
  const h = harness({ current: 'PLAYING' });
  assert.equal(h.buttons.get('btn-quick-match').onclick(), false);
  assert.equal(h.starts, 0);
  assert.deepEqual(Array.from(h.state.selectedPlayerIds), []);
});
test('Custom Match opens setup and its back button returns home', () => {
  const h = harness();
  h.buttons.get('btn-custom-match').onclick();
  h.buttons.get('btn-custom-back').onclick();
  assert.deepEqual(h.destinations, ['custom-match-screen', 'menu-screen']);
  assert.equal(h.starts, 0);
});
