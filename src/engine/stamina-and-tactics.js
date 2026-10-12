/* =====================================================================
   STAMINA SYSTEM (Phase 4, Step 8)
   Drains from how hard a player is actually working this frame (their
   own velocity relative to their top speed, boosted while dashing) and
   recovers when idle, walking, or on the bench. Single integration
   point: moveToward() (all AI/GK movement) and updateControlled()
   (the human player) both call update() after setting velocity, so
   every mover is covered without touching every call site individually.
   ===================================================================== */
const StaminaSystem = {
  _notified: {}, // playerId -> tier last notified, avoids repeat commentary every frame at the same tier
  update(p, dt, isDashing) {
    if (!p.squadStatus) return;
    if (!isFiniteNum(p.squadStatus.stamina)) p.squadStatus.stamina = STAMINA_CONFIG.max; // NaN/Infinity/undefined guard
    p.squadStatus.stamina = Math.max(0, Math.min(STAMINA_CONFIG.max, p.squadStatus.stamina));
    const speedNow = Math.hypot(p.vx, p.vy);
    const topSpeed = PLAYER_CONFIG.baseSpeedMin + (p.speed / 100) * PLAYER_CONFIG.speedScale * PLAYER_CONFIG.dashMultiplier;
    const intensity = topSpeed > 0 ? Math.min(1, speedNow / topSpeed) : 0;
    if (intensity > 0.15) {
      const drain = STAMINA_CONFIG.drainPerFrameAtFullSpeed * intensity * (isDashing ? STAMINA_CONFIG.drainDashMultiplier : 1);
      p.squadStatus.stamina = Math.max(0, p.squadStatus.stamina - drain * dt);
    } else {
      const recover = intensity > 0.02 ? STAMINA_CONFIG.recoveryPerFrameWalking : STAMINA_CONFIG.recoveryPerFrameIdle;
      p.squadStatus.stamina = Math.min(STAMINA_CONFIG.max, p.squadStatus.stamina + recover * dt);
    }
    const tier = this.tier(p);
    if (tier !== this._notified[p.id] && (tier === 'LOW' || tier === 'CRITICAL')) {
      this._notified[p.id] = tier;
      const evt = tier === 'CRITICAL' ? GameEvents.PLAYER_EXHAUSTED : GameEvents.STAMINA_LOW;
      EventBus.emit(evt, { home: p.isHome, playerId: p.id, tier });
      if (tier === 'CRITICAL') showCommentary(`${p.name} is showing real signs of fatigue.`, 1800);
    } else if (tier === 'HIGH') {
      this._notified[p.id] = tier;
    }
  },
  // Step 8: bench players recover passively — called once/frame from the
  // main loop for both benches (cheap: just the bench arrays, not a full
  // squad scan).
  recoverBench(dt) {
    for (const p of [...state.homeBench, ...state.awayBench]) if (p.squadStatus) p.squadStatus.stamina = isFiniteNum(p.squadStatus.stamina) ? Math.max(0, Math.min(STAMINA_CONFIG.max, p.squadStatus.stamina)) : STAMINA_CONFIG.max; // NaN/Infinity/range guard
    for (const p of state.homeBench) if (p.squadStatus) p.squadStatus.stamina = Math.min(STAMINA_CONFIG.max, p.squadStatus.stamina + STAMINA_CONFIG.recoveryPerFrameIdle * dt);
    for (const p of state.awayBench) if (p.squadStatus) p.squadStatus.stamina = Math.min(STAMINA_CONFIG.max, p.squadStatus.stamina + STAMINA_CONFIG.recoveryPerFrameIdle * dt);
  },
  tier(p) { return staminaTier(p.squadStatus ? p.squadStatus.stamina : STAMINA_CONFIG.max); },
  speedFactor(p) { return STAMINA_CONFIG.speedFactorByTier[this.tier(p)]; },
  pressFactor(p) { return STAMINA_CONFIG.pressFactorByTier[this.tier(p)]; },
};

const TacticalSystem = {
  /* Step 3, 5, 6: current tactics for a side. Home is user-editable via
     the UI; away is a fixed AI-only profile so the opponent still plays
     with a real identity without exposing a second control panel. */
  getTactics(isHome) { return isHome ? state.homeTactics : state.awayTactics; },
  getFormation(isHome) { return FORMATIONS[this.getTactics(isHome).formationId] || FORMATIONS[DEFAULT_FORMATION_ID]; },
  getMentality(isHome) { return MENTALITY_DEFS[this.getTactics(isHome).mentality] || MENTALITY_DEFS[DEFAULT_MENTALITY]; },
  getStyle(isHome) { return STYLE_DEFS[this.getTactics(isHome).style] || STYLE_DEFS[DEFAULT_STYLE]; },

  /* Step 4: assign each active player a role (and, for 11-a-side, a
     formation slot anchor). Bucketed by band so a forward is never
     handed a center-back's slot just because of array order. Called
     once at kickoff and again whenever the roster shrinks (red card)
     or the formation changes, never per-frame. */
  assignRoles(players, isHome) {
    const active = players.filter(p => !p.discipline.sentOff);
    const bandOf = (pos) => pos === 'GK' ? 'gk' : pos === 'DF' ? 'def' : pos === 'MF' ? 'mid' : 'fwd';
    if (players.length === 11) {
      const formationDef = this.getFormation(isHome);
      // Keep the strongest XI's worth of slots, trimming from the
      // attacking end first if a red card has reduced the side below 11
      // (Step 14: dynamic compensation without inventing a new player).
      const slots = formationDef.slots.slice(0, active.length);
      const byBand = { gk: [], def: [], mid: [], fwd: [] };
      for (const p of active) byBand[bandOf(p.pos)].push(p);
      const slotsByBand = { gk: [], def: [], mid: [], fwd: [] };
      for (const s of slots) slotsByBand[ROLE_DEFS[s.role] ? ROLE_DEFS[s.role].band : 'mid'].push(s);
      const usedSlots = new Set();
      const assign = (band) => {
        const ps = byBand[band], ss = slotsByBand[band].filter(s => !usedSlots.has(s));
        const n = Math.min(ps.length, ss.length);
        for (let i = 0; i < n; i++) { ps[i].role = ss[i].role; ps[i].tacticalAnchor = { x: ss[i].x, y: ss[i].y }; usedSlots.add(ss[i]); }
        return { leftoverPlayers: ps.slice(n), leftoverSlots: ss.slice(n) };
      };
      const gk = assign('gk'), def = assign('def'), mid = assign('mid'), fwd = assign('fwd');
      // Anyone left over (squad shape doesn't perfectly match the formation
      // template) takes any remaining slot rather than getting no anchor.
      const leftoverPlayers = [...gk.leftoverPlayers, ...def.leftoverPlayers, ...mid.leftoverPlayers, ...fwd.leftoverPlayers];
      const leftoverSlots = [...gk.leftoverSlots, ...def.leftoverSlots, ...mid.leftoverSlots, ...fwd.leftoverSlots];
      for (let i = 0; i < Math.min(leftoverPlayers.length, leftoverSlots.length); i++) {
        leftoverPlayers[i].role = leftoverSlots[i].role; leftoverPlayers[i].tacticalAnchor = { x: leftoverSlots[i].x, y: leftoverSlots[i].y };
      }
    } else {
      // Step 4 (5v5/7v7): generic role per position, no fixed formation
      // slot — mentality/style still apply, positioning stays on the
      // existing Phase 1/2 formation() layout to keep those sizes exactly
      // as tested (Step 21 regression protection).
      const generic = { GK: 'GK', DF: 'CB', MF: 'CM', FW: 'ST' };
      for (const p of active) { p.role = generic[p.pos] || 'CM'; p.tacticalAnchor = null; }
    }
  },

  /* Step 12: small, conservative scoreline-aware nudge on top of the
     user's own chosen mentality — never a category of its own, and
     bounded so it can't override what the player selected. Returns a
     defensiveLineShift delta and a forwardBias delta. */
  scorelineAdjustment(isHome) {
    if (!SCORELINE_CONFIG.enabled || !state.match) return { line: 0, forward: 0 };
    const timeLeft = state.matchPeriod === MatchPeriods.SECOND_HALF ? state.timeLeft : state.halfDuration + state.timeLeft;
    if (timeLeft > SCORELINE_CONFIG.lateGameWindowSeconds) return { line: 0, forward: 0 };
    const margin = isHome ? state.scoreHome - state.scoreAway : state.scoreAway - state.scoreHome;
    if (margin > 0) return { line: SCORELINE_CONFIG.leadingLineShift, forward: 0 };
    if (margin < 0) return { line: SCORELINE_CONFIG.trailingLineShift, forward: SCORELINE_CONFIG.trailingForwardBiasBoost };
    return { line: 0, forward: 0 };
  },

  /* Step 7: tactical target position for an 11-a-side player with a
     formation anchor. Mirrors the normalized slot for home (attacks +x)
     vs away (attacks -x), applies the mentality's line shift and the
     style's block depth, then pulls toward the ball by the role's
     support factor — the same idea as Phase 2's formationPullX/Y, now
     role/mentality/style-aware instead of one fixed constant. A tired
     player (Step 9) sits a touch deeper. */
  anchorTarget(p, ball) {
    if (!p.tacticalAnchor) return null;
    const mentality = this.getMentality(p.isHome), style = this.getStyle(p.isHome), role = ROLE_DEFS[p.role] || ROLE_DEFS.CM;
    const scoreline = this.scorelineAdjustment(p.isHome); // Step 12
    const playW = PITCH.w - 2 * PITCH.margin, playH = PITCH.h - 2 * PITCH.margin;
    let nx = p.tacticalAnchor.x, ny = p.tacticalAnchor.y;
    const staminaLineFactor = role.band === 'gk' ? 0 : (1 - StaminaSystem.speedFactor(p)) * -0.06;
    nx = 0.5 + (nx - 0.5) * style.blockDepth + (mentality.defensiveLineShift + scoreline.line) * (role.band === 'gk' ? 0 : 1) + staminaLineFactor;
    nx = Math.max(0.03, Math.min(0.97, nx));
    const px = p.isHome ? PITCH.margin + nx * playW : PITCH.w - PITCH.margin - nx * playW;
    const py = PITCH.margin + ny * playH;
    const pull = role.support * mentality.supportDistance * 0.16 * (1 + scoreline.forward);
    const bx = px + (ball.x - PITCH.w / 2) * pull * (p.isHome ? 1 : -1) * -1 + (ball.x - PITCH.w / 2) * pull;
    const by = py + (ball.y - PITCH.h / 2) * pull * 0.5;
    return { tx: bx, ty: by };
  },

  /* Step 10: how far this role/mentality/style combo presses. Tired
     players (Step 9) press noticeably less via StaminaSystem.pressFactor. */
  pressingRadius(p, baseEngageDist) {
    const role = ROLE_DEFS[p.role] || ROLE_DEFS.CM;
    const mentality = this.getMentality(p.isHome), style = this.getStyle(p.isHome);
    const factor = (0.55 + role.pressing * mentality.pressIntensity * style.pressIntensity * 0.75) * StaminaSystem.pressFactor(p);
    return baseEngageDist * Math.max(0.25, Math.min(2.2, factor));
  },

  /* Step 10: only a capped number of eligible players actually press the
     ball at once (closest first); everyone else holds tactical shape. */
  selectPressers(teamPlayers, ball, baseEngageDist, maxPressers) {
    const eligible = teamPlayers
      .filter(p => !p.isGK)
      .map(p => ({ p, d: Math.hypot(p.x - ball.x, p.y - ball.y), r: this.pressingRadius(p, baseEngageDist) }))
      .filter(e => e.d < e.r)
      .sort((a, b) => a.d - b.d)
      .slice(0, maxPressers);
    const pressingIds = new Set(eligible.map(e => e.p.id));
    if (eligible.length) {
      const now = performance.now();
      const leader = eligible[0].p;
      if (now - (state.pressEmitCooldowns[leader.id] || 0) > 4000) {
        state.pressEmitCooldowns[leader.id] = now;
        EventBus.emit(GameEvents.PRESS_TRIGGERED, { home: leader.isHome, playerId: leader.id });
      }
    }
    return pressingIds;
  },

  /* Step 11: zone-aware marking. */
  pickMarkTarget(defender, opponents) {
    let best = null, bestScore = -Infinity;
    for (const o of opponents) {
      if (o.discipline.sentOff) continue;
      const d = Math.hypot(o.x - defender.x, o.y - defender.y);
      if (d > TACTICS_CONFIG.maxMarkingRange) continue;
      const danger = defender.isHome ? o.x : (PITCH.w - o.x);
      const score = danger - d * 0.6;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  },

  /* Step 12: possession-change transitions. */
  updateTransitions(dt) {
    const nowTeam = state.possession.team;
    if (nowTeam !== this._lastPossessionTeam) {
      this._lastPossessionTeam = nowTeam;
      const t = state.match ? state.match.matchTime : 0;
      state.tacticalPhase.home = nowTeam === true ? 'ATTACKING' : nowTeam === false ? 'DEFENDING' : state.tacticalPhase.home;
      state.tacticalPhase.away = nowTeam === false ? 'ATTACKING' : nowTeam === true ? 'DEFENDING' : state.tacticalPhase.away;
      if (nowTeam !== null) {
        state.tacticalPhase.home = 'TRANSITION'; state.tacticalPhase.away = 'TRANSITION';
        state.tacticalPhase.homeSince = t; state.tacticalPhase.awaySince = t;
        EventBus.emit(GameEvents.TACTICAL_STATE_CHANGED, { home: state.tacticalPhase.home, away: state.tacticalPhase.away });
      }
    }
    const t = state.match ? state.match.matchTime : 0;
    if (state.tacticalPhase.home === 'TRANSITION' && t - state.tacticalPhase.homeSince > TACTICS_CONFIG.transitionWindowSeconds) {
      state.tacticalPhase.home = this._lastPossessionTeam === true ? 'ATTACKING' : 'DEFENDING';
    }
    if (state.tacticalPhase.away === 'TRANSITION' && t - state.tacticalPhase.awaySince > TACTICS_CONFIG.transitionWindowSeconds) {
      state.tacticalPhase.away = this._lastPossessionTeam === false ? 'ATTACKING' : 'DEFENDING';
    }
  },
  _lastPossessionTeam: undefined,

  /* Step 9: style-aware pass-target scoring, layered on top of
     nearestTeammate() — only ever used for AI-initiated passes. */
  scorePassCandidate(passer, candidate, baseScore) {
    const style = this.getStyle(passer.isHome);
    const forwardness = passer.isHome ? (candidate.x - passer.x) : (passer.x - candidate.x);
    const pressureNearby = candidate.pressureCount || 0;
    return baseScore - forwardness * style.forwardPassBias - pressureNearby * 18 * style.passSafetyBias;
  },

  /* Step 20: validate tactical data — used by runIntegrityCheck(). */
  validate(players) {
    const problems = [];
    const seenSlots = new Set();
    for (const p of players) {
      if (p.discipline.sentOff) continue;
      if (!ROLE_DEFS[p.role]) problems.push(`missing/invalid role for player ${p.id}`);
      if (p.tacticalAnchor) {
        const key = `${p.isHome}:${p.tacticalAnchor.x}:${p.tacticalAnchor.y}`;
        if (seenSlots.has(key)) problems.push(`duplicate formation slot for player ${p.id}`);
        seenSlots.add(key);
      }
    }
    const t = this.getTactics(players[0] ? players[0].isHome : true);
    if (!FORMATIONS[t.formationId]) problems.push(`invalid formationId ${t.formationId}`);
    if (!MENTALITY_DEFS[t.mentality]) problems.push(`invalid mentality ${t.mentality}`);
    if (!STYLE_DEFS[t.style]) problems.push(`invalid style ${t.style}`);
    return problems;
  },
};

// Step 14: a sent-off player is already excluded from assignRoles() via
// activePlayers-style filtering inside it — re-run so the remaining
// players redistribute across the (now smaller) formation.
EventBus.on(GameEvents.RED_CARD, ({ home }) => {
  TacticalSystem.assignRoles(home ? state.homePlayers : state.awayPlayers, home);
});

