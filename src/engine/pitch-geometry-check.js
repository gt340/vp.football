/* ---------- PITCH GEOMETRY INTEGRITY (Pitch Size patch, Step 23) ----------
   One-time startup validation — not per-frame — that the enlarged
   world-space pitch and everything derived from it (goal, penalty/six-
   yard areas, center circle, camera transform) is well-formed. Existing
   per-frame checks (isFiniteNum/sanitizeEntity/runIntegrityCheck) still
   guard ball/player coordinates during play; this only guards the
   static geometry this patch introduced. */
function validatePitchGeometry() {
  const problems = [];
  if (!(PITCH.w > 0) || !(PITCH.h > 0)) problems.push('pitch dimensions must be positive');
  if (!(PITCH_CONFIG.playableLength > PITCH_CONFIG.playableWidth)) problems.push('playable length must exceed playable width (105:68)');
  const finiteVals = {
    'GOAL_W': GOAL_W, 'GOAL_D': GOAL_D,
    'penaltyAreaDepth': PITCH_CONFIG.penaltyAreaDepth, 'penaltyAreaWidth': PITCH_CONFIG.penaltyAreaWidth,
    'sixYardAreaDepth': PITCH_CONFIG.sixYardAreaDepth, 'sixYardAreaWidth': PITCH_CONFIG.sixYardAreaWidth,
    'centerCircleRadius': PITCH_CONFIG.centerCircleRadius, 'gkGoalLineOffset': PITCH_CONFIG.gkGoalLineOffset,
    'penaltySpotOffset': PITCH_CONFIG.penaltySpotOffset, 'penaltyTakerOffset': PITCH_CONFIG.penaltyTakerOffset,
  };
  for (const [name, v] of Object.entries(finiteVals)) if (!isFiniteNum(v) || v <= 0) problems.push(`${name} must be a finite positive number, got ${v}`);
  const cam = Camera.computeTransform();
  if (!isFiniteNum(cam.sx) || !isFiniteNum(cam.sy) || !isFiniteNum(cam.offX) || !isFiniteNum(cam.offY)) problems.push('camera transform produced a non-finite value');
  if (problems.length) console.warn('[PitchGeometry] invalid pitch configuration', problems);
  return problems;
}
validatePitchGeometry();

