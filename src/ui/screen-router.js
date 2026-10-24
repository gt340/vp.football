/* ---------- SCREEN ROUTER (R1-1) ---------- */
/* Centralizes navigation between existing .screen containers without
   changing game state transitions or the visual design. */
const ScreenRouter = (() => {
  let activeScreenId = null;
  function getScreen(id) {
    if (id === null) return null;
    const screen = document.getElementById(id);
    if (!screen || !screen.classList.contains('screen')) {
      throw new Error(`ScreenRouter: unknown screen "${id}"`);
    }
    return screen;
  }
  function show(id) {
    const target = getScreen(id);
    const screens = document.querySelectorAll('.screen');
    if (id !== null && !Array.from(screens).includes(target)) {
      throw new Error(`ScreenRouter: screen "${id}" is not registered`);
    }
    screens.forEach((screen) => {
      const active = screen === target;
      screen.classList.toggle('hidden', !active);
      screen.setAttribute('aria-hidden', String(!active));
    });
    activeScreenId = target ? target.id : null;
    return activeScreenId;
  }
  function init(initialScreenId = 'menu-screen') {
    return show(initialScreenId);
  }
  return Object.freeze({ init, show, current: () => activeScreenId });
})();
ScreenRouter.init('menu-screen');

