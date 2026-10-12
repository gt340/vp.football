/* =====================================================================
   SET-PIECE MANAGER (Phase 2, Steps 8-13, 24)
   ===================================================================== */
const SetPieceManager = {
  start(type, opts) {
    if (!state.match) return;
    const s = {
      type, teamId: opts.teamId, teamIsHome: opts.teamIsHome, location: opts.location,
      takerId: opts.takerId || null, victimId: opts.victimId || null,
      timer: RULES_CONFIG.setPieces.freezeFrames, phase: 'positioning', active: true,
    };
    state.setPiece = s; state.match.setPiece = { type, teamIsHome: s.teamIsHome, location: s.location };
    this.positionBall(s); this.selectTaker(s); this.positionPlayers(s);
    AudioManager.setPieceWhistle();
    const label = { FREE_KICK: 'FREE KICK', PENALTY: 'PENALTY', CORNER: 'CORNER', GOAL_KICK: 'GOAL KICK', THROW_IN: 'THROW-IN' }[type] || type;
    showRulesBanner(label, '#38bdf8', 1300);
    const evt = { FREE_KICK: GameEvents.FREE_KICK, PENALTY: GameEvents.PENALTY, CORNER: GameEvents.CORNER, GOAL_KICK: GameEvents.GOAL_KICK, THROW_IN: GameEvents.THROW_IN }[type];
    if (evt) EventBus.emit(evt, { home: s.teamIsHome, location: s.location });
    if (type === 'CORNER') showCommentary(randomLine('corner'), 1600);
    else if (type === 'GOAL_KICK') showCommentary(randomLine('goalKick'), 1600);
    else if (type === 'THROW_IN') showCommentary(randomLine('throwIn'), 1500);
    else if (type === 'PENALTY') showCommentary(randomLine('penalty'), 2200);
  },
  positionBall(s) {
    const b = state.ball;
    b.vx = 0; b.vy = 0;
    releaseBallControl('set piece'); // Phase 5: a set piece always starts from a loose/placed ball, never a carried one
    if (s.type === 'PENALTY') { b.x = s.teamIsHome ? PITCH.margin + PITCH_CONFIG.penaltySpotOffset : PITCH.w - PITCH.margin - PITCH_CONFIG.penaltySpotOffset; b.y = PITCH.h / 2; }
    else { b.x = s.location.x; b.y = s.location.y; }
  },
  selectTaker(s) {
    const teamPlayers = (s.teamIsHome ? state.homePlayers : state.awayPlayers).filter(p => !p.discipline.sentOff && !p.isGK);
    if (!teamPlayers.length) { s.takerId = null; return; }
    if (s.type === 'PENALTY') {
      s.takerId = teamPlayers.reduce((a, b2) => (b2.power > a.power ? b2 : a)).id;
    } else {
      let best = teamPlayers[0], bestD = Infinity;
      for (const p of teamPlayers) { const d = Math.hypot(p.x - s.location.x, p.y - s.location.y); if (d < bestD) { bestD = d; best = p; } }
      s.takerId = best.id;
    }
  },
  positionPlayers(s) {
    const taker = findPlayerById(s.takerId);
    if (taker) { taker.x = s.type === 'PENALTY' ? (s.teamIsHome ? PITCH.margin + PITCH_CONFIG.penaltyTakerOffset : PITCH.w - PITCH.margin - PITCH_CONFIG.penaltyTakerOffset) : s.location.x; taker.y = s.type === 'PENALTY' ? PITCH.h / 2 : s.location.y; taker.vx = 0; taker.vy = 0; }
    if (s.type === 'PENALTY') {
      const defendingGK = (s.teamIsHome ? state.awayPlayers : state.homePlayers).find(p => p.isGK && !p.discipline.sentOff);
      if (defendingGK) { defendingGK.x = s.teamIsHome ? PITCH.margin + PITCH_CONFIG.gkGoalLineOffset : PITCH.w - PITCH.margin - PITCH_CONFIG.gkGoalLineOffset; defendingGK.y = PITCH.h / 2; defendingGK.vx = 0; defendingGK.vy = 0; }
    }
    const radius = s.type === 'PENALTY' ? 999 : RULES_CONFIG.setPieces.repositionRadius;
    for (const p of activePlayers()) {
      if (taker && p.id === taker.id) continue;
      if (p.isGK) continue;
      const d = Math.hypot(p.x - s.location.x, p.y - s.location.y);
      if (d < radius) {
        const ang = Math.atan2(p.y - s.location.y, p.x - s.location.x) || (p.isHome ? Math.PI : 0);
        p.x = s.location.x + Math.cos(ang) * radius; p.y = s.location.y + Math.sin(ang) * radius;
        clampPlayer(p);
      }
      p.vx = 0; p.vy = 0;
    }
  },
  update(dt) {
    const s = state.setPiece;
    if (!s || !s.active) return;
    s.timer -= dt;
    const taker = findPlayerById(s.takerId);
    const humanTaking = taker && taker.id === state.controlledId && !taker.isGK;
    if (humanTaking && s.type !== 'THROW_IN') {
      if (InputManager.isShoot()) { this.execute(s, 'shoot'); return; }
      if (InputManager.isPass() || InputManager.isThrough()) { this.execute(s, 'pass'); return; }
    }
    if (s.timer <= 0) this.execute(s, s.type === 'PENALTY' ? 'shoot' : 'pass');
  },
  execute(s, mode) {
    const taker = findPlayerById(s.takerId);
    if (taker) {
      taker.cooldown = 0;
      if (mode === 'shoot') doShoot(taker, s.type === 'PENALTY');
      else doPass(taker, s.type === 'FREE_KICK');
    }
    this.finish();
  },
  finish() {
    state.setPiece = null;
    if (state.match) state.match.setPiece = null;
  },
};

