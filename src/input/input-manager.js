/* ---------- INPUT SYSTEM (Step 10) ----------
   Separates raw device input (touch stick, buttons, keyboard) from what
   gameplay code asks for. Gameplay reads InputManager.isShoot() etc.
   instead of touching keyboard codes directly, so a future gamepad
   binding only needs changes here. */
const InputManager = {
  keys: {},
  stick: { active: false, dx: 0, dy: 0, ox: 0, oy: 0 },
  buttons: { shoot: 0, pass: 0, through: 0, dash: 0, tackle: 0 },
  moveVector() {
    let dx = this.stick.dx, dy = this.stick.dy;
    if (this.keys['KeyW'] || this.keys['ArrowUp']) dy = -1;
    if (this.keys['KeyS'] || this.keys['ArrowDown']) dy = 1;
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) dx = -1;
    if (this.keys['KeyD'] || this.keys['ArrowRight']) dx = 1;
    return { dx, dy };
  },
  isDash() { return !!(this.buttons.dash || this.keys['ShiftLeft'] || this.keys['ShiftRight']); },
  isShoot() { return !!(this.buttons.shoot || this.keys['Space']); },
  isPass() { return !!(this.buttons.pass || this.keys['KeyQ']); },
  isThrough() { return !!(this.buttons.through || this.keys['KeyE']); },
  isTackle() { return !!(this.buttons.tackle || this.keys['KeyF']); },
};
state.keys = InputManager.keys;
state.stick = InputManager.stick;
state.buttons = InputManager.buttons;

