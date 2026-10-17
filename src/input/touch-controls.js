/* ---------- Stick + buttons (touch/mouse -> InputManager) ---------- */
const stickZone = document.getElementById('stick-zone');
const stickKnob = document.getElementById('stick-knob');
const STICK_R = CONTROL_CONFIG.stickRadius;
function stickStart(e) {
  e.preventDefault(); AudioManager.ensure();
  const t = e.touches ? e.touches[0] : e;
  const rect = stickZone.getBoundingClientRect();
  InputManager.stick.active = true;
  InputManager.stick.ox = rect.left + rect.width / 2;
  InputManager.stick.oy = rect.top + rect.height / 2;
  stickMove(e);
}
function stickMove(e) {
  if (!InputManager.stick.active) return;
  e.preventDefault();
  const t = e.touches ? e.touches[0] : e;
  let dx = t.clientX - InputManager.stick.ox, dy = t.clientY - InputManager.stick.oy;
  const len = Math.hypot(dx, dy);
  if (len > STICK_R) { dx = dx / len * STICK_R; dy = dy / len * STICK_R; }
  InputManager.stick.dx = dx / STICK_R; InputManager.stick.dy = dy / STICK_R;
  stickKnob.style.left = (51 + dx) + 'px';
  stickKnob.style.bottom = (51 - dy) + 'px';
}
function stickEnd(e) {
  e.preventDefault();
  InputManager.stick.active = false; InputManager.stick.dx = 0; InputManager.stick.dy = 0;
  stickKnob.style.left = '51px'; stickKnob.style.bottom = '51px';
}
stickZone.addEventListener('touchstart', stickStart, { passive: false });
stickZone.addEventListener('touchmove', stickMove, { passive: false });
stickZone.addEventListener('touchend', stickEnd, { passive: false });
stickZone.addEventListener('touchcancel', stickEnd, { passive: false });
stickZone.addEventListener('mousedown', stickStart);
window.addEventListener('mousemove', stickMove);
window.addEventListener('mouseup', stickEnd);

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

