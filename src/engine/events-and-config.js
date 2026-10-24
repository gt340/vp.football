/* ---------- EVENT SYSTEM (Step 13) ----------
   Lightweight pub/sub so future systems (fouls, cards, offside, stats,
   competitions) can subscribe to match events without coupling to the
   match engine internals. */
const EventBus = (() => {
  const listeners = Object.create(null);
  return {
    on(evt, fn) { (listeners[evt] || (listeners[evt] = [])).push(fn); return fn; },
    off(evt, fn) { if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn); },
    emit(evt, payload) {
      const arr = listeners[evt];
      if (!arr) return;
      for (const fn of arr.slice()) {
        try { fn(payload); } catch (err) { console.error(`[EventBus] handler for "${evt}" threw`, err); }
      }
    },
  };
})();

/* ---------- MATCH EVENT NAMES (Phase 2, Step 17) ----------
   Named constants for every event the referee/match engine emits over
   EventBus. Phase 1's 'shot'/'pass'/'tackle'/'goal' strings still work
   unchanged (existing listeners keep firing) — these are additive. */
const GameEvents = Object.freeze({
  KICKOFF: 'kickoff',
  GOAL: 'goal',
  ASSIST: 'assist',
  SHOT: 'shot',
  SHOT_ON_TARGET: 'shotOnTarget',
  PASS: 'pass',
  TACKLE: 'tackle',
  FOUL: 'foul',
  YELLOW_CARD: 'yellowCard',
  RED_CARD: 'redCard',
  OFFSIDE: 'offside',
  CORNER: 'corner',
  FREE_KICK: 'freeKick',
  PENALTY: 'penalty',
  THROW_IN: 'throwIn',
  GOAL_KICK: 'goalKick',
  HALFTIME: 'halftime',
  SECOND_HALF: 'secondHalf',
  FULL_TIME: 'fullTime',
  SAVE: 'save',
  // Phase 3, Step 18
  FORMATION_CHANGED: 'formationChanged',
  MENTALITY_CHANGED: 'mentalityChanged',
  STYLE_CHANGED: 'styleChanged',
  TACTICAL_STATE_CHANGED: 'tacticalStateChanged',
  PRESS_TRIGGERED: 'pressTriggered',
  FORMATION_ADAPTED: 'formationAdapted',
  // Phase 4, Step 20
  SUBSTITUTION_REQUESTED: 'substitutionRequested',
  SUBSTITUTION_CONFIRMED: 'substitutionConfirmed',
  SUBSTITUTION_CANCELLED: 'substitutionCancelled',
  PLAYER_SUBSTITUTED_ON: 'playerSubstitutedOn',
  PLAYER_SUBSTITUTED_OFF: 'playerSubstitutedOff',
  STAMINA_LOW: 'staminaLow',
  PLAYER_EXHAUSTED: 'playerExhausted',
  TACTICAL_PANEL_OPENED: 'tacticalPanelOpened',
  TACTICAL_PANEL_CLOSED: 'tacticalPanelClosed',
  IN_MATCH_TACTIC_CHANGED: 'inMatchTacticChanged',
  AI_SUBSTITUTION: 'aiSubstitution',
  PLAYER_ROLE_ADAPTED: 'playerRoleAdapted',
  // Phase 5, Step 13: player control / ball control / switching events.
  // Additive only -- existing SHOT/PASS/TACKLE events are unchanged and
  // still fire exactly as before; these are extra, more granular signals
  // layered on top for the new control/possession systems below.
  PLAYER_CONTROL_CHANGED: 'playerControlChanged',
  BALL_CONTROL_GAINED: 'ballControlGained',
  BALL_CONTROL_LOST: 'ballControlLost',
  PASS_ATTEMPTED: 'passAttempted',
  PASS_COMPLETED: 'passCompleted',
  SHOT_ATTEMPTED: 'shotAttempted',
  TACKLE_ATTEMPTED: 'tackleAttempted',
  TACKLE_SUCCESS: 'tackleSuccess',
  PLAYER_SWITCHED: 'playerSwitched',
});

/* ---------- CONFIGURATION (Step 4) ----------
   Every tunable value used to be scattered inline as a magic number.
   Behavior is unchanged — these are the exact original numbers, now
   named and centralized so balancing is a config edit, not a code hunt. */
// ---------- PITCH CONFIGURATION (Pitch Size & Field Proportions patch) ----------
// World-space pitch definition, kept separate from the canvas (the
// canvas is only the viewport — Camera.computeTransform() decides how
// much of this world is shown). PLAYABLE_LENGTH:PLAYABLE_WIDTH is an
// exact 105:68 ratio, a realistic full-size football-pitch proportion,
// replacing the old ~16:9 arcade-style playable area (1184x624). Margin
// is enlarged slightly to match the bigger field. Everything else that
// used to hard-code distances against the old 1280x720 world (AI
// engage/shoot ranges, player speeds, set-piece spacing, goal/penalty
// box size, marking/pressing radii, rendered player/ball size) is
// derived below from WORLD_SCALE_X/WORLD_SCALE_Y/WORLD_RADIAL_SCALE so
// the whole engine scales together instead of being re-tuned by hand.
const PITCH_CONFIG = {
  playableLength: 1680, // x-axis (length), matches real pitches being longer than wide
  playableWidth: 1088,  // y-axis (width): 1680 * 68/105 = 1088 exactly -> ratio 105:68
  margin: 60,
  goalWidth: 140 * (1088 / 624),   // scaled on the y-axis (goal sits across the width)
  goalDepth: 22 * (1680 / 1184),   // scaled on the x-axis (goal recedes along the length)
  penaltyAreaDepth: 165 * (1680 / 1184), // x-axis: how far the box extends onto the pitch
  penaltyAreaWidth: 300 * (1088 / 624),  // y-axis: how wide the box is across the goal
  sixYardAreaDepth: 65 * (1680 / 1184),
  sixYardAreaWidth: 160 * (1088 / 624),
  centerCircleRadius: 80 * Math.sqrt((1680 / 1184) * (1088 / 624)),
  centerMarkRadius: 4 * Math.sqrt((1680 / 1184) * (1088 / 624)),
  gkGoalLineOffset: 30 * (1680 / 1184), // how far off the goal line the GK/penalty taker/PK spot sit, x-axis
  penaltySpotOffset: 120 * (1680 / 1184), // penalty spot distance from the goal line, x-axis
  penaltyTakerOffset: 150 * (1680 / 1184), // penalty taker standing distance from the goal line, x-axis
};
const GAME_CONFIG = {
  version: 1,
  pitch: { w: PITCH_CONFIG.playableLength + PITCH_CONFIG.margin * 2, h: PITCH_CONFIG.playableWidth + PITCH_CONFIG.margin * 2, margin: PITCH_CONFIG.margin },
  goal: { width: PITCH_CONFIG.goalWidth, depth: PITCH_CONFIG.goalDepth },
};
const PITCH = GAME_CONFIG.pitch;
const GOAL_W = GAME_CONFIG.goal.width;
const GOAL_D = GAME_CONFIG.goal.depth;
// Uniform world-space scale factors, derived once from the old vs new
// playable dimensions, so every other spatial/speed config below scales
// consistently with the bigger pitch rather than being hand-tuned.
const WORLD_SCALE_X = PITCH_CONFIG.playableLength / 1184;
const WORLD_SCALE_Y = PITCH_CONFIG.playableWidth / 624;
const WORLD_RADIAL_SCALE = Math.sqrt(WORLD_SCALE_X * WORLD_SCALE_Y); // for radial (hypot-based) ranges and speeds, where a single axis scale doesn't apply

const MATCH_CONFIG = {
  durations: [180, 300, 480],
  defaultDuration: 180,
  teamSizes: [5, 7, 11],
  defaultTeamSize: 7,
  goalResetDelayMs: 1400,
  goalFlashFrames: 110,
  goalBannerMs: 1600,
  lateGameCommentWindow: [50, 60], // seconds remaining
  lateGameCommentIntervalFrames: 900,
};

const PHYSICS_CONFIG = {
  ballFriction: 0.988,
  ballMinSpeed: 0.04 * WORLD_RADIAL_SCALE,
  wallBounceY: -0.7,
  wallBounceX: -0.65,
  ballSeparationFactor: 0.7,
  ballImpactFactor: 0.82,
  playerSeparationFactor: 0.5,
  playerRadiusOverlap: 2 * WORLD_RADIAL_SCALE,
};

const PLAYER_CONFIG = {
  // Speeds and spatial ranges scale with the pitch (WORLD_RADIAL_SCALE)
  // so traversal time across the bigger field stays the same as before
  // — same gameplay pace, just a larger, more realistic world. Cooldowns
  // (frame counts) and chance/stun values are not spatial and are left
  // unchanged.
  baseSpeedMin: 2.3 * WORLD_RADIAL_SCALE,
  speedScale: 2.4 * WORLD_RADIAL_SCALE,
  dashMultiplier: 1.5,
  decelFactor: 0.78,
  moveThreshold: 0.08,
  shootRange: 24 * WORLD_RADIAL_SCALE,
  passRange: 34 * WORLD_RADIAL_SCALE,
  shootCooldown: 14,
  passCooldown: 10,
  tackleCooldown: 20,
  tackleBaseRange: 30 * WORLD_RADIAL_SCALE,
  tackleRangeScale: 14 * WORLD_RADIAL_SCALE,
  tackleBaseChance: 0.4,
  tackleChanceScale: 0.45,
  tackleFailStun: 12,
  tackleSuccessStunMin: 30,
  tackleSuccessStunRand: 25,
  gkRadius: 15 * WORLD_RADIAL_SCALE,
  fieldRadius: 13 * WORLD_RADIAL_SCALE,
};

const AI_CONFIG = {
  // engageDist/shootRange/catchRange are radial (Math.hypot) ranges,
  // scaled by WORLD_RADIAL_SCALE. engageBallX/defendTargetX/midTargetX
  // are absolute x-axis targets on the old 1280-wide world — now
  // expressed as fractions of PITCH.w so they land in the same relative
  // spot on the new, wider pitch. speedBase/speedScale/shootPower scale
  // with WORLD_RADIAL_SCALE alongside PLAYER_CONFIG so AI and human
  // players move/shoot at consistent relative pace and power.
  away: {
    engageDist: 170 * WORLD_RADIAL_SCALE, engageBallX: PITCH.w * (580 / 1280),
    speedBase: 2.0 * WORLD_RADIAL_SCALE, speedScale: 1.7 * WORLD_RADIAL_SCALE,
    shootRange: 18 * WORLD_RADIAL_SCALE, shootPowerBase: 6.5 * WORLD_RADIAL_SCALE, shootPowerScale: 3.5 * WORLD_RADIAL_SCALE, shootCooldown: 16,
    defendTargetX: PITCH.w * (900 / 1280), midTargetX: PITCH.w * (700 / 1280),
  },
  home: {
    engageDist: 130 * WORLD_RADIAL_SCALE,
    speedBase: 1.9 * WORLD_RADIAL_SCALE, speedScale: 1.5 * WORLD_RADIAL_SCALE,
    shootRange: 16 * WORLD_RADIAL_SCALE, shootPowerBase: 6 * WORLD_RADIAL_SCALE, shootPowerScale: 3 * WORLD_RADIAL_SCALE, shootCooldown: 14,
    shootChancePerDt: 0.035,
    formationPullX: 0.12, formationPullY: 0.08,
  },
  gk: {
    speedBase: 2.4 * WORLD_RADIAL_SCALE, speedScale: 1.2 * WORLD_RADIAL_SCALE,
    dangerZone: 220 * WORLD_SCALE_X, engageDist: 120 * WORLD_RADIAL_SCALE, catchRange: 14 * WORLD_RADIAL_SCALE,
    releaseChancePerDt: 0.08, boxHalfHeightPad: 20 * WORLD_SCALE_Y,
  },
};

const CONTROL_CONFIG = {
  stickRadius: 42, // on-screen touch control, not world-space -- not scaled
  autoSwitchDist: 140 * WORLD_RADIAL_SCALE,
  autoSwitchMargin: 25 * WORLD_RADIAL_SCALE,
  autoSwitchCooldownMs: 600,
};

/* ---------- BALL CONTROL / DRIBBLE CONFIGURATION (Phase 5, Step 2-3) ----------
   Extends the existing CONTROL_CONFIG/PLAYER_CONFIG rather than a parallel
   system. "Owner" is a persisted possession state (state.ball.ownerId),
   distinct from the pre-existing per-frame state.lastTouch (which only
   ever recorded who touched the ball most recently, for stats/restart
   attribution, and keeps doing exactly that, unchanged). Values scale
   with WORLD_RADIAL_SCALE like every other Phase 4/5 spatial config. */
const BALL_CONTROL_CONFIG = {
  possessionRadius: 27 * WORLD_RADIAL_SCALE,
  releaseDistance: 34 * WORLD_RADIAL_SCALE,
  carryingSpeedCap: 3 * WORLD_RADIAL_SCALE,
  dribbleLeadDistance: 11 * WORLD_RADIAL_SCALE,
  dribbleLeadDistanceSprint: 17 * WORLD_RADIAL_SCALE,
  // Strength/cap are deliberately generous relative to top player speed
  // (base+dash, scaled by WORLD_RADIAL_SCALE) so the ball can always
  // keep pace with a moving dribbler instead of gradually falling behind
  // a continuously-receding lead point and eventually releasing itself.
  dribbleNudgeStrength: 0.55,
  dribbleMaxNudgePerFrame: 14 * WORLD_RADIAL_SCALE,
};
const SHOT_CHARGE_CONFIG = {
  maxChargeMs: 900,
  maxBonusMultiplier: 0.45,
};

const AUDIO_CONFIG = {
  voiceRate: 1.05,
  voicePitch: 1.0,
  voiceVolume: 0.85,
};

const UI_CONFIG = {
  commentaryDefaultMs: 2800,
};

const SAVE_CONFIG = {
  version: 1,
  storageKey: 'etoyFootballSave',
};

const DEFAULT_SETTINGS = {
  audio: { sfx: true, commentary: true, vibration: false },
  difficulty: 'normal',
  graphics: 'standard',
  controlSensitivity: 1,
  tactics: { formationId: '4-3-3', mentality: 'BALANCED', style: 'POSSESSION' }, // Phase 3, Step 17 (kept as literals: TACTICS_CONFIG consts are declared later in the file)
};

/* ---------- FOOTBALL RULES CONFIGURATION (Phase 2, Step 27) ----------
   Every Phase 2 tunable lives here, extending the Phase 1 config
   architecture rather than scattering new magic numbers. Values are
   derived from the existing tackle/physics numbers (PLAYER_CONFIG,
   PHYSICS_CONFIG) so the rules layer feels consistent with gameplay
   that was already tuned in Phase 1 — nothing here rebalances it. */
const RULES_CONFIG = {
  fouls: {
    enabled: true,
    // Base chance an in-range tackle attempt is adjudicated a foul at
    // all, before severity is rolled. Kept low so most tackles play out
    // exactly as they did in Phase 1 (no foul).
    tackleFoulChance: 0.16,
    // Severity roll (0-1) above which a foul becomes "reckless" (yellow
    // card territory) rather than a plain/late foul.
    recklessThreshold: 0.72,
    // Severity roll above which a reckless foul becomes a straight red
    // (serious foul play) instead of a yellow.
    seriousFoulThreshold: 0.94,
    // Relative-velocity threshold (px/frame-equivalent) above which a
    // player-player collision is even considered for a foul — normal
    // shoulder-to-shoulder contact stays well under this.
    collisionThreshold: 7.5 * WORLD_RADIAL_SCALE, // velocity threshold, scales with player/ball speed
    collisionFoulChance: 0.08,
    collisionCooldownMs: 1500, // per player-pair, avoids foul spam on a scrum
  },
  cards: {
    yellowToRed: 2, // second yellow = red
  },
  offside: {
    enabled: true,
    // Attacker must be this many px beyond the second-last defender AND
    // beyond the ball to count as offside — a small buffer avoids
    // flagging marginal/level positions.
    offsideBuffer: 4 * WORLD_RADIAL_SCALE,
  },
  advantage: {
    enabled: true,
    // Advantage is evaluated at the instant of the foul: the fouled
    // team keeps it if their attack is already moving faster toward
    // goal than any opponent can reach the ball.
    minBallSpeedTowardGoal: 2.0 * WORLD_RADIAL_SCALE, // velocity threshold, scales with ball speed
  },
  setPieces: {
    freezeFrames: 70, // ~1.1s at 60fps before an unattended set piece auto-restarts
    repositionRadius: 60 * WORLD_RADIAL_SCALE, // opponents must retreat this far from the ball
  },
  boundaries: {
    // Small inward offsets so restart spots sit just inside the lines,
    // matching where the existing wall/goal geometry is drawn.
    cornerInset: 10 * WORLD_SCALE_X,
    goalKickInset: 60 * WORLD_SCALE_X,
    throwInInset: 0,
  },
  stoppageTime: {
    perGoalSeconds: 4,
    perCardSeconds: 3,
    perSetPieceSeconds: 1,
    maxSeconds: 25,
  },
  assistWindowSeconds: 6,
  shotAttributionWindowSeconds: 3,
};

/* ---------- TACTICAL CONFIGURATION (Phase 3, Steps 2-6, 10-11) ----------
   Extends the config architecture rather than hard-coding per-formation
   behavior. Every formation is the same reusable slot-template shape;
   roles/mentality/style are modifier tables the existing AI consults
   instead of a parallel tactical AI.

   Anchor coordinates are normalized to the team's OWN attacking
   direction: x=0 is this team's own goal line, x=1 is the opponent's
   goal line; y=0..1 is across the pitch width. TacticalSystem mirrors
   these into real pitch coordinates for home (attacks +x) vs away
   (attacks -x). */
const FORMATIONS = {
  '4-3-3': {
    id: '4-3-3', name: '4-3-3', width: 0.86, defensiveLine: 0.28, attackingSpacing: 0.82,
    slots: [
      { role: 'GK', x: 0.04, y: 0.50 },
      { role: 'LB', x: 0.24, y: 0.14 }, { role: 'CB', x: 0.20, y: 0.36 },
      { role: 'CB', x: 0.20, y: 0.64 }, { role: 'RB', x: 0.24, y: 0.86 },
      { role: 'CM', x: 0.46, y: 0.30 }, { role: 'DM', x: 0.42, y: 0.50 }, { role: 'CM', x: 0.46, y: 0.70 },
      { role: 'LW', x: 0.78, y: 0.16 }, { role: 'ST', x: 0.84, y: 0.50 }, { role: 'RW', x: 0.78, y: 0.84 },
    ],
  },
  '4-4-2': {
    id: '4-4-2', name: '4-4-2', width: 0.90, defensiveLine: 0.30, attackingSpacing: 0.76,
    slots: [
      { role: 'GK', x: 0.04, y: 0.50 },
      { role: 'LB', x: 0.24, y: 0.14 }, { role: 'CB', x: 0.20, y: 0.36 },
      { role: 'CB', x: 0.20, y: 0.64 }, { role: 'RB', x: 0.24, y: 0.86 },
      { role: 'LW', x: 0.52, y: 0.14 }, { role: 'CM', x: 0.48, y: 0.38 },
      { role: 'CM', x: 0.48, y: 0.62 }, { role: 'RW', x: 0.52, y: 0.86 },
      { role: 'ST', x: 0.82, y: 0.38 }, { role: 'ST', x: 0.82, y: 0.62 },
    ],
  },
  '4-2-3-1': {
    id: '4-2-3-1', name: '4-2-3-1', width: 0.84, defensiveLine: 0.26, attackingSpacing: 0.84,
    slots: [
      { role: 'GK', x: 0.04, y: 0.50 },
      { role: 'LB', x: 0.24, y: 0.14 }, { role: 'CB', x: 0.20, y: 0.36 },
      { role: 'CB', x: 0.20, y: 0.64 }, { role: 'RB', x: 0.24, y: 0.86 },
      { role: 'DM', x: 0.38, y: 0.38 }, { role: 'DM', x: 0.38, y: 0.62 },
      { role: 'LW', x: 0.66, y: 0.16 }, { role: 'AM', x: 0.62, y: 0.50 }, { role: 'RW', x: 0.66, y: 0.84 },
      { role: 'ST', x: 0.86, y: 0.50 },
    ],
  },
  '3-5-2': {
    id: '3-5-2', name: '3-5-2', width: 0.92, defensiveLine: 0.26, attackingSpacing: 0.80,
    slots: [
      { role: 'GK', x: 0.04, y: 0.50 },
      { role: 'CB', x: 0.20, y: 0.28 }, { role: 'CB', x: 0.18, y: 0.50 }, { role: 'CB', x: 0.20, y: 0.72 },
      { role: 'LWB', x: 0.50, y: 0.06 }, { role: 'CM', x: 0.46, y: 0.34 },
      { role: 'DM', x: 0.40, y: 0.50 }, { role: 'CM', x: 0.46, y: 0.66 }, { role: 'RWB', x: 0.50, y: 0.94 },
      { role: 'ST', x: 0.82, y: 0.40 }, { role: 'ST', x: 0.82, y: 0.60 },
    ],
  },
  '5-3-2': {
    id: '5-3-2', name: '5-3-2', width: 0.94, defensiveLine: 0.24, attackingSpacing: 0.74,
    slots: [
      { role: 'GK', x: 0.04, y: 0.50 },
      { role: 'LWB', x: 0.30, y: 0.08 }, { role: 'CB', x: 0.18, y: 0.30 },
      { role: 'CB', x: 0.16, y: 0.50 }, { role: 'CB', x: 0.18, y: 0.70 }, { role: 'RWB', x: 0.30, y: 0.92 },
      { role: 'CM', x: 0.44, y: 0.32 }, { role: 'DM', x: 0.40, y: 0.50 }, { role: 'CM', x: 0.44, y: 0.68 },
      { role: 'ST', x: 0.80, y: 0.40 }, { role: 'ST', x: 0.80, y: 0.60 },
    ],
  },
};
const FORMATION_IDS = Object.keys(FORMATIONS);
const DEFAULT_FORMATION_ID = '4-3-3';

/* Step 4: role behavior modifiers. Values are multipliers/offsets the
   AI applies on top of its existing speed/engage numbers — a role
   never replaces the underlying physics/AI_CONFIG values. */
const ROLE_DEFS = {
  GK:  { band: 'gk',  moveRange: 0.10, pressing: 0.0, support: 0.0, widthBias: 0.0, shootBias: 0.0 },
  CB:  { band: 'def', moveRange: 0.16, pressing: 0.35, support: 0.25, widthBias: 0.0, shootBias: 0.05 },
  LB:  { band: 'def', moveRange: 0.30, pressing: 0.45, support: 0.45, widthBias: -0.35, shootBias: 0.05 },
  RB:  { band: 'def', moveRange: 0.30, pressing: 0.45, support: 0.45, widthBias: 0.35, shootBias: 0.05 },
  LWB: { band: 'def', moveRange: 0.42, pressing: 0.5, support: 0.6, widthBias: -0.42, shootBias: 0.08 },
  RWB: { band: 'def', moveRange: 0.42, pressing: 0.5, support: 0.6, widthBias: 0.42, shootBias: 0.08 },
  DM:  { band: 'mid', moveRange: 0.24, pressing: 0.55, support: 0.4, widthBias: 0.0, shootBias: 0.15 },
  CM:  { band: 'mid', moveRange: 0.32, pressing: 0.6, support: 0.6, widthBias: 0.0, shootBias: 0.25 },
  AM:  { band: 'mid', moveRange: 0.34, pressing: 0.55, support: 0.7, widthBias: 0.0, shootBias: 0.4 },
  LW:  { band: 'fwd', moveRange: 0.36, pressing: 0.6, support: 0.65, widthBias: -0.4, shootBias: 0.45 },
  RW:  { band: 'fwd', moveRange: 0.36, pressing: 0.6, support: 0.65, widthBias: 0.4, shootBias: 0.45 },
  ST:  { band: 'fwd', moveRange: 0.30, pressing: 0.5, support: 0.5, widthBias: 0.0, shootBias: 0.6 },
};

/* Step 5: mentality modifiers. */
const MENTALITY_DEFS = {
  DEFENSIVE: { defensiveLineShift: -0.10, pressIntensity: 0.6, forwardBias: -0.12, supportDistance: 0.85, riskFactor: 0.7 },
  BALANCED:  { defensiveLineShift: 0.0,  pressIntensity: 1.0, forwardBias: 0.0,   supportDistance: 1.0,  riskFactor: 1.0 },
  ATTACKING: { defensiveLineShift: 0.12, pressIntensity: 1.3, forwardBias: 0.14,  supportDistance: 1.2,  riskFactor: 1.3 },
};
const DEFAULT_MENTALITY = 'BALANCED';

/* Step 6: playing-style modifiers. */
const STYLE_DEFS = {
  POSSESSION:     { passSafetyBias: 1.0,  transitionSpeed: 0.8,  pressIntensity: 0.9, blockDepth: 1.0, forwardPassBias: -0.15 },
  COUNTER_ATTACK: { passSafetyBias: 0.4,  transitionSpeed: 1.4,  pressIntensity: 0.85, blockDepth: 0.9, forwardPassBias: 0.35 },
  PRESSING:       { passSafetyBias: 0.7,  transitionSpeed: 1.1,  pressIntensity: 1.4, blockDepth: 1.05, forwardPassBias: 0.1 },
  LOW_BLOCK:      { passSafetyBias: 0.8,  transitionSpeed: 1.0,  pressIntensity: 0.55, blockDepth: 0.7, forwardPassBias: 0.25 },
};
const DEFAULT_STYLE = 'POSSESSION';

const TACTICS_CONFIG = {
  transitionWindowSeconds: 2.2,     // Step 12: how long TRANSITION lasts after a possession change
  markRecalcIntervalFrames: 24,     // Step 10-11/19: recompute marking/pressing targets a few times a second, not every frame
  pressJoinDistance: 190 * WORLD_RADIAL_SCALE, // how far from the ball a role's pressing radius can reach at pressing=1
  maxMarkingRange: 260 * WORLD_RADIAL_SCALE,   // defenders won't chase a marking target further than this from their anchor
};
const DEFAULT_SETTINGS_TACTICS = { formationId: DEFAULT_FORMATION_ID, mentality: DEFAULT_MENTALITY, style: DEFAULT_STYLE };

/* ---------- SQUAD / SUBSTITUTION / STAMINA CONFIGURATION (Phase 4) ----------
   Extends the existing config architecture (RULES_CONFIG, TACTICS_CONFIG)
   rather than hard-coding numbers inline. */
const SQUAD_CONFIG = {
  maxSubstitutes: 7,       // Step 4: bench size per side (11v11); smaller sizes just get fewer if the pool runs out
  maxSubstitutions: 5,     // Step 6: default sub limit per team, per match
  subCooldownFrames: 1,    // minimum frames between two subs for the same team (prevents same-frame double-processing)
};
const STAMINA_CONFIG = {
  max: 100,
  // Step 8: drain scales with how hard a player is working this frame —
  // measured from their own velocity (sprinting/dashing/chasing costs
  // more than standing still), not a flat per-frame tax.
  drainPerFrameAtFullSpeed: 0.028,
  drainDashMultiplier: 1.6,
  recoveryPerFrameIdle: 0.05,   // stationary / off the pitch
  recoveryPerFrameWalking: 0.02,
  thresholds: { HIGH: 65, MEDIUM: 40, LOW: 20 }, // >=HIGH: HIGH tier, >=MEDIUM: MEDIUM, >=LOW: LOW, else CRITICAL
  speedFactorByTier: { HIGH: 1.0, MEDIUM: 0.92, LOW: 0.8, CRITICAL: 0.65 },
  pressFactorByTier: { HIGH: 1.0, MEDIUM: 0.85, LOW: 0.6, CRITICAL: 0.35 },
};
const SCORELINE_CONFIG = {
  enabled: true,
  lateGameWindowSeconds: 900,     // "late" = within this many seconds of full time (large so it's reachable in short arcade matches too)
  leadingLineShift: -0.05,        // Step 12: small, conservative nudges applied on top of the user's own mentality/style
  trailingLineShift: 0.06,
  trailingForwardBiasBoost: 0.08,
};
const AI_SUB_CONFIG = {
  enabled: true,
  checkIntervalSeconds: 45,       // Step 13: AI only reconsiders subs this often, never every frame
  criticalStaminaThreshold: STAMINA_CONFIG.thresholds.LOW,
  poorPerformanceMinMinutes: 20,  // don't judge performance on a tiny sample
};

