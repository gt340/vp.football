/* ---------- MATCH ENGINE FOUNDATION (Step 8) ---------- */
function startMatch() {
  AudioManager.ensure();
  ScreenRouter.show(null);
  document.getElementById('hud').classList.remove('hidden');
  document.getElementById('controls').classList.add('active');
  document.getElementById('selected-info').classList.remove('hidden');
  document.getElementById('home-dot').style.background = state.homeTeam.primary;
  document.getElementById('away-dot').style.background = state.awayTeam.primary;
  document.getElementById('home-abbr').textContent = state.homeTeam.abbr;
  document.getElementById('away-abbr').textContent = state.awayTeam.abbr;
  state.scoreHome = 0; state.scoreAway = 0;
  state.goalFlash = 0;
  state.shootCharging = false; state.shootChargeStart = 0; // Phase 5: no charge carries over into a new/replayed match
  createTeams();
  const field = state.homePlayers.find(p => !p.isGK) || state.homePlayers[0];
  state.controlledId = field.id;

  state.match = buildMatchModel();
  state.match.matchId = `${state.homeTeam.id}-${state.awayTeam.id}-${Date.now()}`;
  state.match.homeTeam = buildTeamModel(state.homeTeam);
  state.match.awayTeam = buildTeamModel(state.awayTeam);
  state.match.homeTeam.players = state.homePlayers.map(p => p.profile);
  state.match.awayTeam.players = state.awayPlayers.map(p => p.profile);
  state.match.matchDuration = state.duration;
  state.match.halfDuration = state.duration / 2;
  state.match.status = 'playing';
  state.match.selectedPlayer = state.controlledId;

  // Phase 2, Step 3: home kicks off the first half; the flow below
  // (halftime / second half) hands kickoff to the other side.
  state.halfDuration = state.duration / 2;
  state.stoppageAccrued = 0; state.stoppageRemaining = 0;
  state.lastTouch = null; state.lastPassBy = null; state.lastShotBy = null;
  state.collisionFoulCooldowns = {};
  state.possession = { team: null, homeMs: 0, awayMs: 0 };
  state.setPiece = null; state.match.setPiece = null;

  updateHUD(); updateSelectedInfo(); resize();
  state.running = true; state.lastTime = performance.now();
  Game.state.transition(GameStates.PLAYING);
  beginKickoff(true, MatchPeriods.FIRST_HALF, true);
  requestAnimationFrame(loop);
}

/* ---------- KICKOFF SYSTEM (Phase 2, Step 3) ----------
   Places the ball at center, resets every active player to their
   formation spot, and freezes gameplay for a short window so the
   kicking team can't be immediately closed down before the whistle.
   Used both for match/half kickoff (resetClock=true, starts the clock
   for that half) and for the restart after every goal (resetClock
   false — the clock and any accrued stoppage time carry over). */
function beginKickoff(kickoffIsHome, period, resetClock) {
  if (!state.running) return; // Step 30: guards a delayed kickoff firing after the match ended/was left
  resetBall();
  state.kickoffTeamIsHome = kickoffIsHome;
  state.kickoffFreeze = RULES_CONFIG.setPieces.freezeFrames;
  state.matchPeriod = MatchPeriods.KICKOFF;
  state.pendingPeriod = period; // which period KICKOFF resolves into once the freeze ends
  state.setPiece = null; if (state.match) state.match.setPiece = null;
  if (resetClock) {
    state.timeLeft = state.halfDuration;
    state.stoppageAccrued = 0; state.stoppageRemaining = 0;
  }
  if (state.match) state.match.period = MatchPeriods.KICKOFF;
  EventBus.emit(GameEvents.KICKOFF, { home: kickoffIsHome, period });
  AudioManager.whistle();
  showCommentary(randomLine('kickoff'), 2500);
}

/* ---------- HALFTIME (Phase 2, Step 2) ---------- */
function goToHalftime() {
  state.matchPeriod = MatchPeriods.HALFTIME;
  if (state.match) state.match.period = MatchPeriods.HALFTIME;
  Game.state.transition(GameStates.HALFTIME);
  AudioManager.whistle();
  showRulesBanner('HALFTIME', '#38bdf8');
  showCommentary('The referee blows for halftime.', 2600);
  EventBus.emit(GameEvents.HALFTIME, {});
  setTimeout(() => {
    if (state.matchPeriod !== MatchPeriods.HALFTIME) return; // guard: match may have been abandoned via Main Menu
    Game.state.transition(GameStates.PLAYING);
    EventBus.emit(GameEvents.SECOND_HALF, {});
    beginKickoff(false, MatchPeriods.SECOND_HALF, true);
  }, 2600);
}

/* ---------- ADDED TIME (Phase 2, Step 22) ----------
   Advances the match clock for the active half, and folds in stoppage
   time once regulation time in that half runs out — derived only from
   real stoppage-causing events (goals/cards/set pieces) accrued via
   the EventBus wiring above, never an arbitrary flat number. */
function tickMatchClock(dt) {
  const seconds = dt / 60;
  if (state.stoppageRemaining > 0) {
    state.stoppageRemaining = Math.max(0, state.stoppageRemaining - seconds);
    if (state.match) state.match.matchTime = matchTimeForPeriod(state.matchPeriod, 0);
    if (state.stoppageRemaining <= 0) resolveHalfEnd();
    return;
  }
  state.timeLeft -= seconds;
  if (state.match) state.match.matchTime = matchTimeForPeriod(state.matchPeriod, state.timeLeft);
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    const stoppage = Math.min(state.stoppageAccrued, RULES_CONFIG.stoppageTime.maxSeconds);
    state.stoppageAccrued = 0;
    if (stoppage > 0.01) { state.stoppageRemaining = stoppage; return; }
    resolveHalfEnd();
  }
}
function matchTimeForPeriod(period, timeLeftInHalf) {
  const elapsedThisHalf = state.halfDuration - Math.max(0, timeLeftInHalf);
  return period === MatchPeriods.SECOND_HALF ? state.halfDuration + elapsedThisHalf : elapsedThisHalf;
}
function resolveHalfEnd() {
  if (state.matchPeriod === MatchPeriods.FIRST_HALF) goToHalftime();
  else if (state.matchPeriod === MatchPeriods.SECOND_HALF) endMatch();
}

// Phase 4, Step 4: bench position is off-pitch (behind the team's own
// goal, out of the playable area) — bench players are never in
// state.home/awayPlayers, never touched by AI/collision/rendering
// loops, and only enter play through SubstitutionManager.
function benchSpot(isHome, index) {
  return { x: isHome ? PITCH.margin - 30 : PITCH.w - PITCH.margin + 30, y: PITCH.margin + 20 + index * 24 };
}
function createTeams() {
  const size = state.teamSize;
  let homeData = state.selectedPlayerIds.map(id => ALL_PLAYERS.find(p => p.id === id));
  homeData.sort((a, b) => (a.pos === 'GK' ? -1 : 1) - (b.pos === 'GK' ? -1 : 1));
  const used = new Set(state.selectedPlayerIds);
  let awayPool = ALL_PLAYERS.filter(p => !used.has(p.id));
  const awayGK = awayPool.find(p => p.pos === 'GK') || ALL_PLAYERS.find(p => p.pos === 'GK');
  awayPool = awayPool.filter(p => p.id !== awayGK.id);
  const awayData = [awayGK, ...awayPool.slice(0, size - 1)];
  const formH = formation(size, true);
  const formA = formation(size, false);
  state.homePlayers = homeData.map((p, i) => makePlayer(p, state.homeTeam, formH[i], true, true));
  state.awayPlayers = awayData.map((p, i) => makePlayer(p, state.awayTeam, formA[i], false, true));
  TacticalSystem.assignRoles(state.homePlayers, true);
  TacticalSystem.assignRoles(state.awayPlayers, false);

  // Benches: whatever's left in the shared pool, split fairly between
  // both sides and capped by SQUAD_CONFIG.maxSubstitutes. With only 40
  // total player entries, small formats (5v5) have plenty of spares;
  // 11v11 leaves 18 to split 7/7 with a few unused — never fabricated,
  // just whatever the pool actually has left.
  const usedIds = new Set([...homeData, ...awayData].map(p => p.id));
  const remaining = ALL_PLAYERS.filter(p => !usedIds.has(p.id));
  const homeBenchData = remaining.slice(0, SQUAD_CONFIG.maxSubstitutes);
  const awayBenchData = remaining.slice(SQUAD_CONFIG.maxSubstitutes, SQUAD_CONFIG.maxSubstitutes * 2);
  state.homeBench = homeBenchData.map((p, i) => makePlayer(p, state.homeTeam, benchSpot(true, i), true, false));
  state.awayBench = awayBenchData.map((p, i) => makePlayer(p, state.awayTeam, benchSpot(false, i), false, false));
  state.substitutionsUsed = { home: 0, away: 0 };
  state.aiSubCheckTimer = 0;
}

// 5v5/7v7 layouts (11v11 uses TacticalSystem's normalized formation
// slots instead). Originally hand-picked against the old 1280x720
// world; expressed here as fractions of that same reference frame
// (FX/FY) so they land in the same relative spot on the new, larger
// PITCH.w/PITCH.h — the pitch-size patch doesn't need to re-pick these.
function formation(n, home) {
  const FX = (v) => PITCH.w * (v / 1280);
  const FY = (v) => PITCH.h * (v / 720);
  const gx = home ? PITCH.margin + FX(36) : PITCH.w - PITCH.margin - FX(36);
  const positions = [{ x: gx, y: PITCH.h / 2 }];
  const field = n - 1;
  const side = home ? 1 : -1;
  const baseX = home ? FX(320) : FX(960);
  if (field <= 4) {
    positions.push(
      { x: baseX - side * FX(40), y: FY(200) }, { x: baseX - side * FX(40), y: FY(520) },
      { x: baseX + side * FX(80), y: FY(280) }, { x: baseX + side * FX(80), y: FY(440) }
    );
  } else if (field <= 6) {
    positions.push(
      { x: baseX - side * FX(60), y: FY(160) }, { x: baseX - side * FX(60), y: FY(360) }, { x: baseX - side * FX(60), y: FY(560) },
      { x: baseX + side * FX(50), y: FY(240) }, { x: baseX + side * FX(50), y: FY(480) }, { x: baseX + side * FX(140), y: FY(360) }
    );
  } else {
    positions.push(
      { x: baseX - side * FX(80), y: FY(140) }, { x: baseX - side * FX(80), y: FY(280) },
      { x: baseX - side * FX(80), y: FY(440) }, { x: baseX - side * FX(80), y: FY(580) },
      { x: baseX + side * FX(20), y: FY(200) }, { x: baseX + side * FX(20), y: FY(360) }, { x: baseX + side * FX(20), y: FY(520) },
      { x: baseX + side * FX(120), y: FY(260) }, { x: baseX + side * FX(120), y: FY(460) }, { x: baseX + side * FX(200), y: FY(360) }
    );
  }
  return positions.slice(0, n);
}

function makePlayer(data, team, pos, isHome, isStarter) {
  return {
    id: data.id + (isHome ? 0 : 200), name: data.name, pos: data.pos,
    speed: data.speed, power: data.power, tackle: data.tackle, skill: data.skill,
    team, isHome, x: pos.x, y: pos.y, vx: 0, vy: 0,
    r: data.pos === 'GK' ? PLAYER_CONFIG.gkRadius : PLAYER_CONFIG.fieldRadius,
    facing: isHome ? 0 : Math.PI,
    cooldown: 0, stunned: 0, isGK: data.pos === 'GK',
    profile: buildPlayerProfile(data, team.id),
    discipline: buildDiscipline(),       // Phase 2, Step 6
    matchStats: buildPlayerMatchStats(), // Phase 2, Step 18
    role: null, tacticalAnchor: null,    // Phase 3: assigned by TacticalSystem.assignRoles() right after creation
    squadStatus: buildSquadStatus(isStarter !== false), // Phase 4, Step 4
  };
}

function resetBall() {
  state.ball = { x: PITCH.w / 2, y: PITCH.h / 2, vx: 0, vy: 0, r: 8 * WORLD_RADIAL_SCALE, ownerId: null, aerial: false, aerialFramesLeft: 0 }; // Phase 5: ownerId is the persisted-possession layer; null = loose ball; aerial is the brief lofted-pass flight window
  state.homePlayers.forEach((p, i) => {
    if (p.discipline.sentOff) return; // Step 7: don't re-place a sent-off player
    const fp = formation(state.teamSize, true)[i];
    p.x = fp.x; p.y = fp.y; p.vx = 0; p.vy = 0; p.stunned = 0;
  });
  state.awayPlayers.forEach((p, i) => {
    if (p.discipline.sentOff) return;
    const fp = formation(state.teamSize, false)[i];
    p.x = fp.x; p.y = fp.y; p.vx = 0; p.vy = 0; p.stunned = 0;
  });
}

// Every player on the pitch, sent-off or not — used for rare bookkeeping
// (e.g. looking a player up by id for stats attribution).
function allPlayers() { return [...state.homePlayers, ...state.awayPlayers]; }
// Phase 2, Step 7: players still legally on the pitch. AI, collisions,
// auto-switch, rendering and getControlled() all use this instead of
// allPlayers() so a sent-off player stops participating entirely.
function activePlayers() { return allPlayers().filter(p => !p.discipline.sentOff); }
function findPlayerById(id) {
  if (id == null) return null;
  return allPlayers().find(p => p.id === id) || null;
}
// Phase 5, Step 7: single place that actually changes who's controlled,
// so every switch path (auto-switch, red-card/sub handoff) emits the same
// pair of events instead of each call site doing it slightly differently.
function switchControlTo(player, reason) {
  if (!player || state.controlledId === player.id) return;
  const fromId = state.controlledId;
  state.controlledId = player.id;
  if (state.match) state.match.selectedPlayer = player.id;
  EventBus.emit(GameEvents.PLAYER_SWITCHED, { fromId, toId: player.id, reason: reason || 'unspecified' });
  EventBus.emit(GameEvents.PLAYER_CONTROL_CHANGED, { playerId: player.id, reason: reason || 'unspecified' });
}
function getControlled() {
  const cur = state.homePlayers.find(p => p.id === state.controlledId);
  if (cur && !cur.discipline.sentOff) return cur;
  // Controlled player was sent off (or missing) — hand control to the
  // next available outfield player, same fallback order as Phase 1.
  const fallback = state.homePlayers.find(p => !p.isGK && !p.discipline.sentOff)
    || state.homePlayers.find(p => !p.discipline.sentOff);
  if (fallback && fallback.id !== state.controlledId) switchControlTo(fallback, 'sent off');
  return fallback;
}

/* Auto-switch like eFootball: switch to closest when ball is far / lost (Step 14) */
function autoSwitchIfNeeded() {
  const now = performance.now();
  if (now - state.lastAutoSwitch < CONTROL_CONFIG.autoSwitchCooldownMs) return;
  const p = getControlled();
  const ball = state.ball;
  if (!p) return;
  const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
  if (dist > CONTROL_CONFIG.autoSwitchDist) {
    let best = p, bestD = dist;
    for (const t of state.homePlayers) {
      if (t.discipline.sentOff) continue; // Step 25: AI must not select a sent-off player
      if (t.isGK && state.homePlayers.length > 1) continue;
      const d = Math.hypot(t.x - ball.x, t.y - ball.y);
      if (d < bestD - CONTROL_CONFIG.autoSwitchMargin) { bestD = d; best = t; }
    }
    if (best.id !== p.id) {
      switchControlTo(best, 'auto'); // Phase 5, Step 7
      state.lastAutoSwitch = now;
      updateSelectedInfo();
    }
  }
}

function updateSelectedInfo() {
  const p = getControlled();
  if (!p) return;
  document.getElementById('selected-info').innerHTML =
    `<strong>${p.name}</strong> · ${p.pos}<br>⚡${p.speed} 💪${p.power} 🛡${p.tackle}`;
}
function updateHUD() {
  document.getElementById('score-home').textContent = state.scoreHome;
  document.getElementById('score-away').textContent = state.scoreAway;
  const m = Math.floor(state.timeLeft / 60);
  const s = Math.floor(state.timeLeft % 60).toString().padStart(2, '0');
  document.getElementById('timer').textContent = `${m}:${s}`;
}

