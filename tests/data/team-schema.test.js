'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCatalogue, validateForRelease } = require('../../scripts/lib/team-schema');

// All fixtures below are obviously fictional test data. R0 ships no real club or player data.
function player(i, teamId, position = 'MF') {
  return { playerId: `${teamId}-p${i}`, teamId, displayName: `Test Player ${i}`, position, attributesOrigin: 'generated', gameplay: { speed: 50, power: 50, tackle: 50, skill: 50 } };
}
function team(id, overrides = {}) {
  const roster = [player(1, id, 'GK'), ...Array.from({ length: 12 }, (_, k) => player(k + 2, id))];
  return { teamId: id, type: 'club', name: `Test FC ${id}`, shortName: 'TST', country: null, competition: null,
    colors: { primary: '#112233', secondary: '#fff' }, roster, verification: { status: 'unverified', verifiedOn: null, verifiedBy: null, sources: [] }, ...overrides };
}
const cat = (...teams) => ({ schemaVersion: 1, dataVersion: 'test-1', teams });
const messages = (c, opts) => validateCatalogue(c, opts).errors.map((e) => `${e.path}: ${e.message}`);

test('a minimal valid catalogue passes; unknown facts may be null with status "unverified"', () => {
  assert.deepEqual(messages(cat(team('alpha'), team('bravo'))), []);
});

test('rejects wrong schemaVersion, missing dataVersion, and non-array teams', () => {
  assert.ok(messages({ ...cat(team('a')), schemaVersion: 2 }).some((m) => /schemaVersion/.test(m)));
  assert.ok(messages({ schemaVersion: 1, teams: [] }).some((m) => /dataVersion/.test(m)));
  assert.ok(messages({ schemaVersion: 1, dataVersion: 'x', teams: 'no' }).some((m) => /teams/.test(m)));
});

test('rejects duplicate team ids and duplicate player ids across teams', () => {
  assert.ok(messages(cat(team('alpha'), team('alpha'))).some((m) => /duplicate teamId/.test(m)));
  const a = team('alpha'), b = team('bravo');
  b.roster[3].playerId = a.roster[3].playerId; // same player id in two rosters
  b.roster[3].teamId = 'bravo';
  assert.ok(messages(cat(a, b)).some((m) => /duplicate playerId/.test(m)));
});

test('rejects a player assigned to the wrong team', () => {
  const a = team('alpha');
  a.roster[2].teamId = 'bravo';
  assert.ok(messages(cat(a)).some((m) => /must equal the parent team/.test(m)));
});

test('rejects invalid colours, kit patterns, positions, types, and out-of-range attributes', () => {
  const t = team('alpha', { type: 'league', colors: { primary: 'red', secondary: '#12' }, kitPattern: 'plaid' });
  t.roster[1].position = 'XX';
  t.roster[1].gameplay.speed = 101;
  t.roster[2].gameplay.skill = 49.5;
  t.roster[3].attributesOrigin = 'real-stats';
  const m = messages(cat(t)).join('\n');
  for (const re of [/type/, /colors\.primary/, /colors\.secondary/, /kitPattern/, /position/, /gameplay\.speed/, /gameplay\.skill/, /attributesOrigin/]) assert.match(m, re);
});

test('rejects incomplete teams: short roster, no goalkeeper, missing names', () => {
  const t = team('alpha', { name: '', shortName: 'TOOLONGNAME' });
  t.roster = t.roster.slice(0, 5).map((p) => ({ ...p, position: 'MF' }));
  const m = messages(cat(t)).join('\n');
  assert.match(m, /name/); assert.match(m, /shortName/); assert.match(m, /at least 12 players/); assert.match(m, /goalkeeper/);
});

test('verified records need a date and at least one well-formed source', () => {
  const bad = team('alpha', { verification: { status: 'verified', verifiedOn: null, verifiedBy: 'x', sources: [] } });
  const m = messages(cat(bad)).join('\n');
  assert.match(m, /verifiedOn/); assert.match(m, /sources/);
  const ok = team('alpha', { verification: { status: 'verified', verifiedOn: '2026-01-02', verifiedBy: 'reviewer', sources: [{ type: 'reference', citation: 'Example citation', accessedOn: '2026-01-01' }] } });
  assert.deepEqual(messages(cat(ok)), []);
  const malformed = team('alpha', { verification: { status: 'verified', verifiedOn: '2026-01-02', verifiedBy: 'r', sources: [{ type: 'blog', citation: '', accessedOn: 'yesterday' }] } });
  assert.match(messages(cat(malformed)).join('\n'), /sources\[0\]/);
});

test('a badge is rejected unless a granted licence is recorded', () => {
  assert.ok(messages(cat(team('alpha', { badge: { assetRef: 'badges/x.svg' } }))).some((m) => /badge\.license/.test(m)));
  assert.ok(messages(cat(team('alpha', { badge: { assetRef: 'badges/x.svg', license: { status: 'pending' } } }))).some((m) => /badge\.license/.test(m)));
  assert.deepEqual(messages(cat(team('alpha', { badge: { assetRef: 'badges/x.svg', license: { status: 'granted', grantedBy: 'Rights holder (test)' } } }))), []);
});

test('release validation additionally requires every team to be verified', () => {
  const c = cat(team('alpha'));
  assert.deepEqual(validateCatalogue(c).errors, []);
  assert.ok(validateForRelease(c).errors.some((e) => /release requires/.test(e.message)));
});

test('garbage input does not throw', () => {
  for (const x of [null, undefined, 5, 'x', [], {}, { schemaVersion: 1, dataVersion: 'x', teams: [null, 5, {}] }]) assert.doesNotThrow(() => validateCatalogue(x));
});
