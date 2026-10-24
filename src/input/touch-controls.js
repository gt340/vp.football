/* ---------- Stick + buttons (touch/mouse -> InputManager) ---------- */
const stickZone = document.getElementById('stick-zone');
const stickKnob = document.getElementById('stick-knob');
const gameCanvas = document.getElementById('game');
const gameWrap = document.getElementById('game-wrap');
const STICK_R = CONTROL_CONFIG.stickRadius;
const DEFAULT_STICK = { left: '2%', top: '', bottom: '4%' };
let activeTouchId = null;
let activeMouse = false;
let stickSource = null;

function pointForTouch(list, id) {
  if (!list) return null;
  for (let i = 0; i < list.length; i++) {
    if (id == null || list[i].identifier === id) return list[i];
  }
  return null;
}
function placeStickAt(x, y) {
  const wrapRect = gameWrap.getBoundingClientRect();
  stickZone.style.left = (x - wrapRect.left - 75) + 'px';
  stickZone.style.top = (y - wrapRect.top - 75) + 'px';
  stickZone.style.bottom = 'auto';
}
function updateStickAt(x, y, preventEvent) {
  if (preventEvent && preventEvent.cancelable) preventEvent.preventDefault();
  let dx = x - InputManager.stick.ox, dy = y - InputManager.stick.oy;
  const len = Math.hypot(dx, dy);
  if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
  InputManager.stick.dx = dx / STICK_R;
  InputManager.stick.dy = dy / STICK_R;
  stickKnob.style.left = (51 + dx) + 'px';
  stickKnob.style.bottom = (51 - dy) + 'px';
}
function startStick(x, y, source, e) {
  if (e && e.cancelable) e.preventDefault();
  AudioManager.ensure();
  InputManager.stick.active = true;
  stickSource = source;
  if (source === 'field') {
    InputManager.stick.ox = x;
    InputManager.stick.oy = y;
    placeStickAt(x, y);
  } else {
    const rect = stickZone.getBoundingClientRect();
    InputManager.stick.ox = rect.left + rect.width / 2;
    InputManager.stick.oy = rect.top + rect.height / 2;
  }
  updateStickAt(x, y, null);
}
function stickStart(e) {
  if (e.touches) {
    if (activeTouchId !== null) return;
    const t = pointForTouch(e.changedTouches || e.touches, null);
    if (!t) return;
    activeTouchId = t.identifier;
    startStick(t.clientX, t.clientY, 'zone', e);
  } else {
    if (activeMouse) return;
    activeMouse = true;
    startStick(e.clientX, e.clientY, 'zone', e);
  }
}
function fieldStart(e) {
  if (e.touches) {
    if (activeTouchId !== null) return;
    const t = pointForTouch(e.changedTouches || e.touches, null);
    if (!t) return;
    activeTouchId = t.identifier;
    startStick(t.clientX, t.clientY, 'field', e);
  } else {
    if (activeMouse) return;
    activeMouse = true;
    startStick(e.clientX, e.clientY, 'field', e);
  }
}
function stickMove(e) {
  if (!InputManager.stick.active) return;
  if (e.touches) {
    const t = pointForTouch(e.touches, activeTouchId);
    if (!t) return;
    updateStickAt(t.clientX, t.clientY, e);
  } else if (activeMouse) {
    updateStickAt(e.clientX, e.clientY, e);
  }
}
function resetStick() {
  InputManager.stick.active = false;
  InputManager.stick.dx = 0;
  InputManager.stick.dy = 0;
  activeTouchId = null;
  activeMouse = false;
  stickKnob.style.left = '51px';
  stickKnob.style.bottom = '51px';
  stickZone.style.left = DEFAULT_STICK.left;
  stickZone.style.top = DEFAULT_STICK.top;
  stickZone.style.bottom = DEFAULT_STICK.bottom;
  stickSource = null;
}
function stickEnd(e) {
  if (e && e.changedTouches && activeTouchId !== null &&
      !pointForTouch(e.changedTouches, activeTouchId)) return;
  if (e && !e.changedTouches && e.type !== 'blur' && !activeMouse) return;
  if (e && e.cancelable) e.preventDefault();
  resetStick();
}

stickZone.addEventListener('touchstart', stickStart, { passive: false });
stickZone.addEventListener('mousedown', stickStart);
// Dragging on the pitch starts a temporary touch joystick at the finger.
// Window-level move/end listeners keep movement alive when the finger leaves
// the original target, and the tracked touch ID ignores unrelated fingers.
gameCanvas.addEventListener('touchstart', fieldStart, { passive: false });
gameCanvas.addEventListener('mousedown', fieldStart);
window.addEventListener('touchmove', stickMove, { passive: false });
window.addEventListener('touchend', stickEnd, { passive: false });
window.addEventListener('touchcancel', stickEnd, { passive: false });
window.addEventListener('mousemove', stickMove);
window.addEventListener('mouseup', stickEnd);
window.addEventListener('blur', () => {
  resetStick();
  for (const key of Object.keys(InputManager.keys)) InputManager.keys[key] = false;
  for (const key of Object.keys(InputManager.buttons)) InputManager.buttons[key] = 0;
  document.querySelectorAll('.ef-btn.active').forEach(el => el.classList.remove('active'));
});

function bindBtn(id, key) {
  const el = document.getElementById(id);
  const down = (e) => { e.preventDefault(); AudioManager.ensure(); InputManager.buttons[key] = 1; el.classList.add('active'); };
  const up = (e) => { e.preventDefault(); InputManager.buttons[key] = 0; el.classList.remove('active'); };
  el.addEventListener('touchstart', down, { passive: false });
  el.addEventListener('touchend', up, { passive: false });
  el.addEventListener('touchcancel', up, { passive: false });
  el.addEventListener('mousedown', down);
  el.addEventListener('mouseup', up);
  el.addEventListener('mouseleave', up);
}
bindBtn('btn-shoot', 'shoot');
bindBtn('btn-pass', 'pass');
bindBtn('btn-through', 'through');
bindBtn('btn-dash', 'dash');
bindBtn('btn-tackle', 'tackle');

window.addEventListener('keydown', e => {
  InputManager.keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => { InputManager.keys[e.code] = false; });
