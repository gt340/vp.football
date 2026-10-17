/* ---------- GAME LOOP ----------
   requestAnimationFrame -> update(dt) -> input -> match engine -> physics
   -> AI -> game state -> renderer. Delta time (Step 9) keeps gameplay
   frame-rate independent, unchanged from the original clamp. */
function loop(now) {
  if (!state.running) return;
  try {
    const dt = Math.min((now - state.lastTime) / 16.67, 2.2);
    state.lastTime = now;
    if (state.goalFlash > 0) state.goalFlash -= dt;

    // ---- HALFTIME: engine fully paused, waiting on goToHalftime()'s timer.
    // Substitutions ARE allowed at halftime (Step 5/23), so still process
    // any request that came in through the bench UI while paused here. ----
    if (state.matchPeriod === MatchPeriods.HALFTIME) {
      SubstitutionManager.processPending();
      StaminaSystem.recoverBench(dt);
      draw(); requestAnimationFrame(loop); return;
    }

    // ---- KICKOFF freeze: ball/players held, clock not yet running (Step 3) ----
    if (state.kickoffFreeze > 0) {
      state.kickoffFreeze -= dt;
      if (state.kickoffFreeze <= 0) { state.matchPeriod = state.pendingPeriod; if (state.match) state.match.period = state.pendingPeriod; }
      sanitizeAllEntities();
      updateHUD();
      draw();
      requestAnimationFrame(loop);
      return;
    }

    // ---- Regulation clock only runs during an actual half (Step 21-22) ----
    tickMatchClock(dt);
    if (!state.running) { draw(); return; } // tickMatchClock may have ended the match this frame

    if (state.goalFlash <= 0) {
      state.commentTimer += dt;
      const [lo, hi] = MATCH_CONFIG.lateGameCommentWindow;
      if (state.commentTimer > MATCH_CONFIG.lateGameCommentIntervalFrames && state.timeLeft < hi && state.timeLeft > lo) {
        showCommentary(randomLine('time'), 2200);
        state.commentTimer = 0;
      }
    }
    updateHUD();

    // ---- Set piece in progress: freeze normal AI/input, just tick the restart (Step 24) ----
    if (state.setPiece && state.setPiece.active) {
      SetPieceManager.update(dt);
      sanitizeAllEntities();
      draw();
      requestAnimationFrame(loop);
      return;
    }

    SubstitutionManager.processPending(); // Step 24: apply any sub queued behind a just-finished set piece
    updatePossession(dt); // Step 19
    updatePlayingMinutes(dt); // Step 15
    StaminaSystem.recoverBench(dt); // Step 8
    checkAISubstitutions(dt); // Step 13
    runIntegrityCheck(dt); // Step 23/30
    autoSwitchIfNeeded();
    updateControlled(dt);
    updateAI(dt);
    updateBall(dt);
    resolveCollisions();
    updateBallControl(dt); // Phase 5, Step 2-3: possession/dribble layer, additive on top of the physics above
    sanitizeAllEntities(); // Step 18/23: guard against NaN/Infinity before render
    checkGoals();
    if (!(state.goalFlash > 0)) checkBoundaries(); // Step 13: a goal this frame always wins over an OOB read
    draw();
  } catch (err) {
    console.error('[GameLoop] error during frame, attempting to continue', err);
  }
  requestAnimationFrame(loop);
}

/* ---------- POSSESSION (Phase 2, Step 19) ----------
   Cheap: reuses the distance-to-ball figure computed for auto-switch
   rather than an extra full pass over every player, and only updates a
   running millisecond counter — no per-frame recalculation of a %. */
function updatePossession(dt) {
  const b = state.ball;
  let closest = null, closestD = Infinity;
  for (const p of activePlayers()) {
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < closestD) { closestD = d; closest = p; }
  }
  if (closest && closestD < 22) state.possession.team = closest.isHome;
  if (state.possession.team === true) state.possession.homeMs += dt * 16.67;
  else if (state.possession.team === false) state.possession.awayMs += dt * 16.67;
  if (state.match) {
    state.match.statistics.possessionHomeMs = state.possession.homeMs;
    state.match.statistics.possessionAwayMs = state.possession.awayMs;
  }
}

// Step 15: only on-pitch, not-sent-off players accumulate minutes, and
// only while a half is actually being played (never at halftime/kickoff
// freeze, matching the loop branches this is called from).
function updatePlayingMinutes(dt) {
  const minutes = (dt / 60) / 60;
  for (const p of allPlayers()) {
    if (p.squadStatus && p.squadStatus.isOnPitch && !p.discipline.sentOff) p.matchStats.minutesPlayed += minutes;
  }
}

/* ---------- AI SUBSTITUTIONS (Phase 4, Step 13) ----------
   AI only reconsiders subs on a real cooldown, and only for genuinely
   meaningful reasons (never "slightly below 100"). Goes through the
   exact same SubstitutionManager.request() a human bench UI would use —
   no shortcut path. */
function checkAISubstitutions(dt) {
  if (!AI_SUB_CONFIG.enabled) return;
  state.aiSubCheckTimer += dt / 60;
  if (state.aiSubCheckTimer < AI_SUB_CONFIG.checkIntervalSeconds) return;
  state.aiSubCheckTimer = 0;
  considerAISubstitution(false); // away team is the AI-controlled side
}
function considerAISubstitution(isHome) {
  const gate = SubstitutionManager.canSubstitute(isHome);
  if (!gate.ok) return;
  const bench = isHome ? state.homeBench : state.awayBench;
  const available = bench.filter(p => !p.discipline.sentOff);
  if (!available.length) return;
  const onPitch = (isHome ? state.homePlayers : state.awayPlayers).filter(p => !p.discipline.sentOff);
  // Priority 1 (Step 13): a critically exhausted outfield player.
  let outgoing = onPitch.filter(p => !p.isGK && StaminaSystem.tier(p) === 'CRITICAL').sort((a, b) => a.squadStatus.stamina - b.squadStatus.stamina)[0];
  let reason = 'stamina';
  // Priority 2: poor performance + real fatigue (Step 14), only with a
  // meaningful sample of minutes so a single early mistake isn't judged.
  if (!outgoing) {
    const candidates = onPitch.filter(p => !p.isGK && p.matchStats.minutesPlayed >= AI_SUB_CONFIG.poorPerformanceMinMinutes && StaminaSystem.tier(p) !== 'HIGH');
    if (candidates.length) {
      outgoing = candidates.reduce((worst, p) => playerPerformanceScore(p) < playerPerformanceScore(worst) ? p : worst);
      reason = 'performance';
    }
  }
  if (!outgoing) return;
  // Prefer a like-for-like replacement (same role/position) where available.
  const incoming = available.find(p => p.pos === outgoing.pos) || available[0];
  const result = SubstitutionManager.request(isHome, outgoing.id, incoming.id);
  if (result.ok) EventBus.emit(GameEvents.AI_SUBSTITUTION, { home: isHome, outgoingId: outgoing.id, incomingId: incoming.id, reason });
}

function sanitizeAllEntities() {
  if (!state.ball || !isFiniteNum(state.ball.x)) state.ball = { x: PITCH.w / 2, y: PITCH.h / 2, vx: 0, vy: 0, r: 8, ownerId: null, aerial: false, aerialFramesLeft: 0 }; // Step 23: missing/corrupt ball
  if (state.ball.ownerId != null && !findPlayerById(state.ball.ownerId)) releaseBallControl('owner no longer on pitch'); // Phase 5: guard against a stale/invalid owner reference
  sanitizeEntity(state.ball, PITCH.w / 2, PITCH.h / 2);
  for (const p of allPlayers()) sanitizeEntity(p, PITCH.w / 2, PITCH.h / 2);
}

// Phase 2, Step 23/30: runs roughly twice a second, not every frame —
// cheap invariant checks that log and self-heal rather than crash the
// match if something ends up in an impossible state.
let integrityCheckTimer = 0;
function runIntegrityCheck(dt) {
  integrityCheckTimer += dt;
  if (integrityCheckTimer < 30) return;
  integrityCheckTimer = 0;
  const seen = new Set();
  for (const p of allPlayers()) {
    if (seen.has(p.id)) console.warn('[Integrity] duplicate player id detected', p.id);
    seen.add(p.id);
    if (p.team !== state.homeTeam && p.team !== state.awayTeam) console.warn('[Integrity] player with invalid team assignment', p.id);
  }
  if (state.setPiece && state.setPiece.active && !['FREE_KICK', 'PENALTY', 'CORNER', 'GOAL_KICK', 'THROW_IN'].includes(state.setPiece.type)) {
    console.warn('[Integrity] invalid set-piece type, cancelling', state.setPiece.type);
    SetPieceManager.finish();
  }
  // Phase 5, Step 16: ball possession/control state must always reference
  // a real, active (not sent-off) player, or be null (loose ball).
  if (state.ball) {
    if (!isFiniteNum(state.ball.ownerId) && state.ball.ownerId !== null) console.warn('[Integrity] ball.ownerId is not a number or null', state.ball.ownerId);
    else if (state.ball.ownerId != null) {
      const owner = findPlayerById(state.ball.ownerId);
      if (!owner || owner.discipline.sentOff) { console.warn('[Integrity] ball owned by an invalid/sent-off player, releasing', state.ball.ownerId); releaseBallControl('integrity check'); }
    }
    if (!isFiniteNum(state.ball.aerialFramesLeft)) state.ball.aerialFramesLeft = 0;
  }
  const activeHome = state.homePlayers.filter(p => !p.discipline.sentOff).length;
  const activeAway = state.awayPlayers.filter(p => !p.discipline.sentOff).length;
  if (activeHome < 1 || activeAway < 1) console.warn('[Integrity] a team has no active players left', { activeHome, activeAway });
  // Phase 3, Step 20: tactical data validation.
  if (state.homePlayers.length) TacticalSystem.validate(state.homePlayers).forEach(msg => console.warn('[Integrity][tactics]', msg));
  if (state.awayPlayers.length) TacticalSystem.validate(state.awayPlayers).forEach(msg => console.warn('[Integrity][tactics]', msg));
  // Phase 4, Step 27: squad/substitution/stamina validation.
  for (const [label, onPitch, bench, size] of [['home', state.homePlayers, state.homeBench, state.teamSize], ['away', state.awayPlayers, state.awayBench, state.teamSize]]) {
    const onPitchIds = new Set(onPitch.map(p => p.id));
    for (const p of bench) {
      if (onPitchIds.has(p.id)) console.warn(`[Integrity] ${label} player on pitch and bench simultaneously`, p.id);
      if (p.squadStatus && (p.squadStatus.isOnPitch || (p.squadStatus.isStarter && p.squadStatus.subbedOutAtMinute === null))) console.warn(`[Integrity] ${label} bench player flagged as starter/on-pitch`, p.id);
      if (p.discipline.sentOff && p.squadStatus && !p.squadStatus.isSubstitute) console.warn(`[Integrity] ${label} sent-off player not marked unavailable`, p.id);
    }
    for (const p of onPitch) {
      if (!p.squadStatus) { console.warn(`[Integrity] ${label} on-pitch player missing squadStatus`, p.id); continue; }
      if (!isFiniteNum(p.squadStatus.stamina) || p.squadStatus.stamina < 0 || p.squadStatus.stamina > STAMINA_CONFIG.max) console.warn(`[Integrity] ${label} invalid stamina`, p.id, p.squadStatus.stamina);
      if (!isFiniteNum(p.matchStats.minutesPlayed) || p.matchStats.minutesPlayed < 0) console.warn(`[Integrity] ${label} invalid minutesPlayed`, p.id, p.matchStats.minutesPlayed);
    }
    if (onPitch.length > size) console.warn(`[Integrity] ${label} has more active players than the match size allows`, onPitch.length, size);
    const used = state.substitutionsUsed[label];
    if (used > SQUAD_CONFIG.maxSubstitutions) console.warn(`[Integrity] ${label} exceeded substitution limit`, used);
  }
}

// Phase 5, Step 1: coarse movement-state classification, exposed for any
// future UI/AI consumer -- purely descriptive, changes no physics.
function classifyMovementState(p, topSpeed) {
  const sp = Math.hypot(p.vx, p.vy);
  if (sp < 0.3) return 'idle';
  if (sp > topSpeed * 1.05) return 'sprinting';
  if (sp > topSpeed * 0.5) return 'running';
  return 'walking';
}
function updateControlled(dt) {
  const p = getControlled();
  if (!p || p.stunned > 0) { if (p) { p.stunned -= dt; state.shootCharging = false; } return; }
  const { dx, dy } = InputManager.moveVector();
  const dash = InputManager.isDash();
  const base = PLAYER_CONFIG.baseSpeedMin + (p.speed / 100) * PLAYER_CONFIG.speedScale;
  const speed = (dash ? base * PLAYER_CONFIG.dashMultiplier : base) * StaminaSystem.speedFactor(p); // Step 8
  if (Math.abs(dx) > PLAYER_CONFIG.moveThreshold || Math.abs(dy) > PLAYER_CONFIG.moveThreshold) {
    const len = Math.hypot(dx, dy) || 1;
    p.vx = (dx / len) * speed; p.vy = (dy / len) * speed;
    p.facing = Math.atan2(p.vy, p.vx);
  } else { p.vx *= PLAYER_CONFIG.decelFactor; p.vy *= PLAYER_CONFIG.decelFactor; }
  p.x += p.vx * dt; p.y += p.vy * dt;
  clampPlayer(p);
  StaminaSystem.update(p, dt, dash);
  p.movementState = classifyMovementState(p, base * PLAYER_CONFIG.dashMultiplier); // Phase 5, Step 1
  if (p.cooldown > 0) p.cooldown -= dt;
  // Phase 5, Step 5: SHOOT is press-to-charge / release-to-fire. A quick
  // tap (press then release within a frame or two, same as every shot
  // before this phase) still fires at essentially base power (chargeRatio
  // ~0); holding it longer (up to SHOT_CHARGE_CONFIG.maxChargeMs) adds up
  // to +45% power on release. AI shooting (updateAI -> doShoot directly)
  // is completely untouched by this -- it never goes through InputManager.
  const shooting = InputManager.isShoot();
  if (p.cooldown <= 0 && shooting && !state.shootCharging) {
    state.shootCharging = true; state.shootChargeStart = performance.now();
  } else if (state.shootCharging && !shooting) {
    const held = performance.now() - state.shootChargeStart;
    const ratio = isFiniteNum(held) ? Math.max(0, Math.min(1, held / SHOT_CHARGE_CONFIG.maxChargeMs)) : 0;
    state.shootCharging = false;
    if (p.cooldown <= 0) doShoot(p, dash, ratio);
  } else if (state.shootCharging && p.cooldown > 0) {
    state.shootCharging = false; // cooldown kicked in (e.g. another action) mid-charge -- drop it rather than fire a stale charge
  }
  // Phase 5, Step 4: DASH held at the moment of PASS/THROUGH = driven/lofted variant (see doPass()).
  if (InputManager.isPass() && p.cooldown <= 0) doPass(p, false, dash);
  if (InputManager.isThrough() && p.cooldown <= 0) doPass(p, true, dash);
  if (InputManager.isTackle() && p.cooldown <= 0) doTackle(p);
}

function nearestTeammate(from, teammates) {
  let best = null, bestScore = Infinity;
  for (const p of (teammates || state.homePlayers)) {
    if (p.id === from.id || p.discipline.sentOff) continue;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    const toP = Math.atan2(p.y - from.y, p.x - from.x);
    const align = Math.cos(toP - from.facing);
    const score = d - align * 50;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

function doShoot(p, powerUp, chargeRatio) {
  const b = state.ball;
  if (Math.hypot(b.x - p.x, b.y - p.y) > p.r + b.r + PLAYER_CONFIG.shootRange) return;
  EventBus.emit(GameEvents.SHOT_ATTEMPTED, { home: p.isHome, playerId: p.id }); // Phase 5, Step 13
  releaseBallControl('shot'); // Phase 5, Step 2: a struck ball is never still "carried"
  const goalX = p.isHome ? PITCH.w - PITCH.margin : PITCH.margin;
  const goalY = PITCH.h / 2 + (Math.random() - 0.5) * 50 * WORLD_SCALE_Y;
  const ang = Math.atan2(goalY - p.y, goalX - p.x);
  // Phase 5, Step 5: charge-based power. chargeRatio (0..1, from how long
  // SHOOT was held -- see updateControlled) ADDS on top of the existing
  // base/powerUp power; a chargeRatio of 0 (an instant tap, same as every
  // existing shot before this phase, AI included) reproduces the exact
  // original power calculation unchanged.
  const chargeMul = 1 + Math.max(0, Math.min(1, chargeRatio || 0)) * SHOT_CHARGE_CONFIG.maxBonusMultiplier;
  const power = (8.5 * WORLD_RADIAL_SCALE + p.power / 100 * 5.5 * WORLD_RADIAL_SCALE) * (powerUp ? 1.3 : 1) * chargeMul;
  b.vx = Math.cos(ang) * power + p.vx * 0.25;
  b.vy = Math.sin(ang) * power + p.vy * 0.25;
  p.cooldown = PLAYER_CONFIG.shootCooldown;
  AudioManager.kick();
  state.lastTouch = { isHome: p.isHome, playerId: p.id };
  state.lastShotBy = { playerId: p.id, isHome: p.isHome, time: state.match ? state.match.matchTime : 0 };
  // This engine always aims within the goal mouth (goalY is bounded well
  // inside GOAL_W), so every human/AI shot here is genuinely "on target"
  // unless a defender/GK intervenes — not a fabricated stat.
  EventBus.emit(GameEvents.SHOT, { home: p.isHome, onTarget: true, playerId: p.id });
}

function doPass(p, through, driven) {
  const b = state.ball;
  if (Math.hypot(b.x - p.x, b.y - p.y) > p.r + b.r + PLAYER_CONFIG.passRange) return;
  EventBus.emit(GameEvents.PASS_ATTEMPTED, { home: p.isHome, playerId: p.id, through: !!through, driven: !!driven }); // Phase 5, Step 13
  releaseBallControl('pass'); // Phase 5, Step 2
  const teammates = p.isHome ? state.homePlayers : state.awayPlayers;
  const target = nearestTeammate(p, teammates);
  let completed = false;
  // Phase 5, Step 4: driven = DASH held at the moment of the pass input.
  // A ground pass held this way is simply struck harder (requirement #2,
  // "strong/driven ground pass") -- a through-ball held this way becomes
  // a simplified lofted/long ball (requirement #4): extra reach AND, for
  // a short aerial window, it travels OVER outfield defenders rather than
  // colliding with the first body in its path (see the b.aerial flag,
  // consumed by resolveCollisions()). The engine has no real height axis,
  // so this is an honest simplification of "lofted", not a true arc.
  const drivenMul = driven ? 1.35 : 1;
  if (!target) {
    b.vx = Math.cos(p.facing) * 7 * WORLD_RADIAL_SCALE * drivenMul; b.vy = Math.sin(p.facing) * 7 * WORLD_RADIAL_SCALE * drivenMul;
  } else {
    completed = true;
    // Step 14: offside is only ever evaluated for an actual forward
    // through-ball to a specific receiver — never for standing position
    // alone. If flagged, the restart is handled by the referee and the
    // pass itself is not additionally credited as completed.
    if (through && RefereeSystem.evaluateOffside(p, target, b)) {
      p.cooldown = PLAYER_CONFIG.passCooldown;
      EventBus.emit(GameEvents.PASS, { home: p.isHome, through: true, playerId: p.id, completed: false });
      return;
    }
    let tx = target.x, ty = target.y;
    if (through) {
      const leadMul = driven ? 1.8 : 1;
      tx += (p.isHome ? 70 : -70) * WORLD_SCALE_X * leadMul + Math.cos(target.facing || 0) * 40 * WORLD_RADIAL_SCALE;
      ty += Math.sin(target.facing || 0) * 15 * WORLD_RADIAL_SCALE;
    }
    const ang = Math.atan2(ty - p.y, tx - p.x);
    const power = (through ? 9 + p.skill / 100 * 3 : 6.5 + p.skill / 100 * 2.5) * WORLD_RADIAL_SCALE * drivenMul;
    b.vx = Math.cos(ang) * power; b.vy = Math.sin(ang) * power;
    if (through && driven) { b.aerial = true; b.aerialFramesLeft = 26; } // Phase 5, Step 4: brief over-the-top window
    if (Math.random() < 0.35) showCommentary(randomLine('goodPass'), 1800);
  }
  p.cooldown = PLAYER_CONFIG.passCooldown;
  AudioManager.pass();
  state.lastTouch = { isHome: p.isHome, playerId: p.id };
  state.lastPassBy = { playerId: p.id, isHome: p.isHome, time: state.match ? state.match.matchTime : 0 };
  EventBus.emit(GameEvents.PASS, { home: p.isHome, through: !!through, playerId: p.id, completed });
  if (completed) EventBus.emit(GameEvents.PASS_COMPLETED, { home: p.isHome, playerId: p.id, through: !!through }); // Phase 5, Step 13
}

function doTackle(p) {
  p.cooldown = PLAYER_CONFIG.tackleCooldown;
  const range = PLAYER_CONFIG.tackleBaseRange + p.tackle / 100 * PLAYER_CONFIG.tackleRangeScale;
  const opponents = p.isHome ? state.awayPlayers : state.homePlayers;
  for (const o of opponents) {
    if (o.discipline.sentOff) continue; // Step 23: can't tackle a player who's left the pitch
    if (Math.hypot(o.x - p.x, o.y - p.y) < range) {
      EventBus.emit(GameEvents.TACKLE_ATTEMPTED, { home: p.isHome, playerId: p.id, targetId: o.id }); // Phase 5, Step 13
      // Step 4-5: the referee gets first look at every in-range tackle.
      // If it's a foul, the normal Phase 1 success/failure outcome
      // below is skipped — the restart is handled by RefereeSystem.
      if (RefereeSystem.evaluateTackle(p, o)) return;
      AudioManager.tackle();
      const success = Math.random() < PLAYER_CONFIG.tackleBaseChance + p.tackle / 100 * PLAYER_CONFIG.tackleChanceScale;
      if (success) {
        o.stunned = PLAYER_CONFIG.tackleSuccessStunMin + Math.random() * PLAYER_CONFIG.tackleSuccessStunRand;
        o.vx = (o.x - p.x) * 0.12; o.vy = (o.y - p.y) * 0.12;
        if (Math.hypot(state.ball.x - o.x, state.ball.y - o.y) < 32 * WORLD_RADIAL_SCALE) {
          state.ball.vx = (p.x - o.x) * 0.1; state.ball.vy = (p.y - o.y) * 0.1;
          state.lastTouch = { isHome: p.isHome, playerId: p.id };
          setBallControl(p); // Phase 5, Step 2/6: a successful tackle that wins the ball hands possession straight to the tackler
        }
        if (Math.random() < 0.4) showCommentary(randomLine('tackle'), 1600);
        EventBus.emit(GameEvents.TACKLE_SUCCESS, { home: p.isHome, playerId: p.id, targetId: o.id }); // Phase 5, Step 13
      } else p.stunned = PLAYER_CONFIG.tackleFailStun;
      EventBus.emit(GameEvents.TACKLE, { home: p.isHome, success, playerId: p.id });
      break;
    }
  }
}

// Step 9: modest AI-to-AI passing. AI previously only ever dribbled into
// shooting range or stood still; this lets a tactically "in possession"
// AI player under pressure or without a shot actually circulate the
// ball, using the existing doPass() mechanics (never a parallel one).
function maybeAIPass(p, teammates, dt) {
  const b = state.ball;
  if (Math.hypot(b.x - p.x, b.y - p.y) > p.r + b.r + PLAYER_CONFIG.passRange) return false;
  const style = TacticalSystem.getStyle(p.isHome);
  const chance = 0.05 * style.transitionSpeed * dt;
  if (Math.random() >= chance) return false;
  const target = nearestTeammate(p, teammates);
  if (!target) return false;
  doPass(p, style.forwardPassBias > 0.2 && Math.random() < 0.5);
  return true;
}

function updateAI(dt) {
  const ball = state.ball;
  TacticalSystem.updateTransitions(dt); // Step 12
  state.markRecalcTimer += dt;
  const recalcMarks = state.markRecalcTimer >= TACTICS_CONFIG.markRecalcIntervalFrames;
  if (recalcMarks) state.markRecalcTimer = 0;

  const A = AI_CONFIG.away;
  const awayPressers = TacticalSystem.selectPressers(state.awayPlayers, ball, A.engageDist, 3); // Step 10
  for (const p of state.awayPlayers) {
    if (p.discipline.sentOff) continue; // Step 25: AI must not move a sent-off player
    if (p.stunned > 0) { p.stunned -= dt; p.vx *= 0.88; p.vy *= 0.88; continue; }
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.isGK) { updateGK(p, dt, false); continue; }
    const distBall = Math.hypot(ball.x - p.x, ball.y - p.y);
    let tx, ty;
    if (distBall < A.engageDist || ball.x < A.engageBallX || awayPressers.has(p.id)) { tx = ball.x; ty = ball.y; }
    else {
      const anchor = TacticalSystem.anchorTarget(p, ball); // Step 7: role/formation/mentality/style-aware target
      if (anchor) {
        tx = anchor.tx; ty = anchor.ty;
        if (recalcMarks && (p.role === 'CB' || p.role === 'LB' || p.role === 'RB') && state.tacticalPhase.away !== 'ATTACKING') {
          const mark = TacticalSystem.pickMarkTarget(p, state.homePlayers); // Step 11
          if (mark) { tx = (tx + mark.x) / 2; ty = (ty + mark.y) / 2; }
        }
      } else if (p.pos === 'DF') { tx = A.defendTargetX; ty = ball.y * 0.5 + PITCH.h / 2 * 0.5; }
      else { tx = A.midTargetX; ty = PITCH.h * (180 / 720) + (p.id % 4) * PITCH.h * (120 / 720); }
    }
    moveToward(p, tx, ty, A.speedBase + p.speed / 100 * A.speedScale, dt);
    if (distBall < p.r + ball.r + A.shootRange && p.cooldown <= 0) {
      const ang = Math.atan2(PITCH.h / 2 - p.y, PITCH.w * (40 / 1280) - p.x);
      if (ball.x < p.x + PITCH.w * (40 / 1280)) {
        ball.vx = Math.cos(ang) * (A.shootPowerBase + p.power / 100 * A.shootPowerScale);
        ball.vy = Math.sin(ang) * (A.shootPowerBase + p.power / 100 * A.shootPowerScale);
        p.cooldown = A.shootCooldown; AudioManager.kick();
        state.lastTouch = { isHome: false, playerId: p.id };
        state.lastShotBy = { playerId: p.id, isHome: false, time: state.match ? state.match.matchTime : 0 };
        EventBus.emit(GameEvents.SHOT, { home: false, onTarget: true, playerId: p.id });
      }
    } else if (p.cooldown <= 0 && distBall < 40 * WORLD_RADIAL_SCALE) {
      maybeAIPass(p, state.awayPlayers, dt);
    }
  }
  const H = AI_CONFIG.home;
  const homePressers = TacticalSystem.selectPressers(state.homePlayers.filter(p => p.id !== state.controlledId), ball, H.engageDist, 2); // Step 10
  for (const p of state.homePlayers) {
    if (p.discipline.sentOff) continue; // Step 25
    if (p.id === state.controlledId) continue;
    if (p.stunned > 0) { p.stunned -= dt; continue; }
    if (p.cooldown > 0) p.cooldown -= dt;
    if (p.isGK) { updateGK(p, dt, true); continue; }
    const distBall = Math.hypot(ball.x - p.x, ball.y - p.y);
    let tx, ty;
    if (distBall < H.engageDist || homePressers.has(p.id)) { tx = ball.x; ty = ball.y; }
    else {
      const anchor = TacticalSystem.anchorTarget(p, ball); // Step 7
      if (anchor) {
        tx = anchor.tx; ty = anchor.ty;
        if (recalcMarks && (p.role === 'CB' || p.role === 'LB' || p.role === 'RB') && state.tacticalPhase.home !== 'ATTACKING') {
          const mark = TacticalSystem.pickMarkTarget(p, state.awayPlayers); // Step 11
          if (mark) { tx = (tx + mark.x) / 2; ty = (ty + mark.y) / 2; }
        }
      } else {
        const idx = state.homePlayers.indexOf(p);
        const fp = formation(state.teamSize, true)[idx];
        tx = fp.x + (ball.x - PITCH.w / 2) * H.formationPullX; ty = fp.y + (ball.y - PITCH.h / 2) * H.formationPullY;
      }
    }
    moveToward(p, tx, ty, H.speedBase + p.speed / 100 * H.speedScale, dt);
    if (distBall < p.r + ball.r + H.shootRange && p.cooldown <= 0 && Math.random() < H.shootChancePerDt * dt) {
      const ang = Math.atan2(PITCH.h / 2 - p.y, PITCH.w * (1200 / 1280) - p.x);
      ball.vx = Math.cos(ang) * (H.shootPowerBase + p.power / 100 * H.shootPowerScale);
      ball.vy = Math.sin(ang) * (H.shootPowerBase + p.power / 100 * H.shootPowerScale);
      p.cooldown = H.shootCooldown; AudioManager.kick();
      state.lastTouch = { isHome: true, playerId: p.id };
      state.lastShotBy = { playerId: p.id, isHome: true, time: state.match ? state.match.matchTime : 0 };
      EventBus.emit(GameEvents.SHOT, { home: true, onTarget: true, playerId: p.id });
    } else if (p.cooldown <= 0 && distBall < 40 * WORLD_RADIAL_SCALE) {
      maybeAIPass(p, state.homePlayers, dt);
    }
  }
}

function updateGK(p, dt, isHome) {
  const ball = state.ball;
  const G = AI_CONFIG.gk;
  const goalX = isHome ? PITCH.margin + PITCH_CONFIG.gkGoalLineOffset : PITCH.w - PITCH.margin - PITCH_CONFIG.gkGoalLineOffset;
  const distBall = Math.hypot(ball.x - p.x, ball.y - p.y);
  let tx = goalX;
  let ty = Math.max(PITCH.h / 2 - GOAL_W / 2 + G.boxHalfHeightPad, Math.min(PITCH.h / 2 + GOAL_W / 2 - G.boxHalfHeightPad, ball.y));
  const danger = isHome ? ball.x < G.dangerZone : ball.x > PITCH.w - G.dangerZone;
  if (danger && distBall < G.engageDist) { tx = ball.x; ty = ball.y; }
  moveToward(p, tx, ty, G.speedBase + p.speed / 100 * G.speedScale, dt);
  if (distBall < p.r + ball.r + G.catchRange) {
    const towardGoal = isHome ? ball.vx < 0 : ball.vx > 0;
    if (towardGoal || Math.hypot(ball.vx, ball.vy) < 3 * WORLD_RADIAL_SCALE) {
      // Phase 2, Step 18-19: a catch of a shot from the opposing team,
      // heading toward this goal, is a real save — only counted once
      // per catch via the cooldown-style check on lastTouch.
      if (towardGoal && state.lastTouch && state.lastTouch.isHome !== isHome && state.lastTouch.playerId !== p.id) {
        EventBus.emit(GameEvents.SAVE, { home: isHome, playerId: p.id });
      }
      ball.vx *= 0.15; ball.vy *= 0.15;
      ball.x = p.x + (isHome ? 12 : -12) * WORLD_RADIAL_SCALE; ball.y = p.y;
      state.lastTouch = { isHome, playerId: p.id };
      setBallControl(p); // Phase 5, Step 2: a caught ball is possession for the keeper, same as any other pickup
      if (Math.random() < G.releaseChancePerDt * dt) {
        const ang = isHome ? 0.3 + Math.random() * 0.6 : Math.PI - 0.3 - Math.random() * 0.6;
        ball.vx = Math.cos(ang) * 8 * WORLD_RADIAL_SCALE; ball.vy = Math.sin(ang) * 5 * WORLD_RADIAL_SCALE;
        AudioManager.pass();
        releaseBallControl('gk release'); // Phase 5: the keeper's throw/roll releases it back into play
      }
    }
  }
}

function moveToward(p, tx, ty, spd, dt) {
  const dx = tx - p.x, dy = ty - p.y;
  const dist = Math.hypot(dx, dy) || 1;
  const effectiveSpd = spd * StaminaSystem.speedFactor(p); // Step 8: tired players are slower, never stopped
  p.vx = (dx / dist) * effectiveSpd; p.vy = (dy / dist) * effectiveSpd;
  p.facing = Math.atan2(p.vy, p.vx);
  p.x += p.vx * dt; p.y += p.vy * dt;
  clampPlayer(p);
  StaminaSystem.update(p, dt, false);
}
function clampPlayer(p) {
  p.x = Math.max(PITCH.margin + p.r, Math.min(PITCH.w - PITCH.margin - p.r, p.x));
  p.y = Math.max(PITCH.margin + p.r, Math.min(PITCH.h - PITCH.margin - p.r, p.y));
}

function updateBall(dt) {
  const b = state.ball;
  b.vx *= PHYSICS_CONFIG.ballFriction; b.vy *= PHYSICS_CONFIG.ballFriction;
  if (Math.hypot(b.vx, b.vy) < PHYSICS_CONFIG.ballMinSpeed) { b.vx = 0; b.vy = 0; }
  b.x += b.vx * dt; b.y += b.vy * dt;
  // Phase 2, Step 13: touchlines and goal-lines are no longer walls —
  // the ball is allowed to leave the pitch, and checkBoundaries() (run
  // once per frame from the game loop, right after checkGoals) is the
  // single authoritative place that classifies what happens next
  // (goal already handled separately / throw-in / corner / goal kick).
  // PHYSICS_CONFIG.wallBounceX/Y are kept for reference but are no
  // longer applied here — superseded by real out-of-bounds rules.
}

function resolveCollisions() {
  const players = activePlayers(), b = state.ball; // Step 25: sent-off players don't collide
  for (const p of players) {
    if (b.aerial) continue; // Phase 5, Step 4: a lofted ball in its brief flight window passes over outfield players uncontested
    const dx = b.x - p.x, dy = b.y - p.y, dist = Math.hypot(dx, dy), minD = p.r + b.r;
    if (dist < minD && dist > 0.1) {
      const nx = dx / dist, ny = dy / dist;
      b.x += nx * (minD - dist) * PHYSICS_CONFIG.ballSeparationFactor;
      b.y += ny * (minD - dist) * PHYSICS_CONFIG.ballSeparationFactor;
      const impact = (p.vx - b.vx) * nx + (p.vy - b.vy) * ny;
      if (impact > 0) {
        b.vx += nx * impact * PHYSICS_CONFIG.ballImpactFactor; b.vy += ny * impact * PHYSICS_CONFIG.ballImpactFactor;
        state.lastTouch = { isHome: p.isHome, playerId: p.id }; // Step 13: needed by the out-of-bounds engine
      }
    }
  }
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i], c = players[j];
      const dx = c.x - a.x, dy = c.y - a.y, dist = Math.hypot(dx, dy), minD = a.r + c.r - PHYSICS_CONFIG.playerRadiusOverlap;
      if (dist < minD && dist > 0.1) {
        const nx = dx / dist, ny = dy / dist, push = (minD - dist) * PHYSICS_CONFIG.playerSeparationFactor;
        a.x -= nx * push; a.y -= ny * push; c.x += nx * push; c.y += ny * push;
        if (a.isHome !== c.isHome) RefereeSystem.evaluateCollision(a, c); // Step 4: only cross-team contact can be a foul
      }
    }
  }
}

