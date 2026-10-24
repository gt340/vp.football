'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness(current = 'MENU') {
  const ids = ['btn-to-tactics', 'btn-tactics-back', 'btn-settings', 'btn-settings-back'];
  const buttons = new Map(ids.map((id) => [id, { onclick: null }]));
  const transitions = { MENU: ['SETTINGS'], SETTINGS: ['MENU'] };
  const gameState = {
    current,
    is(next) { return this.current === next; },
    transition(next) {
      if (!(transitions[this.current] || []).includes(next)) return false;
      this.current = next;
      return true;
    },
  };
  const routes = [];
  const context = {
    document: { getElementById: (id) => buttons.get(id) || null },
    Game: { state: gameState },
    GameStates: { MENU: 'MENU', SETTINGS: 'SETTINGS' },
    ScreenRouter: { show(id) { routes.push(id); } },
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/ui/setup-navigation.js'), 'utf8');
  vm.runInNewContext(source, context);
  return { buttons, gameState, routes };
}

test('setup flow separates match setup and tactics without changing game state', () => {
  const h = harness();
  assert.equal(h.buttons.get('btn-to-tactics').onclick(), true);
  assert.deepEqual(h.routes, ['tactics-screen']);
  assert.equal(h.buttons.get('btn-tactics-back').onclick(), true);
  assert.deepEqual(h.routes, ['tactics-screen', 'custom-match-screen']);
  assert.equal(h.gameState.current, 'MENU');
});

test('Settings transitions MENU -> SETTINGS and back to MENU', () => {
  const h = harness();
  assert.equal(h.buttons.get('btn-settings').onclick(), true);
  assert.equal(h.gameState.current, 'SETTINGS');
  assert.deepEqual(h.routes, ['settings-screen']);
  assert.equal(h.buttons.get('btn-settings-back').onclick(), true);
  assert.equal(h.gameState.current, 'MENU');
  assert.deepEqual(h.routes, ['settings-screen', 'menu-screen']);
});

test('navigation refuses entry when game state is not appropriate', () => {
  const h = harness('PLAYING');
  assert.equal(h.buttons.get('btn-to-tactics').onclick(), false);
  assert.equal(h.buttons.get('btn-settings').onclick(), false);
  assert.equal(h.buttons.get('btn-tactics-back').onclick(), false);
  assert.equal(h.buttons.get('btn-settings-back').onclick(), false);
  assert.deepEqual(h.routes, []);
  assert.equal(h.gameState.current, 'PLAYING');
});

test('Settings screen exposes the existing sound toggle and no extra preference controls', () => {
  const body = fs.readFileSync(path.join(__dirname, '../../src/shell/body.html'), 'utf8');
  const start = body.indexOf('<div id="settings-screen"');
  const end = body.indexOf('</div>', start);
  assert.ok(start >= 0 && end > start);
  const screen = body.slice(start, end);
  assert.match(screen, /id="sound-toggle"/);
  assert.match(screen, /id="btn-settings-back"/);
  assert.doesNotMatch(screen, /checkbox|select|range|volume-slider/i);
});
