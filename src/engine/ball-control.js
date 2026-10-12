/* =====================================================================
   BALL CONTROL SYSTEM (Phase 5, Steps 2-3)
   An additive layer on top of the existing, unchanged ball physics
   above: resolveCollisions() still does every bit of actual ball-vs-
   player/player-vs-player physics it always did. This only tracks WHO
   currently has persisted possession (state.ball.ownerId, as opposed to
   the pre-existing per-touch state.lastTouch) and applies a small,
   capped-per-frame steering nudge so a carried ball doesn't just bounce
   off the dribbler like a stray physics object. Every correction here
   is bounded (BALL_CONTROL_CONFIG.dribbleMaxNudgePerFrame) and NaN-safe
   (guarded divisions, existing sanitizeAllEntities() still runs after).
   ===================================================================== */
function setBallControl(player) {
  const b = state.ball;
  if (!b || !player) return;
  if (b.ownerId === player.id) return;
  if (b.ownerId != null) releaseBallControl('possession changed');
  b.ownerId = player.id;
  EventBus.emit(GameEvents.BALL_CONTROL_GAINED, { home: player.isHome, playerId: player.id });
}
function releaseBallControl(reason) {
  const b = state.ball;
  if (!b || b.ownerId == null) return;
  const prevId = b.ownerId;
  const prev = findPlayerById(prevId);
  b.ownerId = null;
  EventBus.emit(GameEvents.BALL_CONTROL_LOST, { home: prev ? prev.isHome : null, playerId: prevId, reason: reason || 'unspecified' });
}
function updateBallControl(dt) {
  const b = state.ball;
  if (!b || !isFiniteNum(b.x)) return; // sanitizeAllEntities() will repair the ball itself; just skip this frame's control logic
  if (b.aerial) {
    b.aerialFramesLeft = (b.aerialFramesLeft || 0) - dt;
    if (b.aerialFramesLeft <= 0) { b.aerial = false; b.aerialFramesLeft = 0; }
  }
  const ballSpeed = Math.hypot(b.vx, b.vy);
  // Step 2: owner loses the ball once it's too far away, sent off, or gone.
  if (b.ownerId != null) {
    const owner = findPlayerById(b.ownerId);
    if (!owner || owner.discipline.sentOff || Math.hypot(owner.x - b.x, owner.y - b.y) > BALL_CONTROL_CONFIG.releaseDistance) {
      releaseBallControl(!owner ? 'invalid owner' : (owner.discipline.sentOff ? 'sent off' : 'out of range'));
    }
  }
  // Step 2: a loose ball close enough to exactly one or more active players,
  // moving slowly enough that this is plainly a touch/first-touch and not a
  // shot/pass still in flight, is picked up by the closest of them.
  if (b.ownerId == null && !b.aerial && ballSpeed < BALL_CONTROL_CONFIG.carryingSpeedCap * 2) {
    let nearest = null, nearestD = Infinity;
    for (const p of activePlayers()) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);
      if (d < nearestD) { nearestD = d; nearest = p; }
    }
    if (nearest && nearestD < BALL_CONTROL_CONFIG.possessionRadius) setBallControl(nearest);
  }
  // Step 3: dribbling -- only while genuinely carrying (ball speed below
  // the carrying cap, i.e. not the instant after a shot/pass), nudge the
  // ball toward a spot just ahead of the owner, scaled by how fast they're
  // moving (a sprint gets a slightly longer/heavier touch, Step 3).
  if (b.ownerId != null) {
    const owner = findPlayerById(b.ownerId);
    if (owner && !owner.discipline.sentOff && ballSpeed < BALL_CONTROL_CONFIG.carryingSpeedCap) {
      const ownerSpeed = Math.hypot(owner.vx, owner.vy);
      const topSpeed = PLAYER_CONFIG.baseSpeedMin + owner.speed / 100 * PLAYER_CONFIG.speedScale;
      const sprinting = ownerSpeed > topSpeed * 1.05;
      const moving = ownerSpeed > 0.25;
      const lead = sprinting ? BALL_CONTROL_CONFIG.dribbleLeadDistanceSprint : BALL_CONTROL_CONFIG.dribbleLeadDistance;
      const faceAng = moving ? Math.atan2(owner.vy, owner.vx) : owner.facing;
      const tx = owner.x + Math.cos(faceAng) * lead, ty = owner.y + Math.sin(faceAng) * lead;
      const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
      const cap = BALL_CONTROL_CONFIG.dribbleMaxNudgePerFrame * Math.max(dt, 0);
      const nudge = Math.min(d * BALL_CONTROL_CONFIG.dribbleNudgeStrength, cap);
      if (isFiniteNum(nudge) && nudge > 0) { b.x += (dx / d) * nudge; b.y += (dy / d) * nudge; }
    }
  }
}

