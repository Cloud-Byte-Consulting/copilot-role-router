# Changelog

All notable changes to **copilot-role-router** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Planned
- **Fan-out (best-of-N)** and **Adversary (red-team/debate)** orchestration patterns —
  Phases 2-3 of the CO orchestration investigation. Not yet implemented.

## [1.4.0] - 2026-06-10

### Added
- **Multi-harness support.** role-router now runs on four harnesses: GitHub Copilot CLI
  (unchanged extension), **Claude Code**, **Gemini CLI / Google Antigravity**, and
  **Cursor**.
- **Shared core (`core/`).** The harness-agnostic logic — `repeatable-actions.mjs`
  (judge pipeline, hill-climb, output guard, role action libraries),
  `agent-dispatcher.mjs` + `agent-dispatch-config.json` (task classifier), and the new
  canonical role registry `roles.mjs` — moved out of the Copilot extension tree. The
  extension `src/` files are now thin re-export shims, so the Copilot build and tests
  are unchanged.
- **`core/cli.mjs`** — portable execution surface (`classify`, `judge-open`,
  `judge-finalize`, `guard-scan`, `roles`) so every harness invokes the same
  code-enforced judge/hill-climb/guard logic via node. State persists in
  `.role-router/state.json` (gitignored), keeping the refinement budget sticky across
  sessions on every harness.
- **`AGENTS.md`** — cross-harness CO protocol (read natively by Cursor and Antigravity;
  referenced by `CLAUDE.md` and `GEMINI.md`).
- **Claude Code adapter**: `CLAUDE.md`, `.claude/agents/` subagents for all six roles,
  `.claude/settings.json` hooks (`PostToolUse` output guard, `UserPromptSubmit` dispatch
  plan) backed by node scripts in `.claude/hooks/` that import the shared core.
- **Gemini CLI adapter**: `GEMINI.md`, `.gemini/settings.json` hooks (`AfterTool` guard
  with real credential redaction via result replacement, `BeforeAgent` dispatch plan),
  and `/judge-gate` + `/roles` custom commands in `.gemini/commands/`.
- **Antigravity adapter**: workspace rules in `.agent/rules/role-router.md` and a
  `/judge-gate` workflow in `.agent/workflows/`.
- **Cursor adapter**: always-on rule `.cursor/rules/role-router.mdc`, `.cursor/agents/`
  subagents for all six roles, and a `postToolUse` output-guard hook
  (`.cursor/hooks.json` + `.cursor/hooks/output-guard.mjs`).

### Changed
- `scripts/build.mjs` now syncs `core/agent-dispatch-config.json` to the deployed
  extension copy before bundling.
- README documents the supported harnesses and per-harness installation/limitations.

## [1.3.0] - 2026-06-09

### Added
- **Hill-climb refinement loop (Phase 1 of the CO orchestration patterns).** A `rework`
  verdict now drives a bounded, code-enforced refine→re-verify loop instead of unbounded
  CO-discretion retries. `judge_finalize` returns a directive — `CONTINUE_REFINE`,
  `STOP_BUDGET`, `STOP_PLATEAU`, `STOP_REVIEW`, or `STOP_ACCEPT` — and CO must obey it.
- **`hillclimb` action module** (`computeDirective`, `runKey`, `pruneRuns`, `HILLCLIMB_DEFAULTS`)
  in `repeatable-actions.mjs`, with 22 new `node:test` cases.
- **Stable `runId` threading.** `judge_verify` accepts/returns a `runId` so the refinement
  budget is tracked across rounds even if the intent wording changes.

### Changed
- The round counter is persisted in `state.refineRuns` (keyed by `runId`) and survives reloads,
  so the refinement budget cannot be reset by re-verifying.
- Improvement is measured by **concrete deltas** (shrinking gaps or a ≥0.05 confidence gain),
  and plateau escalation requires **2 consecutive** non-improving rounds.
- STOP verdicts from budget/plateau are **sticky** — a halted run cannot be restarted by
  re-verifying the same intent.
- Docs gate / Scribe recording are **deferred** until a candidate is accepted, so intermediate
  candidates are never recorded as completed work.
- CO prompt updated with the hill-climb protocol; README documents the loop.

### Fixed
- Non-finite Judge confidence is treated as *unknown* (no spurious "improvement").
- `refineRuns` state is bounded via TTL (6 h) + LRU cap to prevent unbounded growth.

## [1.2.2] - 2026-06-09

### Added
- **Two-tier evidence-based Judge verdict pipeline.** Judge now produces a rich
  verdict `{ intentSummary, verdict (PASS|PARTIAL|FAIL), recommendation
  (accept|review|rework), confidence, reasoning, evidence[], gaps[], riskLevel,
  tier }` instead of a naive keyword PASS/FAIL.
- **`judge_finalize` tool.** Lets the Judge LLM submit its JSON verdict so the
  parser/normalizer/merge/fallback logic actually executes at runtime.
- **Output Guard.** New `guardActions.scanOutput()` plus an `onPostToolUse` hook
  that advises on and redacts leaked credentials (advisory, non-blocking).
- **`test/judge.test.mjs`** — 28 `node:test` cases covering the pure verdict
  functions; wired up a `npm test` (`node --test`) script.

### Changed
- Judge prompt rewritten to demand evidence citation, multi-turn artifact
  inspection, intent-summary-first ordering, and a closing JSON-only forcing
  message.
- Confidence thresholds now drive the `accept | review | rework` recommendation.

### Fixed
- Stale-pending Judge verifications auto-recover on the next prompt instead of
  blocking the pipeline.
- Hardened the JSON parser (null guard), narrowed anti-gaming tripwires, added a
  concrete-evidence gate for PASS, a role guard, a `none` risk level, a
  reachable `rawVerdict` fallback, and a `__VERSION__` fallback.

## [1.2.1] - 2026-06-09

### Changed
- Rewrote `README.md`: fixed rendering corruption, corrected the install/update
  commands to reference `/extensions manage` and the `install_extension` tool,
  and added a **Build** section.

### Removed
- Dropped the outdated **Scribe Behavior** section from the README.

## [1.2.0] - 2026-06-08

### Added
- **Judge docs gate.** Judge now returns a `docsAction` of
  `none | update | create | ask_user`, so CO resolves documentation before
  recording work.
- **Scribe doc actions.** Scribe can patch an identified doc section or create a
  proposed file (it still never opens new issues or edits comments without user
  input).
- CI path filters and a pipeline-failure label/dedup fix with an Engineer
  pipeline standard.

### Changed
- Documentation changes no longer bump the version or trigger a release.

## [1.1.0] - 2026-06-08

### Added
- **Multi-role orchestration foundation.** CO is the sole user-facing entry
  point and delegates to Recon, Medic, Engineer, QA, Scribe, and Judge.
- **Intelligent agent dispatcher.** Keyword-overlap task classification drives a
  dispatch plan injected into CO's context.
- **Judge intent-verification gate** and **Scribe decision recording**
  (auto-comments on and links existing work items/PRs/branches).
- **Repeatable actions library** shared across all roles.
- **Build & release substrate:** bun bundle pipeline, semver tooling
  (`scripts/bump.mjs`), and GitHub Actions.
- Configurable Scribe targets (GitHub + ADO) and comprehensive installation
  instructions.

[Unreleased]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/v-leorichard_microsoft/copilot-role-router/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/v-leorichard_microsoft/copilot-role-router/releases/tag/v1.1.0
