'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../src/input/touch-controls.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../../src/shell/styles.css'), 'utf8');

test('R1-6: field dragging can start movement without the fixed joystick zone', () => {
  assert.match(source, /gameCanvas\.addEventListener\('touchstart', fieldStart/);
  assert.match(source, /gameCanvas\.addEventListener\('mousedown', fieldStart/);
  assert.match(source, /function startStick\(x, y, source, e\)/);
  assert.match(source, /if \(source === 'field'\)/);
});

test('R1-6: movement continues outside the initial touch target', () => {
  assert.match(source, /window\.addEventListener\('touchmove', stickMove/);
  assert.match(source, /window\.addEventListener\('touchend', stickEnd/);
  assert.match(source, /window\.addEventListener\('touchcancel', stickEnd/);
  assert.match(source, /function pointForTouch\(list, id\)/);
  assert.match(source, /list\[i\]\.identifier === id/);
});

test('R1-6: releasing or cancelling a touch resets movement and restores joystick placement', () => {
  assert.match(source, /function resetStick\(\)/);
  assert.match(source, /InputManager\.stick\.dx = 0/);
  assert.match(source, /InputManager\.stick\.dy = 0/);
  assert.match(source, /stickZone\.style\.left = DEFAULT_STICK\.left/);
  assert.match(source, /window\.addEventListener\('blur'/);
});

test('R1-6: all five action buttons remain wired to their gameplay input keys', () => {
  for (const [id, key] of [
    ['btn-shoot', 'shoot'], ['btn-pass', 'pass'], ['btn-through', 'through'],
    ['btn-dash', 'dash'], ['btn-tackle', 'tackle'],
  ]) assert.ok(source.includes(`bindBtn('${id}', '${key}')`), id);
});

test('R1-6: tactics and match-menu controls have mobile-friendly touch targets', () => {
  assert.match(css, /#match-menu-toggle[\s\S]*?min-height: 42px/);
  assert.match(css, /\.mp-tab[\s\S]*?min-height: 44px/);
  assert.match(css, /\.opt-chip[\s\S]*?min-height: 42px/);
  assert.match(css, /#match-panel-close[\s\S]*?width: 44px; height: 44px/);
});
