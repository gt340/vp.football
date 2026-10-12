/* ---------- GAME STATE MACHINE (Step 3) ----------
   Centralizes what used to be scattered booleans (state.running, screen
   hidden/shown flags). Invalid transitions (e.g. jumping straight to
   PLAYING without a valid squad) are rejected and logged. */
const GameStates = Object.freeze({
  MENU: 'MENU',
  SQUAD_SELECTION: 'SQUAD_SELECTION',
  PRE_MATCH: 'PRE_MATCH',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  HALFTIME: 'HALFTIME',
  FULL_TIME: 'FULL_TIME',
  SETTINGS: 'SETTINGS',
  TRAINING: 'TRAINING',
});

const ALLOWED_TRANSITIONS = {
  [GameStates.MENU]: [GameStates.SQUAD_SELECTION, GameStates.SETTINGS],
  [GameStates.SQUAD_SELECTION]: [GameStates.MENU, GameStates.PRE_MATCH],
  [GameStates.PRE_MATCH]: [GameStates.PLAYING, GameStates.SQUAD_SELECTION],
  [GameStates.PLAYING]: [GameStates.PAUSED, GameStates.HALFTIME, GameStates.FULL_TIME],
  [GameStates.PAUSED]: [GameStates.PLAYING, GameStates.MENU],
  [GameStates.HALFTIME]: [GameStates.PLAYING],
  [GameStates.FULL_TIME]: [GameStates.MENU, GameStates.PRE_MATCH],
  [GameStates.SETTINGS]: [GameStates.MENU],
  [GameStates.TRAINING]: [GameStates.MENU],
};

class GameStateMachine {
  constructor(initial) { this.current = initial; }
  can(next) { return (ALLOWED_TRANSITIONS[this.current] || []).includes(next); }
  transition(next, payload) {
    if (!this.can(next)) {
      console.warn(`[GameState] Rejected invalid transition: ${this.current} -> ${next}`);
      return false;
    }
    const from = this.current;
    this.current = next;
    EventBus.emit('stateChange', { from, to: next, payload });
    return true;
  }
  is(...states) { return states.includes(this.current); }
}
const Game = { state: new GameStateMachine(GameStates.MENU) };

/* ---------- MATCH PERIOD FLOW (Phase 2, Step 2) ----------
   Sits inside the existing top-level PLAYING game state (Game.state
   stays MENU/SQUAD_SELECTION/PRE_MATCH/PLAYING/HALFTIME/FULL_TIME as
   Phase 1 defined it) and tracks which part of the match is underway.
   The GameStateMachine still governs screen-level flow; MatchPeriods
   governs engine-level flow within PLAYING/HALFTIME. */
const MatchPeriods = Object.freeze({
  PRE_MATCH: 'PRE_MATCH',
  KICKOFF: 'KICKOFF',
  FIRST_HALF: 'FIRST_HALF',
  HALFTIME: 'HALFTIME',
  SECOND_HALF: 'SECOND_HALF',
  FULL_TIME: 'FULL_TIME',
});

/* ---------- SAVE SYSTEM FOUNDATION (Step 11) ----------
   Versioned, validated localStorage access. Corrupted or malformed data
   is caught and ignored rather than crashing the game. Career mode /
   progression data is not implemented yet — this only persists settings
   for now, but the shape supports the future fields. */
const SaveManager = {
  _emptySave() {
    return { version: SAVE_CONFIG.version, settings: {}, playerData: {}, teamData: {}, progression: {} };
  },
  save(partial) {
    try {
      const merged = { ...this._emptySave(), ...(this.load(true) || {}), ...partial, version: SAVE_CONFIG.version };
      localStorage.setItem(SAVE_CONFIG.storageKey, JSON.stringify(merged));
      return true;
    } catch (err) {
      console.error('[SaveManager] save failed', err);
      return false;
    }
  },
  load(silent) {
    try {
      const raw = localStorage.getItem(SAVE_CONFIG.storageKey);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!this.validate(data)) {
        if (!silent) console.warn('[SaveManager] save data failed validation, ignoring');
        return null;
      }
      return data;
    } catch (err) {
      console.error('[SaveManager] corrupted save data, ignoring', err);
      return null;
    }
  },
  validate(data) {
    return !!data && typeof data === 'object' && typeof data.version === 'number' && data.version <= SAVE_CONFIG.version;
  },
  reset() {
    try { localStorage.removeItem(SAVE_CONFIG.storageKey); return true; }
    catch (err) { console.error('[SaveManager] reset failed', err); return false; }
  },
};

/* ---------- SETTINGS FOUNDATION (Step 12) ---------- */
const SettingsManager = {
  current: { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio }, tactics: { ...DEFAULT_SETTINGS.tactics } },
  load() {
    const saved = SaveManager.load(true);
    this.current = saved && saved.settings && Object.keys(saved.settings).length
      ? { ...DEFAULT_SETTINGS, ...saved.settings,
          audio: { ...DEFAULT_SETTINGS.audio, ...(saved.settings.audio || {}) },
          tactics: { ...DEFAULT_SETTINGS_TACTICS, ...(saved.settings.tactics || {}) } }
      : { ...DEFAULT_SETTINGS, audio: { ...DEFAULT_SETTINGS.audio }, tactics: { ...DEFAULT_SETTINGS_TACTICS } };
    if (!FORMATION_IDS.includes(this.current.tactics.formationId)) this.current.tactics.formationId = DEFAULT_FORMATION_ID;
    if (!MENTALITY_DEFS[this.current.tactics.mentality]) this.current.tactics.mentality = DEFAULT_MENTALITY;
    if (!STYLE_DEFS[this.current.tactics.style]) this.current.tactics.style = DEFAULT_STYLE;
    return this.current;
  },
  persist() { SaveManager.save({ settings: this.current }); },
};

/* ---------- DATA MODELS (Steps 5, 6, 7) ----------
   Structured representations that don't yet drive every gameplay
   calculation (existing speed/power/tackle/skill fields keep working
   unchanged) but establish the shape that career/progression/tactics
   systems will build on in later phases. */
function buildPlayerProfile(base, teamId) {
  return {
    id: base.id, name: base.name, number: base.id, position: base.pos, teamId,
    overall: Math.round((base.speed + base.power + base.tackle + base.skill) / 4),
    pace: base.speed, acceleration: base.speed, shooting: base.power, passing: base.skill,
    dribbling: base.skill, defending: base.tackle, tackling: base.tackle, strength: base.power,
    stamina: 100, heading: base.power, reactions: base.skill, positioning: base.skill,
    goalkeeping: base.pos === 'GK' ? base.tackle : 0, weakFoot: 3, skillRating: base.skill,
    fitness: 100, form: 3, experience: 0, level: 1,
  };
}
// Phase 2, Step 6: structured match-level disciplinary state per player.
function buildDiscipline() {
  return { yellowCards: 0, redCard: false, sentOff: false };
}
// Phase 2, Step 18: per-player match statistics, incremented only from
// real gameplay events (never fabricated).
function buildPlayerMatchStats() {
  return {
    goals: 0, assists: 0, shots: 0, shotsOnTarget: 0,
    passes: 0, completedPasses: 0, tackles: 0, foulsCommitted: 0,
    yellowCards: 0, redCards: 0, offsides: 0, saves: 0,
    minutesPlayed: 0, // Phase 4, Step 15
  };
}
// Phase 4, Step 4/8: squad/condition status, separate from matchStats
// (which is purely event-derived counters) since this is live state
// that changes every frame rather than an incrementing counter.
function buildSquadStatus(isStarter) {
  return {
    isStarter, isSubstitute: !isStarter, isOnPitch: isStarter,
    stamina: STAMINA_CONFIG.max, subbedOutAtMinute: null, subbedInAtMinute: null,
  };
}
// Step 8: transparent, config-driven stamina tier (never a hidden number).
function staminaTier(stamina) {
  const t = STAMINA_CONFIG.thresholds;
  if (stamina >= t.HIGH) return 'HIGH';
  if (stamina >= t.MEDIUM) return 'MEDIUM';
  if (stamina >= t.LOW) return 'LOW';
  return 'CRITICAL';
}
// Step 14: an explicit, derivable-from-existing-stats performance score
// — not an invented hidden rating. Every term is a real matchStats
// field; the weights are the only "made up" part, and they're right
// here to see and tune.
function playerPerformanceScore(p) {
  const s = p.matchStats;
  return Math.round(
    s.goals * 10 + s.assists * 6 + s.completedPasses * 0.3 + s.tackles * 1.5 +
    s.saves * 4 + s.shotsOnTarget * 1 - s.foulsCommitted * 2 - s.yellowCards * 3 - s.redCards * 8
  );
}
function buildTeamModel(teamDef) {
  return {
    id: teamDef.id, name: teamDef.name, shortName: teamDef.abbr, players: [],
    formation: null, tactics: { mentality: 'balanced' },
    teamColor: teamDef.primary, secondaryColor: teamDef.secondary,
  };
}
// Phase 2, Step 18-19: team statistics extended with fouls/cards/offside/
// set-piece counts and possession tracking, alongside the Phase 1 fields.
function buildTeamStatistics() {
  return {
    shotsHome: 0, shotsAway: 0,
    shotsOnTargetHome: 0, shotsOnTargetAway: 0,
    passesHome: 0, passesAway: 0,
    completedPassesHome: 0, completedPassesAway: 0,
    tacklesHome: 0, tacklesAway: 0,
    successfulTacklesHome: 0, successfulTacklesAway: 0,
    foulsHome: 0, foulsAway: 0,
    yellowCardsHome: 0, yellowCardsAway: 0,
    redCardsHome: 0, redCardsAway: 0,
    offsidesHome: 0, offsidesAway: 0,
    cornersHome: 0, cornersAway: 0,
    goalKicksHome: 0, goalKicksAway: 0,
    throwInsHome: 0, throwInsAway: 0,
    freeKicksHome: 0, freeKicksAway: 0,
    penaltiesHome: 0, penaltiesAway: 0,
    savesHome: 0, savesAway: 0,
    possessionHomeMs: 0, possessionAwayMs: 0,
  };
}
function buildMatchModel() {
  return {
    matchId: null, homeTeam: null, awayTeam: null, homeScore: 0, awayScore: 0,
    matchTime: 0, matchDuration: MATCH_CONFIG.defaultDuration,
    period: MatchPeriods.PRE_MATCH, halfDuration: MATCH_CONFIG.defaultDuration / 2,
    stoppageSecondsFirst: 0, stoppageSecondsSecond: 0,
    status: 'idle',
    selectedPlayer: null, events: [],
    statistics: buildTeamStatistics(),
    setPiece: null, // current SetPieceManager state, or null when play is open
  };
}
const MAX_MATCH_EVENTS = 200; // Step 17: avoid unbounded growth in a long session
function recordMatchEvent(type, data) {
  if (!state.match) return;
  state.match.events.push({ type, time: state.match.matchTime, ...data });
  if (state.match.events.length > MAX_MATCH_EVENTS) state.match.events.shift();
}
/* ---------- MATCH EVENT -> STATISTICS WIRING (Phase 2, Step 17-19) ----------
   Every statistic is derived from a real EventBus emission — nothing
   here is randomly generated. Phase 1's shot/pass/tackle/goal listeners
   are extended in place (same event names via GameEvents). */
EventBus.on(GameEvents.SHOT, ({ home, onTarget, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'shotsHome' : 'shotsAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.shots++;
  recordMatchEvent(GameEvents.SHOT, { home, onTarget, playerId });
  if (onTarget) EventBus.emit(GameEvents.SHOT_ON_TARGET, { home, playerId });
});
EventBus.on(GameEvents.SHOT_ON_TARGET, ({ home, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'shotsOnTargetHome' : 'shotsOnTargetAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.shotsOnTarget++;
  recordMatchEvent(GameEvents.SHOT_ON_TARGET, { home, playerId });
});
EventBus.on(GameEvents.PASS, ({ home, through, playerId, completed }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'passesHome' : 'passesAway']++;
  if (completed) state.match.statistics[home ? 'completedPassesHome' : 'completedPassesAway']++;
  const p = findPlayerById(playerId);
  if (p) { p.matchStats.passes++; if (completed) p.matchStats.completedPasses++; }
  recordMatchEvent(GameEvents.PASS, { home, through, playerId, completed });
});
EventBus.on(GameEvents.TACKLE, ({ home, success, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'tacklesHome' : 'tacklesAway']++;
  if (success) state.match.statistics[home ? 'successfulTacklesHome' : 'successfulTacklesAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.tackles++;
  recordMatchEvent(GameEvents.TACKLE, { home, success, playerId });
});
EventBus.on(GameEvents.GOAL, ({ home, scorerId, assistId }) => {
  if (!state.match) return;
  state.match[home ? 'homeScore' : 'awayScore']++;
  const scorer = findPlayerById(scorerId);
  if (scorer) scorer.matchStats.goals++;
  const assister = findPlayerById(assistId);
  if (assister) { assister.matchStats.assists++; EventBus.emit(GameEvents.ASSIST, { home, playerId: assistId }); }
  state.stoppageAccrued += RULES_CONFIG.stoppageTime.perGoalSeconds;
  recordMatchEvent(GameEvents.GOAL, { home, scorerId, assistId });
});
EventBus.on(GameEvents.FOUL, (foul) => {
  if (!state.match) return;
  state.match.statistics[foul.home ? 'foulsHome' : 'foulsAway']++;
  const p = findPlayerById(foul.playerId);
  if (p) p.matchStats.foulsCommitted++;
  recordMatchEvent(GameEvents.FOUL, foul);
});
EventBus.on(GameEvents.YELLOW_CARD, ({ home, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'yellowCardsHome' : 'yellowCardsAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.yellowCards++;
  state.stoppageAccrued += RULES_CONFIG.stoppageTime.perCardSeconds;
  recordMatchEvent(GameEvents.YELLOW_CARD, { home, playerId });
});
EventBus.on(GameEvents.RED_CARD, ({ home, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'redCardsHome' : 'redCardsAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.redCards++;
  state.stoppageAccrued += RULES_CONFIG.stoppageTime.perCardSeconds;
  recordMatchEvent(GameEvents.RED_CARD, { home, playerId });
});
EventBus.on(GameEvents.OFFSIDE, ({ home, playerId, passerId, location }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'offsidesHome' : 'offsidesAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.offsides++;
  recordMatchEvent(GameEvents.OFFSIDE, { home, playerId, passerId, location });
});
EventBus.on(GameEvents.CORNER, ({ home }) => { if (state.match) { state.match.statistics[home ? 'cornersHome' : 'cornersAway']++; recordMatchEvent(GameEvents.CORNER, { home }); } });
EventBus.on(GameEvents.GOAL_KICK, ({ home }) => { if (state.match) { state.match.statistics[home ? 'goalKicksHome' : 'goalKicksAway']++; recordMatchEvent(GameEvents.GOAL_KICK, { home }); } });
EventBus.on(GameEvents.THROW_IN, ({ home }) => { if (state.match) { state.match.statistics[home ? 'throwInsHome' : 'throwInsAway']++; recordMatchEvent(GameEvents.THROW_IN, { home }); } });
EventBus.on(GameEvents.FREE_KICK, ({ home }) => { if (state.match) { state.match.statistics[home ? 'freeKicksHome' : 'freeKicksAway']++; recordMatchEvent(GameEvents.FREE_KICK, { home }); state.stoppageAccrued += RULES_CONFIG.stoppageTime.perSetPieceSeconds; } });
EventBus.on(GameEvents.PENALTY, ({ home }) => { if (state.match) { state.match.statistics[home ? 'penaltiesHome' : 'penaltiesAway']++; recordMatchEvent(GameEvents.PENALTY, { home }); state.stoppageAccrued += RULES_CONFIG.stoppageTime.perSetPieceSeconds; } });
EventBus.on(GameEvents.SAVE, ({ home, playerId }) => {
  if (!state.match) return;
  state.match.statistics[home ? 'savesHome' : 'savesAway']++;
  const p = findPlayerById(playerId);
  if (p) p.matchStats.saves++;
  recordMatchEvent(GameEvents.SAVE, { home, playerId });
});

/* ---------- ERROR SAFETY HELPERS (Step 18) ---------- */
function isFiniteNum(n) { return typeof n === 'number' && isFinite(n); }
function sanitizeEntity(e, fallbackX, fallbackY) {
  if (!isFiniteNum(e.x) || !isFiniteNum(e.y)) { e.x = fallbackX; e.y = fallbackY; e.vx = 0; e.vy = 0; }
  if (!isFiniteNum(e.vx) || !isFiniteNum(e.vy)) { e.vx = 0; e.vy = 0; }
}

/* ---------- RUNTIME STATE ----------
   Kept as one object (as before) to avoid destabilizing every call site
   in a single pass. keys/stick/buttons are now owned by InputManager —
   state simply aliases them so all existing state.keys[...] references
   keep working while input handling lives in one place (Step 10). */
let state = {
  homeTeam: TEAMS[0],
  awayTeam: TEAMS[1],
  duration: MATCH_CONFIG.defaultDuration,
  teamSize: MATCH_CONFIG.defaultTeamSize,
  selectedPlayerIds: [],
  running: false,
  timeLeft: MATCH_CONFIG.defaultDuration,
  scoreHome: 0,
  scoreAway: 0,
  homePlayers: [],
  awayPlayers: [],
  ball: null,
  controlledId: null,
  keys: null, stick: null, buttons: null, // assigned from InputManager below
  lastTime: 0,
  goalFlash: 0,
  soundOn: true,
  lastAutoSwitch: 0,
  commentTimer: 0,
  match: null,
  // ---- Phase 2: match-period flow ----
  matchPeriod: MatchPeriods.PRE_MATCH,
  halfDuration: MATCH_CONFIG.defaultDuration / 2,
  kickoffFreeze: 0,       // frames remaining before kickoff play actually starts
  kickoffTeamIsHome: true,
  stoppageAccrued: 0,     // seconds accrued this half, added once timeLeft hits 0
  stoppageRemaining: 0,   // seconds currently counting down as added time
  // ---- Phase 2: referee/rules tracking ----
  lastTouch: null,        // { isHome, playerId } - who last played the ball
  lastPassBy: null,       // { playerId, isHome, time } - for assist attribution
  lastShotBy: null,       // { playerId, isHome, time } - for goal/save attribution
  collisionFoulCooldowns: {}, // "idA-idB" -> last foul timestamp(ms), avoids scrum spam
  possession: { team: null, homeMs: 0, awayMs: 0 },
  setPiece: null,         // active SetPieceManager state, or null
  nextFoulEventId: 1,
  // ---- Phase 3: tactical state ----
  homeTactics: { formationId: DEFAULT_FORMATION_ID, mentality: DEFAULT_MENTALITY, style: DEFAULT_STYLE },
  awayTactics: { formationId: '4-4-2', mentality: DEFAULT_MENTALITY, style: 'COUNTER_ATTACK' }, // fixed AI-only default; not user-editable in Phase 3
  tacticalPhase: { home: 'DEFENDING', away: 'ATTACKING', homeSince: 0, awaySince: 0 }, // Step 12
  markRecalcTimer: 0,
  pressEmitCooldowns: {}, // playerId -> last PRESS_TRIGGERED emit time(ms), avoids event spam
  // ---- Phase 4: squad / substitutions / stamina ----
  homeBench: [], awayBench: [],
  substitutionsUsed: { home: 0, away: 0 },
  pendingSubstitution: null, // queued sub request waiting out an active set piece (Step 5, 24)
  aiSubCheckTimer: 0,
  aiSubCooldowns: {}, // teamKey -> last AI sub time(ms)
  tacticalPanelOpen: false,
  // ---- Phase 5: human-player shot charging (press SHOOT to charge, release to fire) ----
  shootCharging: false,
  shootChargeStart: 0,
};

