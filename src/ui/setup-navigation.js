/* ---------- SETUP AND SETTINGS NAVIGATION (R1-3) ---------- */
document.getElementById('btn-to-tactics').onclick = () => {
  if (!Game.state.is(GameStates.MENU)) return false;
  ScreenRouter.show('tactics-screen');
  return true;
};

document.getElementById('btn-tactics-back').onclick = () => {
  if (!Game.state.is(GameStates.MENU)) return false;
  ScreenRouter.show('custom-match-screen');
  return true;
};

document.getElementById('btn-settings').onclick = () => {
  if (!Game.state.is(GameStates.MENU)) return false;
  if (!Game.state.transition(GameStates.SETTINGS)) return false;
  ScreenRouter.show('settings-screen');
  return true;
};

document.getElementById('btn-settings-back').onclick = () => {
  if (!Game.state.is(GameStates.SETTINGS)) return false;
  if (!Game.state.transition(GameStates.MENU)) return false;
  ScreenRouter.show('menu-screen');
  return true;
};
