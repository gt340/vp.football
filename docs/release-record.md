# Release record (R1-0)

Two records exist, with different jobs:

| Record | Role | May change? |
|---|---|---|
| `tests/fixtures/baseline.json` | The original Phase 5 artifact: 186,426 bytes, SHA-256 `84b1d74343df1b8093bfdd1797d90a691e39043627bb1f1483d3f1a8deef8a1d`. | **No.** Pinned byte for byte by `tests/build/release-record.test.js`. |
| `release/release.json` | The approved release artifact. `scripts/build.js` requires the build output to equal it. | Yes, but only in a deliberate, reviewed commit. |

Today they describe the same artifact: the release record is `phase5-approved`, and `derivedFromBaseline` repeats the baseline's identity.

## What the build checks
`node scripts/build.js` (and `--check`):
1. Validates the manifest and every listed or unlisted source file (unchanged from R0).
2. Validates both records. The release record must have `recordVersion` 1, `kind: "release"`, a name, a 64-character lowercase hex SHA-256, a positive integer byte count, an `artifact.path` equal to the manifest output, and a `derivedFromBaseline` identical to `baseline.json`. Any problem exits with code 1.
3. Requires the built bytes and SHA-256 to equal the release record. A mismatch exits with code 2 and prints the built, release and original-baseline identities separately.
4. In `--check` mode, requires the committed artifact to equal the fresh build (exit 3 on drift).

The summary line reports `release` (the record name) and `matchesBaseline` (whether the build still equals the original Phase 5 artifact).
`scripts/verify-artifact.js` also takes its default expected hash and size from the release record.
`scripts/split-baseline.js` is unchanged and still validates its input against the baseline record.

## Changing the artifact in a later phase (checklist)
1. Change the slices and rebuild: `node scripts/build.js` exits 2 until the release record is updated, by design.
2. Update `release/release.json` in the same reviewed commit: new `name`, `artifact.sha256` and `artifact.bytes`. Leave `derivedFromBaseline` and `tests/fixtures/baseline.json` untouched.
3. Replace the tests that assert "the artifact still equals the Phase 5 baseline", deliberately and in that commit:
   - `tests/build/build.test.js`: "committed football-game.html IS the baseline", "GATE: build from src slices reproduces the baseline exactly", the SHA assertion in the deterministic-build test, and the split-script provenance tests (they split the committed artifact).
   - `tests/build/release-record.test.js`: "the committed football-game.html equals the release record" stays valid; update the approved constants and the name test.
   - The player-render golden stays valid as long as `src/rendering/player-renderer.js` is unchanged.

## Limits
- The build alone cannot stop someone editing `baseline.json` and `release.json` together. `tests/build/release-record.test.js` pins `baseline.json` byte for byte, and changes to it need review.
- These checks prove bytes, not behaviour. Gameplay and rendering are covered by the other suites.
