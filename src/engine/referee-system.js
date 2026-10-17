/* =====================================================================
   REFEREE SYSTEM (Phase 2, Steps 4-9, 14-16)
   Central rules authority. Every foul/card/offside/advantage decision
   in the match goes through here, driven only by real gameplay state
   (tackle attempts, collisions, pass targets) — nothing here is a
   random background event unconnected to what's happening on the ball.
   ===================================================================== */
const RefereeSystem = {
  /* Step 4-5: called from doTackle() for every in-range tackle attempt.
     Returns true if a foul was whistled (caller should not also apply
     the normal Phase 1 tackle-success/failure outcome). */
  evaluateTackle(tackler, victim) {
    const cfg = RULES_CONFIG.fouls;
    if (!cfg.enabled) return false;
    if (Math.random() >= cfg.tackleFoulChance) return false; // most tackles play out exactly as Phase 1
    const severity = Math.min(1, Math.max(0, (1 - tackler.tackle / 100) * 0.6 + Math.random() * 0.5));
    const fromBehind = Math.cos(tackler.facing - Math.atan2(tackler.y - victim.y, tackler.x - victim.x)) < -0.2;
    const type = severity > cfg.recklessThreshold ? 'reckless_tackle' : (fromBehind ? 'foul_from_behind' : 'late_tackle');
    this._whistle(tackler, victim, type, severity);
    return true;
  },
  /* Step 4: called from resolveCollisions for any hard cross-team
     collision. Gated by a real relative-velocity threshold and a
     per-pair cooldown so a scrum of players doesn't spam fouls. */
  evaluateCollision(a, c) {
    const cfg = RULES_CONFIG.fouls;
    if (!cfg.enabled) return;
    const relSpeed = Math.hypot(a.vx - c.vx, a.vy - c.vy);
    if (relSpeed < cfg.collisionThreshold) return; // normal shoulder-to-shoulder contact — never a foul
    const key = a.id < c.id ? `${a.id}-${c.id}` : `${c.id}-${a.id}`;
    const now = performance.now();
    if (now - (state.collisionFoulCooldowns[key] || 0) < cfg.collisionCooldownMs) return;
    if (Math.random() >= cfg.collisionFoulChance) return;
    state.collisionFoulCooldowns[key] = now;
    const [tackler, victim] = Math.hypot(a.vx, a.vy) >= Math.hypot(c.vx, c.vy) ? [a, c] : [c, a];
    const severity = Math.min(1, 0.35 + (relSpeed - cfg.collisionThreshold) / 12);
    this._whistle(tackler, victim, 'collision_foul', severity);
  },
  _whistle(offender, victim, type, severity) {
    if (offender.discipline.sentOff) return; // Step 23: an off-pitch player can't commit a new foul
    const cfg = RULES_CONFIG.fouls;
    const foul = {
      id: state.nextFoulEventId++, type, playerId: offender.id, teamId: offender.team.id,
      victimPlayerId: victim.id, location: { x: offender.x, y: offender.y },
      severity: Math.round(severity * 100) / 100, timestamp: state.match ? state.match.matchTime : 0,
    };
    offender.cooldown = Math.max(offender.cooldown, PLAYER_CONFIG.tackleCooldown);
    EventBus.emit(GameEvents.FOUL, { ...foul, home: offender.isHome });
    if (this.applyAdvantage(victim)) {
      showRulesBanner('ADVANTAGE', '#facc15', 1100);
      AudioManager.foulWhistle();
      if (severity > cfg.recklessThreshold) this.issueCard(offender, severity > cfg.seriousFoulThreshold ? 'red' : 'yellow', foul);
      return;
    }
    AudioManager.foulWhistle();
    showRulesBanner('FOUL', '#f87171', 1300);
    showCommentary(randomLine('foul'), 1800);
    if (severity > cfg.recklessThreshold) {
      this.issueCard(offender, severity > cfg.seriousFoulThreshold ? 'red' : 'yellow', foul);
    }
    this._startRestartFromFoul(offender, foul);
  },
  _startRestartFromFoul(offender, foul) {
    const defendingIsHome = offender.isHome;
    const box = penaltyBoxFor(defendingIsHome);
    const inBox = foul.location.x >= box.x0 && foul.location.x <= box.x1
      && foul.location.y >= box.y0 && foul.location.y <= box.y1;
    if (inBox) SetPieceManager.start('PENALTY', { teamId: (defendingIsHome ? state.awayTeam : state.homeTeam).id, teamIsHome: !defendingIsHome, location: { x: foul.location.x, y: foul.location.y }, victimId: foul.victimPlayerId });
    else SetPieceManager.start('FREE_KICK', { teamId: (defendingIsHome ? state.awayTeam : state.homeTeam).id, teamIsHome: !defendingIsHome, location: foul.location, victimId: foul.victimPlayerId });
  },
  /* Step 6-7: yellow/red card bookkeeping and sending a player off. */
  issueCard(player, kind, foulRef) {
    if (player.discipline.sentOff) return;
    if (kind === 'yellow') {
      player.discipline.yellowCards++;
      if (player.discipline.yellowCards >= RULES_CONFIG.cards.yellowToRed) {
        this.issueCard(player, 'red', foulRef);
        return;
      }
      AudioManager.card(false);
      showRulesBanner('YELLOW CARD', '#facc15', 1600);
      showCommentary(randomLine('yellow'), 2000);
      EventBus.emit(GameEvents.YELLOW_CARD, { home: player.isHome, playerId: player.id });
    } else {
      player.discipline.redCard = true;
      player.discipline.sentOff = true;
      AudioManager.card(true);
      showRulesBanner('RED CARD', '#ef4444', 2000);
      showCommentary(randomLine('red'), 2400);
      if (state.controlledId === player.id) getControlled();
      EventBus.emit(GameEvents.RED_CARD, { home: player.isHome, playerId: player.id });
    }
  },
  /* Step 15: simple advantage. */
  applyAdvantage(victim) {
    if (!RULES_CONFIG.advantage.enabled) return false;
    const b = state.ball;
    const towardAwayGoal = victim.isHome && b.vx > RULES_CONFIG.advantage.minBallSpeedTowardGoal;
    const towardHomeGoal = !victim.isHome && b.vx < -RULES_CONFIG.advantage.minBallSpeedTowardGoal;
    if (!towardAwayGoal && !towardHomeGoal) return false;
    const mine = (victim.isHome ? state.homePlayers : state.awayPlayers).filter(p => !p.discipline.sentOff);
    const theirs = (victim.isHome ? state.awayPlayers : state.homePlayers).filter(p => !p.discipline.sentOff);
    const closest = arr => arr.reduce((best, p) => {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      return d < best ? d : best;
    }, Infinity);
    return closest(mine) < closest(theirs);
  },
  /* Step 14: offside check, run at the moment of a forward through pass. */
  evaluateOffside(passer, receiver, ball) {
    if (!RULES_CONFIG.offside.enabled || !receiver) return false;
    const defenders = (passer.isHome ? state.awayPlayers : state.homePlayers)
      .filter(p => !p.isGK && !p.discipline.sentOff);
    if (defenders.length < 2) return false;
    const sorted = defenders.slice().sort((a, b2) => passer.isHome ? b2.x - a.x : a.x - b2.x);
    const secondLastX = sorted[1].x;
    const buf = RULES_CONFIG.offside.offsideBuffer;
    const beyondDefense = passer.isHome ? receiver.x > secondLastX + buf : receiver.x < secondLastX - buf;
    const beyondBall = passer.isHome ? receiver.x > ball.x + buf : receiver.x < ball.x - buf;
    if (!beyondDefense || !beyondBall) return false;
    EventBus.emit(GameEvents.OFFSIDE, { home: receiver.isHome, playerId: receiver.id, passerId: passer.id, location: { x: receiver.x, y: receiver.y } });
    AudioManager.offside();
    showRulesBanner('OFFSIDE', '#fb923c', 1500);
    showCommentary(randomLine('offside'), 1800);
    SetPieceManager.start('FREE_KICK', { teamId: (receiver.isHome ? state.awayTeam : state.homeTeam).id, teamIsHome: !receiver.isHome, location: { x: receiver.x, y: receiver.y } });
    return true;
  },
  /* Step 11-13: out-of-bounds classification. */
  evaluateBoundary() {
    const b = state.ball;
    const gTop = PITCH.h / 2 - GOAL_W / 2, gBot = PITCH.h / 2 + GOAL_W / 2;
    const touch = state.lastTouch;
    if (b.y < PITCH.margin || b.y > PITCH.h - PITCH.margin) {
      const restartIsHome = touch ? !touch.isHome : true;
      const inset = RULES_CONFIG.boundaries.throwInInset;
      const loc = { x: Math.max(PITCH.margin, Math.min(PITCH.w - PITCH.margin, b.x)), y: b.y < PITCH.margin ? PITCH.margin + inset : PITCH.h - PITCH.margin - inset };
      SetPieceManager.start('THROW_IN', { teamId: (restartIsHome ? state.homeTeam : state.awayTeam).id, teamIsHome: restartIsHome, location: loc });
      return true;
    }
    if (b.x < PITCH.margin && !(b.y > gTop && b.y < gBot)) {
      const defenderTouchedLast = touch ? touch.isHome : true;
      if (defenderTouchedLast) SetPieceManager.start('CORNER', { teamId: state.awayTeam.id, teamIsHome: false, location: { x: PITCH.margin + RULES_CONFIG.boundaries.cornerInset, y: b.y < PITCH.h / 2 ? PITCH.margin + RULES_CONFIG.boundaries.cornerInset : PITCH.h - PITCH.margin - RULES_CONFIG.boundaries.cornerInset } });
      else SetPieceManager.start('GOAL_KICK', { teamId: state.homeTeam.id, teamIsHome: true, location: { x: PITCH.margin + RULES_CONFIG.boundaries.goalKickInset, y: PITCH.h / 2 } });
      return true;
    }
    if (b.x > PITCH.w - PITCH.margin && !(b.y > gTop && b.y < gBot)) {
      const defenderTouchedLast = touch ? !touch.isHome : true;
      if (defenderTouchedLast) SetPieceManager.start('CORNER', { teamId: state.homeTeam.id, teamIsHome: true, location: { x: PITCH.w - PITCH.margin - RULES_CONFIG.boundaries.cornerInset, y: b.y < PITCH.h / 2 ? PITCH.margin + RULES_CONFIG.boundaries.cornerInset : PITCH.h - PITCH.margin - RULES_CONFIG.boundaries.cornerInset } });
      else SetPieceManager.start('GOAL_KICK', { teamId: state.awayTeam.id, teamIsHome: false, location: { x: PITCH.w - PITCH.margin - RULES_CONFIG.boundaries.goalKickInset, y: PITCH.h / 2 } });
      return true;
    }
    return false;
  },
};
function penaltyBoxFor(isHome) {
  const penW = PITCH_CONFIG.penaltyAreaDepth, penH = PITCH_CONFIG.penaltyAreaWidth;
  return isHome
    ? { x0: PITCH.margin, x1: PITCH.margin + penW, y0: PITCH.h / 2 - penH / 2, y1: PITCH.h / 2 + penH / 2 }
    : { x0: PITCH.w - PITCH.margin - penW, x1: PITCH.w - PITCH.margin, y0: PITCH.h / 2 - penH / 2, y1: PITCH.h / 2 + penH / 2 };
}

