/* =====================================================================
   SUBSTITUTION MANAGER (Phase 4, Steps 5-7, 17-19, 24)
   The single authority for moving a player between the pitch and the
   bench. Both the human bench UI and AI substitution logic go through
   request() — there is no separate AI shortcut path (Step 13).
   ===================================================================== */
const SubstitutionManager = {
  /* Step 5-6: can this side make a substitution right now at all
     (independent of which two players are chosen)? */
  canSubstitute(isHome) {
    if (!state.match || !state.running) return { ok: false, reason: 'no active match' };
    if (!Game.state.is(GameStates.PLAYING, GameStates.HALFTIME)) return { ok: false, reason: 'match not in a substitutable state' };
    if (state.matchPeriod === MatchPeriods.PRE_MATCH || state.matchPeriod === MatchPeriods.FULL_TIME) return { ok: false, reason: 'invalid match period' };
    const used = isHome ? state.substitutionsUsed.home : state.substitutionsUsed.away;
    if (used >= SQUAD_CONFIG.maxSubstitutions) return { ok: false, reason: 'substitution limit reached' };
    return { ok: true };
  },
  /* Step 5: entry point for both human (bench UI) and AI callers.
     Queues instead of executing if a set piece is currently active
     (Step 24) — never mutates mid-restart. */
  request(isHome, outgoingId, incomingId) {
    const gate = this.canSubstitute(isHome);
    if (!gate.ok) return gate;
    const onPitch = isHome ? state.homePlayers : state.awayPlayers;
    const bench = isHome ? state.homeBench : state.awayBench;
    const outgoing = onPitch.find(p => p.id === outgoingId);
    const incoming = bench.find(p => p.id === incomingId);
    if (!outgoing) return { ok: false, reason: 'outgoing player not on this pitch' };
    if (outgoing.discipline.sentOff) return { ok: false, reason: 'a sent-off player cannot be substituted' }; // Step 17
    if (!incoming) return { ok: false, reason: 'incoming player not available on the bench' };
    if (incoming.discipline.sentOff) return { ok: false, reason: 'a sent-off player cannot enter as a substitute' }; // Step 17
    if (outgoing.isGK && incoming.pos !== 'GK') return { ok: false, reason: 'a goalkeeper can only be replaced by another goalkeeper' }; // Step 19
    EventBus.emit(GameEvents.SUBSTITUTION_REQUESTED, { home: isHome, outgoingId, incomingId });
    if (state.setPiece && state.setPiece.active) {
      state.pendingSubstitution = { isHome, outgoingId, incomingId };
      return { ok: true, queued: true };
    }
    return this.execute(isHome, outgoingId, incomingId);
  },
  execute(isHome, outgoingId, incomingId) {
    const onPitch = isHome ? state.homePlayers : state.awayPlayers;
    const bench = isHome ? state.homeBench : state.awayBench;
    const idx = onPitch.findIndex(p => p.id === outgoingId);
    const bIdx = bench.findIndex(p => p.id === incomingId);
    if (idx === -1 || bIdx === -1) return { ok: false, reason: 'player no longer available' };
    const outgoing = onPitch[idx], incoming = bench[bIdx];
    // Re-validate at execution time: a queued request can go stale (e.g. a player sent off while it waited).
    if (outgoing.discipline.sentOff) return { ok: false, reason: 'a sent-off player cannot be substituted' };
    if (incoming.discipline.sentOff) return { ok: false, reason: 'a sent-off player cannot enter as a substitute' };
    if (outgoing.isGK && !incoming.isGK) return { ok: false, reason: 'a goalkeeper can only be replaced by another goalkeeper' };

    // Swap in place — same array index — so every existing index-based
    // lookup (formation(), etc.) keeps working untouched (Step 3).
    incoming.x = outgoing.x; incoming.y = outgoing.y; incoming.vx = 0; incoming.vy = 0;
    incoming.facing = outgoing.facing; incoming.cooldown = 0; incoming.stunned = 0;
    incoming.squadStatus.isOnPitch = true; incoming.squadStatus.isSubstitute = false;
    incoming.squadStatus.subbedInAtMinute = state.match.matchTime / 60;
    outgoing.squadStatus.isOnPitch = false; outgoing.squadStatus.isSubstitute = true;
    outgoing.squadStatus.subbedOutAtMinute = state.match.matchTime / 60;
    const spot = benchSpot(isHome, bIdx);
    outgoing.x = spot.x; outgoing.y = spot.y; outgoing.vx = 0; outgoing.vy = 0;

    onPitch[idx] = incoming;
    bench[bIdx] = outgoing;

    if (state.controlledId === outgoing.id) switchControlTo(incoming, 'substitution'); // Step 3/7, Phase 5 Step 7

    TacticalSystem.assignRoles(onPitch, isHome); // Step 7, 18: recalculate roles/anchors for the new XI

    state.substitutionsUsed[isHome ? 'home' : 'away']++;
    if (state.match) {
      state.match.homeTeam.players = state.homePlayers.map(p => p.profile);
      state.match.awayTeam.players = state.awayPlayers.map(p => p.profile);
    }

    EventBus.emit(GameEvents.PLAYER_SUBSTITUTED_OFF, { home: isHome, playerId: outgoing.id });
    EventBus.emit(GameEvents.PLAYER_SUBSTITUTED_ON, { home: isHome, playerId: incoming.id });
    EventBus.emit(GameEvents.SUBSTITUTION_CONFIRMED, { home: isHome, outgoingId: outgoing.id, incomingId: incoming.id });
    AudioManager.setPieceWhistle();
    showRulesBanner('SUBSTITUTION', '#38bdf8', 1600);
    showCommentary(`Substitution: ${incoming.name} replaces ${outgoing.name}.`, 2200);
    return { ok: true };
  },
  /* Step 24: called once/frame — if a sub was queued behind an active
     set piece, apply it the instant the pitch is clear again. */
  processPending() {
    if (!state.pendingSubstitution) return;
    if (state.setPiece && state.setPiece.active) return;
    const req = state.pendingSubstitution;
    state.pendingSubstitution = null;
    const gate = this.canSubstitute(req.isHome);
    if (!gate.ok) { EventBus.emit(GameEvents.SUBSTITUTION_CANCELLED, { home: req.isHome, reason: gate.reason }); return; }
    const res = this.execute(req.isHome, req.outgoingId, req.incomingId);
    if (!res.ok) EventBus.emit(GameEvents.SUBSTITUTION_CANCELLED, { home: req.isHome, reason: res.reason });
  },
};

