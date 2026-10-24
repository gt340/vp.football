/* ---------- MATCH ENTRY POINTS (R1-2) ---------- */
function startQuickMatch() {
  if (!Game.state.is(GameStates.MENU)) return false;
  const home = state.homeTeam || TEAMS[0];
  const away = state.awayTeam && state.awayTeam.id !== home.id
    ? state.awayTeam : TEAMS.find((team) => team.id !== home.id);
  if (!home || !away) return false;
  const teamSize = MATCH_CONFIG.teamSizes.includes(state.teamSize) ? state.teamSize : MATCH_CONFIG.defaultTeamSize;
  const duration = MATCH_CONFIG.durations.includes(state.duration) ? state.duration : MATCH_CONFIG.defaultDuration;
  const goalkeeper = ALL_PLAYERS.find((player) => player.pos === 'GK');
  const outfield = ALL_PLAYERS.filter((player) => player.pos !== 'GK');
  if (!goalkeeper || outfield.length < teamSize - 1) return false;
  state.homeTeam = home;
  state.awayTeam = away;
  state.teamSize = teamSize;
  state.duration = duration;
  state.selectedPlayerIds = [goalkeeper.id, ...outfield.slice(0, teamSize - 1).map((player) => player.id)];
  AudioManager.ensure();
  if (!Game.state.transition(GameStates.SQUAD_SELECTION, { source: 'quick-match' })) return false;
  if (!Game.state.transition(GameStates.PRE_MATCH, { source: 'quick-match' })) return false;
  startMatch();
  return true;
}
document.getElementById('btn-quick-match').onclick = startQuickMatch;
document.getElementById('btn-custom-match').onclick = () => ScreenRouter.show('custom-match-screen');
document.getElementById('btn-custom-back').onclick = () => ScreenRouter.show('menu-screen');
