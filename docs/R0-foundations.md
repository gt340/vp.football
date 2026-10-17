# R0 foundations

The game still ships as one static file, `football-game.html`, at the repository root (Vercel serves `/` via the
`vercel.json` rewrite). R0 changes how that file is **produced and verified**, not how the game plays.

## Layout
- `src/manifest.json` — explicit, ordered list of source slices. Concatenation order **is** the build.
- `src/**` — verbatim slices of the Phase 5 artifact (shell, data, engine, input, ui, rendering). The toy-style
  player renderer is `src/rendering/player-renderer.js`.
- `scripts/build.js` — concatenates slices byte-for-byte; no dependencies, no timestamps.
- `scripts/split-baseline.js` — one-time, hash-gated extraction of the baseline into slices (provenance).
- `scripts/verify-artifact.js` — read-only HTTP check that served pages match the expected hash.
- `scripts/golden-propose.js` — writes a *candidate* player-render signature; never the approved one.
- `scripts/lib/team-schema.js` — team catalogue schema v1 validator (shape and rules only; no real data).
- `tests/` — `node:test` suites plus a from-scratch headless harness (`tests/harness`).

## Commands (Node 18+; no installs needed)
| Command | Purpose |
|---|---|
| `npm run build:artifact` | rebuild `football-game.html` from `src/` (fails if it differs from the recorded baseline) |
| `npm run build:check` | fail if the committed artifact differs from a fresh build (drift) |
| `npm test` | all suites (`node --test`) |
| `npm run test:build / :render / :engine / :sim / :data` | one suite each (shell glob expansion required) |
| `npm run verify:artifact` | needs network: GET `/` and `/football-game.html`, compare SHA-256 |
| `npm run golden:propose` | write `tests/golden/player-base.v1.candidate.json` (not approved) |

The script is deliberately **not** named `build`: Vercel runs `npm run build` automatically when it exists, and the
deployed file is already the committed artifact. (Found when branch previews failed with `src/manifest.json is missing`.)

Exit codes of `build.js`: 0 ok, 1 manifest/source problem (missing or unlisted file), 2 baseline mismatch, 3 artifact drift.

## Baseline
`tests/fixtures/baseline.json` records the Phase 5 artifact: 186,426 bytes, SHA-256
`84b1d74343df1b8093bfdd1797d90a691e39043627bb1f1483d3f1a8deef8a1d`, git blob `63e075e6c5401a3ee8472080aec466149f8cebaf`.
R0 requires the rebuilt artifact to equal it exactly. A later phase that intentionally changes the game must
update this record in its own reviewed commit.

## Golden player-render baseline
`tests/golden/player-base.v1.json` is a draw-call signature of `drawPlayer()` captured from the Phase 5 artifact.
Its status is **APPROVED_DRAWING_INSTRUCTION_REFERENCE** (Commander approval, 2026-10-13, limited to the existing
appearance and deterministic drawing instructions; not approval of future visual changes). Pixel equality between the
original, rebuilt and production-served artifacts was verified with zero differences in headless Chromium 141 on desktop
only: no Android Chrome, physical-device, GPU or cross-browser equivalence is claimed. Ordinary test runs only read it. To change it:
run `npm run golden:propose`, review the candidate, and promote it in a separate commit with explicit approval.
The signature proves drawing *instructions* are unchanged; it does not prove rasterised pixels. Browser-level comparison
covered headless desktop Chromium only; Android and physical-device review remains outstanding.

## What the tests do NOT prove
Real-browser pixels, touch input, audio, Android performance, or that the football rules are *correct* (only that
Phase 5 behaviour is unchanged and internally consistent). Known baseline quirk (not changed here): the away side is
filled from the leftover pool and can contain several goalkeeper-position players.

## Rollback
Nothing in R0 changes production. If a later release misbehaves: Vercel instant rollback to the last known-good
deployment, or `git revert -m 1 <merge commit>` on `main`.
