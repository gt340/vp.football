/* ---------- OUT-OF-BOUNDS ENGINE ENTRY POINT (Phase 2, Step 13) ---------- */
function checkBoundaries() {
  if (state.setPiece && state.setPiece.active) return;
  RefereeSystem.evaluateBoundary();
}

// Step 20: only ever attribute an assist to a real preceding pass by a
// teammate, within a short, honest possession window — never invented.
function attributeGoal(home) {
  const now = state.match ? state.match.matchTime : 0;
  const shot = state.lastShotBy;
  const scorerId = (shot && shot.isHome === home && now - shot.time < RULES_CONFIG.shotAttributionWindowSeconds) ? shot.playerId : null;
  const pass = state.lastPassBy;
  const assistId = (pass && pass.isHome === home && pass.playerId !== scorerId && now - pass.time < RULES_CONFIG.assistWindowSeconds) ? pass.playerId : null;
  return { scorerId, assistId };
}
function checkGoals() {
  if (state.goalFlash > 0 || (state.setPiece && state.setPiece.active)) return;
  const b = state.ball;
  const gTop = PITCH.h / 2 - GOAL_W / 2, gBot = PITCH.h / 2 + GOAL_W / 2;
  if (b.x > PITCH.w - PITCH.margin + 6 * WORLD_SCALE_X && b.y > gTop && b.y < gBot) {
    state.scoreHome++; state.goalFlash = MATCH_CONFIG.goalFlashFrames; updateHUD();
    const { scorerId, assistId } = attributeGoal(true);
    EventBus.emit(GameEvents.GOAL, { home: true, scorerId, assistId });
    celebrateGoal(true);
    setTimeout(() => beginKickoff(false, state.matchPeriod, false), MATCH_CONFIG.goalResetDelayMs);
  }
  if (b.x < PITCH.margin - 6 * WORLD_SCALE_X && b.y > gTop && b.y < gBot) {
    state.scoreAway++; state.goalFlash = MATCH_CONFIG.goalFlashFrames; updateHUD();
    const { scorerId, assistId } = attributeGoal(false);
    EventBus.emit(GameEvents.GOAL, { home: false, scorerId, assistId });
    celebrateGoal(false);
    setTimeout(() => beginKickoff(true, state.matchPeriod, false), MATCH_CONFIG.goalResetDelayMs);
  }
}

function celebrateGoal(home) {
  AudioManager.goal();
  const banner = document.getElementById('goal-banner');
  banner.textContent = home ? 'GOAL!' : 'GOAL...';
  banner.style.color = home ? '#ffd700' : '#f87171';
  banner.classList.add('show');
  setTimeout(() => banner.classList.remove('show'), MATCH_CONFIG.goalBannerMs);
  showCommentary(home ? randomLine('goalHome') : randomLine('goalAway'), 3200);
}

function endMatch() {
  state.running = false;
  state.matchPeriod = MatchPeriods.FULL_TIME;
  if (state.match) { state.match.status = 'finished'; state.match.period = MatchPeriods.FULL_TIME; }
  Game.state.transition(GameStates.FULL_TIME);
  EventBus.emit(GameEvents.FULL_TIME, {});
  AudioManager.whistle();
  document.getElementById('controls').classList.remove('active');
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('selected-info').classList.add('hidden');
  document.getElementById('commentary').classList.remove('show');
  ScreenRouter.show('result-screen');
  const rs = document.getElementById('result-screen');
  let title, msg;
  if (state.scoreHome > state.scoreAway) {
    title = 'Victory!';
    msg = `${state.homeTeam.name} win ${state.scoreHome}–${state.scoreAway}`;
    showCommentary(`Full time! ${state.homeTeam.name} take the three points!`, 4000);
  } else if (state.scoreHome < state.scoreAway) {
    title = 'Defeat';
    msg = `${state.awayTeam.name} win ${state.scoreAway}–${state.scoreHome}`;
    showCommentary(`Full time. ${state.awayTeam.name} come out on top.`, 4000);
  } else {
    title = 'Draw';
    msg = `Final score ${state.scoreHome}–${state.scoreAway}`;
    showCommentary('Full time, and it ends all square.', 4000);
  }
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-score').textContent = `${state.scoreHome} – ${state.scoreAway}`;
  document.getElementById('result-msg').textContent = msg;
}

