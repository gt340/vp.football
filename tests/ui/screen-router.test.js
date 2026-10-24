'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function harness() {
  const attributes = new Map();
  const screens = ['menu-screen', 'players-screen', 'result-screen', 'custom-match-screen'].map((id) => {
    const classes = new Set(['screen']);
    if (id !== 'menu-screen') classes.add('hidden');
    return {
      id,
      classList: {
        contains: (name) => classes.has(name),
        toggle: (name, force) => {
          const enabled = force === undefined ? !classes.has(name) : Boolean(force);
          if (enabled) classes.add(name); else classes.delete(name);
          return enabled;
        },
      },
      setAttribute: (key, value) => attributes.set(id + ':' + key, value),
      hasClass: (name) => classes.has(name),
      attribute: (key) => attributes.get(id + ':' + key),
    };
  });
  const byId = new Map(screens.map((screen) => [screen.id, screen]));
  const document = {
    getElementById: (id) => byId.get(id) || null,
    querySelectorAll: (selector) => selector === '.screen' ? screens : [],
  };
  const source = fs.readFileSync(path.join(__dirname, '../../src/ui/screen-router.js'), 'utf8');
  const router = vm.runInNewContext(source + '\nScreenRouter;', { document });
  return { router, screens };
}

test('initializes the menu as the only visible screen', () => {
  const { router, screens } = harness();
  assert.equal(router.current(), 'menu-screen');
  assert.equal(screens[0].hasClass('hidden'), false);
  assert.equal(screens[0].attribute('aria-hidden'), 'false');
  for (const screen of screens.slice(1)) {
    assert.equal(screen.hasClass('hidden'), true);
    assert.equal(screen.attribute('aria-hidden'), 'true');
  }
});

test('switches screens exclusively and reports the active screen', () => {
  const { router, screens } = harness();
  assert.equal(router.show('players-screen'), 'players-screen');
  assert.equal(router.current(), 'players-screen');
  assert.equal(screens[0].hasClass('hidden'), true);
  assert.equal(screens[1].hasClass('hidden'), false);
  assert.equal(screens[2].hasClass('hidden'), true);
  assert.equal(router.show('result-screen'), 'result-screen');
  assert.equal(screens[1].hasClass('hidden'), true);
  assert.equal(screens[2].hasClass('hidden'), false);
});

test('can hide all screens while the match is active', () => {
  const { router, screens } = harness();
  assert.equal(router.show(null), null);
  assert.equal(router.current(), null);
  assert.ok(screens.every((screen) => screen.hasClass('hidden')));
});

test('rejects unknown screen targets without changing the active screen', () => {
  const { router } = harness();
  assert.throws(() => router.show('missing-screen'), /unknown screen/);
  assert.equal(router.current(), 'menu-screen');
});

test('registers and navigates to the custom match screen', () => {
  const { router, screens } = harness();
  assert.equal(router.show('custom-match-screen'), 'custom-match-screen');
  assert.equal(screens[3].hasClass('hidden'), false);
  assert.equal(screens[3].attribute('aria-hidden'), 'false');
  assert.equal(screens[0].hasClass('hidden'), true);
});
