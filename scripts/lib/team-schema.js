'use strict';
/*
 * Team catalogue schema v1: validator (the executable specification).
 * R0 defines the SHAPE and RULES only. It ships NO real clubs, players, colours, sources or badges.
 *
 * Catalogue:  { schemaVersion: 1, dataVersion: "<string>", teams: [Team] }
 * Team:       { teamId, type: "club"|"national", name, shortName, country|null, competition|null,
 *               colors: { primary, secondary, tertiary? }, kitPattern?, legacyIds?: [string],
 *               roster: [Player], badge?: { assetRef, license: { status: "granted", grantedBy, notes? } },
 *               verification: { status: "unverified"|"verified"|"disputed", verifiedOn|null, verifiedBy|null,
 *                               sources: [{ type, citation, accessedOn }] } }
 * Player:     { playerId, teamId, displayName, position: GK|DF|MF|FW,
 *               gameplay: { speed, power, tackle, skill } (0..100 ints), attributesOrigin: "generated"|"editorial",
 *               factual?: { ... only sourced facts, never gameplay numbers ... } }
 * Missing/uncertain facts are null with verification.status "unverified"; they are never guessed.
 * Gameplay numbers are game values, not real-world statistics.
 */
const TEAM_TYPES = ['club', 'national'];
const POSITIONS = ['GK', 'DF', 'MF', 'FW'];
const KIT_PATTERNS = ['solid', 'hoops', 'stripes', 'sash', 'halves'];
const VERIFY_STATUS = ['unverified', 'verified', 'disputed'];
const SOURCE_TYPES = ['official-site', 'federation', 'reference', 'other'];
const ORIGINS = ['generated', 'editorial'];
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nonEmpty = (s) => typeof s === 'string' && s.trim().length > 0;

function validateCatalogue(cat, { minRoster = 12 } = {}) {
  const errors = [];
  const err = (p, m) => errors.push({ path: p, message: m });
  if (!cat || typeof cat !== 'object') return { errors: [{ path: '', message: 'catalogue must be an object' }] };
  if (cat.schemaVersion !== 1) err('schemaVersion', 'must be 1');
  if (!nonEmpty(cat.dataVersion)) err('dataVersion', 'required');
  if (!Array.isArray(cat.teams)) { err('teams', 'must be an array'); return { errors }; }

  const teamIds = new Set(), playerIds = new Set();
  cat.teams.forEach((t, i) => {
    const tp = `teams[${i}]`;
    if (!t || typeof t !== 'object') return err(tp, 'must be an object');
    if (!SLUG.test(t.teamId || '')) err(`${tp}.teamId`, 'required slug (lowercase letters, digits, hyphens)');
    else if (teamIds.has(t.teamId)) err(`${tp}.teamId`, `duplicate teamId "${t.teamId}"`); else teamIds.add(t.teamId);
    if (!TEAM_TYPES.includes(t.type)) err(`${tp}.type`, 'must be club or national');
    if (!nonEmpty(t.name)) err(`${tp}.name`, 'required');
    if (!nonEmpty(t.shortName) || t.shortName.length > 6) err(`${tp}.shortName`, 'required, at most 6 characters');
    for (const k of ['country', 'competition']) if (t[k] !== null && !nonEmpty(t[k])) err(`${tp}.${k}`, 'must be a string or null (null = unknown)');
    const c = t.colors;
    if (!c || !HEX.test(c.primary || '')) err(`${tp}.colors.primary`, 'required hex colour');
    if (!c || !HEX.test(c.secondary || '')) err(`${tp}.colors.secondary`, 'required hex colour');
    if (c && c.tertiary !== undefined && !HEX.test(c.tertiary)) err(`${tp}.colors.tertiary`, 'must be a hex colour');
    if (t.kitPattern !== undefined && !KIT_PATTERNS.includes(t.kitPattern)) err(`${tp}.kitPattern`, `must be one of ${KIT_PATTERNS.join(', ')}`);
    if (t.legacyIds !== undefined && !(Array.isArray(t.legacyIds) && t.legacyIds.every(nonEmpty))) err(`${tp}.legacyIds`, 'must be an array of strings');
    if (t.badge !== undefined) {
      const l = t.badge && t.badge.license;
      if (!nonEmpty(t.badge && t.badge.assetRef)) err(`${tp}.badge.assetRef`, 'required when badge is present');
      if (!l || l.status !== 'granted' || !nonEmpty(l.grantedBy)) err(`${tp}.badge.license`, 'a badge needs license.status "granted" and grantedBy');
    }
    const v = t.verification;
    if (!v || !VERIFY_STATUS.includes(v.status)) err(`${tp}.verification.status`, `must be one of ${VERIFY_STATUS.join(', ')}`);
    else if (v.status === 'verified') {
      if (!DATE.test(v.verifiedOn || '')) err(`${tp}.verification.verifiedOn`, 'required YYYY-MM-DD for verified records');
      if (!Array.isArray(v.sources) || v.sources.length === 0) err(`${tp}.verification.sources`, 'verified records need at least one source');
      else v.sources.forEach((s, j) => {
        if (!SOURCE_TYPES.includes(s && s.type)) err(`${tp}.verification.sources[${j}].type`, `must be one of ${SOURCE_TYPES.join(', ')}`);
        if (!nonEmpty(s && s.citation)) err(`${tp}.verification.sources[${j}].citation`, 'required');
        if (!DATE.test((s && s.accessedOn) || '')) err(`${tp}.verification.sources[${j}].accessedOn`, 'required YYYY-MM-DD');
      });
    }
    if (!Array.isArray(t.roster)) return err(`${tp}.roster`, 'must be an array');
    if (t.roster.length < minRoster) err(`${tp}.roster`, `needs at least ${minRoster} players (has ${t.roster.length})`);
    if (!t.roster.some((p) => p && p.position === 'GK')) err(`${tp}.roster`, 'needs at least one goalkeeper');
    t.roster.forEach((p, j) => {
      const pp = `${tp}.roster[${j}]`;
      if (!p || typeof p !== 'object') return err(pp, 'must be an object');
      if (!SLUG.test(p.playerId || '')) err(`${pp}.playerId`, 'required slug');
      else if (playerIds.has(p.playerId)) err(`${pp}.playerId`, `duplicate playerId "${p.playerId}" (a player may be in only one roster)`); else playerIds.add(p.playerId);
      if (p.teamId !== t.teamId) err(`${pp}.teamId`, `must equal the parent team "${t.teamId}" (got "${p.teamId}")`);
      if (!nonEmpty(p.displayName)) err(`${pp}.displayName`, 'required');
      if (!POSITIONS.includes(p.position)) err(`${pp}.position`, `must be one of ${POSITIONS.join(', ')}`);
      if (!ORIGINS.includes(p.attributesOrigin)) err(`${pp}.attributesOrigin`, 'must be generated or editorial');
      const g = p.gameplay;
      for (const k of ['speed', 'power', 'tackle', 'skill']) if (!g || !Number.isInteger(g[k]) || g[k] < 0 || g[k] > 100) err(`${pp}.gameplay.${k}`, 'integer 0..100 required');
    });
  });
  return { errors };
}

// Stricter gate for shipping a catalogue: every team must be verified.
function validateForRelease(cat, opts) {
  const base = validateCatalogue(cat, opts);
  if (Array.isArray(cat && cat.teams)) cat.teams.forEach((t, i) => {
    if (!t || !t.verification || t.verification.status !== 'verified') base.errors.push({ path: `teams[${i}].verification.status`, message: 'release requires status "verified"' });
  });
  return base;
}

module.exports = { validateCatalogue, validateForRelease, TEAM_TYPES, POSITIONS, KIT_PATTERNS };
