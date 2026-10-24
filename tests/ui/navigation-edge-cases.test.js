'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness({ includeScreens = true } = {}) {
  const ids = [
    'menu-screen', 'custom-match-screen', 'tactics-screen',
    'settings-screen', 'players-screen', 'result-screen',
  ];
  const attributes = new Map();
  const screens = (includeScreens ? ids : []).map((id) => {
    const classes = new Set(['screen']);
    if (id !== 'menu-screen') classes.add('hidden');
    return {
      id,
      classList: {
        contains: (name) => classes.has(name),
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
      },
      setAttribute: (key, value) => attributes.set(id + ':' + key, value),
      isHidden: () => classes.has('hidden'),
      attr: (key) => attributes.get(id + ':' + key),
    };
  });
  const buttonIds = [
    'btn-quick-match', 'btn-custom-match', 'btn-custom-back',
    'btn-to-tactics', 'btn-tactics-back', 'btn-settings', 'btn-settings-back',
  ];
  const buttons = new Map(buttonIds.map((id) => [id, { onclick: null }]));
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  for (const [id, button] of buttons) byId.set(id, button);
  const transitions = { MENU: ['SETTINGS'], SETTINGS: ['MENU'] };
  const gameState = {
    current: 'MENU',
    is(next) { return this.current === next; },
    transition(next) {
      if (!(transitions[this.current] || []).includes(next)) return false;
      this.current = next;
      return true;
    },
  };
  const context = {
    document: {
      getElementById: (id) => byId.get(id) || null,
      querySelectorAll: (selector) => selector === '.screen' ? screens : [],
    },
    Game: { state: gameState },
    GameStates: { MENU: 'MENU', SETTINGS: 'SETTINGS' },
    state: {},
    TEAMS: [],
    ALL_PLAYERS: [],
    MATCH_CONFIG: { teamSizes: [5, 7, 11], durations: [180, 300], defaultTeamSize: 7, defaultDuration: 300 },
    AudioManager: { ensure() {} },
    startMatch() {},
  };
  for (const file of ['screen-router.js', 'setup-navigation.js', 'match-entry-points.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../../src/ui', file), 'utf8');
    vm.runInNewContext(file === 'screen-router.js' ? source + '\nthis.__router = ScreenRouter;' : source, context, { filename: file });
  }
  return { buttons, screens, gameState, context };
}

function click(h, id) {
  const button = h.buttons.get(id);
  assert.ok(button, `missing test button: ${id}`);
  assert.equal(typeof button.onclick, 'function', `missing click handler: ${id}`);
  return button.onclick();
}

function visibleScreen(h) {
  return h.screens.filter((screen) => !screen.isHidden()).map((screen) => screen.id);
}

test('Custom Match and tactics navigation remains exclusive through repeated back-and-forth visits', () => {
  const h = harness();
  assert.deepEqual(visibleScreen(h), ['menu-screen']);

  click(h, 'btn-custom-match');
  assert.deepEqual(visibleScreen(h), ['custom-match-screen']);
  assert.equal(h.gameState.current, 'MENU');

  click(h, 'btn-to-tactics');
  assert.deepEqual(visibleScreen(h), ['tactics-screen']);
  click(h, 'btn-tactics-back');
  assert.deepEqual(visibleScreen(h), ['custom-match-screen']);
  click(h, 'btn-to-tactics');
  assert.deepEqual(visibleScreen(h), ['tactics-screen']);

  click(h, 'btn-custom-back');
  assert.deepEqual(visibleScreen(h), ['menu-screen']);
  assert.equal(h.gameState.current, 'MENU');
  for (const screen of h.screens) {
    assert.equal(screen.attr('aria-hidden'), String(screen.isHidden()));
  }
});

test('Settings navigation returns to the menu without leaving a stale visible screen', () => {
  const h = harness();
  click(h, 'btn-settings');
  assert.equal(h.gameState.current, 'SETTINGS');
  assert.deepEqual(visibleScreen(h), ['settings-screen']);

  click(h, 'btn-settings-back');
  assert.equal(h.gameState.current, 'MENU');
  assert.deepEqual(visibleScreen(h), ['menu-screen']);
  assert.equal(h.screens.find((screen) => screen.id === 'settings-screen').attr('aria-hidden'), 'true');
});

test('navigation handlers reject actions when game state is not MENU or SETTINGS as required', () => {
  const h = harness();
  h.gameState.current = 'PLAYING';
  assert.equal(click(h, 'btn-to-tactics'), false);
  assert.equal(click(h, 'btn-tactics-back'), false);
  assert.equal(click(h, 'btn-settings'), false);
  assert.equal(click(h, 'btn-settings-back'), false);
  assert.deepEqual(visibleScreen(h), ['menu-screen']);
  assert.equal(h.gameState.current, 'PLAYING');
});

test('router no-ops safely when the simulation harness has no screen markup', () => {
  const h = harness({ includeScreens: false });
  assert.equal(h.context.__router.current(), null);
  assert.equal(h.context.__router.show('custom-match-screen'), null);
  assert.equal(h.context.__router.current(), null);
});

test('unknown screen targets fail closed without hiding the currently active screen', () => {
  const h = harness();
  assert.throws(() => h.context.__router.show('missing-screen'), /unknown screen/);
  assert.deepEqual(visibleScreen(h), ['menu-screen']);
  assert.equal(h.context.__router.current(), 'menu-screen');
});
