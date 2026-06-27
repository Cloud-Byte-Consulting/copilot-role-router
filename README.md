> **DEPRECATED — archived as of Phase 2.**
> Orchestration has moved to the Omnigent supervisor YAML at
> [`omnigent/examples/role_router/config.yaml`](/home/bittahcriminal/air/workspace/omnigent/examples/role_router/config.yaml).
> The Judge gate and hill-climb budget are ported: deterministic hill-climb budget as a
> nessie policy, two-tier Judge as an omnigent skill. This repo is read-only; do not extend it.

# copilot-role-router

A multi-role agent orchestrator for **GitHub Copilot, Claude Code, Gemini CLI / Google Antigravity, and Cursor**. **CO** (Commanding Officer) is the only user-facing entry point; it transparently delegates work to specialized roles (Recon, Medic, Engineer, QA, Scribe, Judge) and enforces decision gates.

## Supported harnesses

The harness-agnostic logic (role registry, task classifier, judge verdict pipeline, hill-climb budget, output guard) lives in [`core/`](./core) with a portable CLI (`core/cli.mjs`), so every harness runs the **same code-enforced gates** — only the packaging differs:

| Harness | Packaging | Output guard | Dispatch plan | Judge + hill-climb |
|---|---|---|---|---|
| **GitHub Copilot CLI** | Programmatic extension (`.github/extensions/role-router/`) | `onPostToolUse` hook, in-place credential redaction | `onUserPromptSubmitted` hook | `judge_verify` / `judge_finalize` tools |
| **Claude Code** | `CLAUDE.md` + `.claude/agents/` subagents + `.claude/settings.json` hooks | `PostToolUse` hook (advisory — no redaction; see limitations) | `UserPromptSubmit` hook | `node core/cli.mjs judge-open / judge-finalize` via the `judge` subagent |
| **Gemini CLI** | `GEMINI.md` + `.gemini/settings.json` hooks + `/judge-gate`, `/roles` commands | `AfterTool` hook with **real redaction** (replaces the tool result) | `BeforeAgent` hook | `node core/cli.mjs ...` |
| **Google Antigravity** | `AGENTS.md` + `GEMINI.md` + `.agent/rules/` + `/judge-gate` workflow | Manual: `node core/cli.mjs guard-scan` (no lifecycle hooks) | Instruction-driven | `node core/cli.mjs ...` |
| **Cursor** | `AGENTS.md` + `.cursor/rules/role-router.mdc` + `.cursor/agents/` + `.cursor/hooks.json` | `postToolUse` hook (advisory — no redaction) | Instruction-driven (`node core/cli.mjs classify`) | `node core/cli.mjs ...` via the `judge` subagent |

[`AGENTS.md`](./AGENTS.md) is the cross-harness protocol source of truth; `CLAUDE.md` and `GEMINI.md` layer harness specifics on top. Hill-climb state persists in `.role-router/state.json` (gitignored), so the refinement budget is sticky on every harness.

## What it does

- **CO as sole entry point** — Users only interact with CO; internal role switching is transparent
- **Task classification** — CO auto-classifies requests (bug fix, feature, docs, security, etc.)
- **Multi-agent dispatch** — CO spawns parallel agent fleets for complex tasks
- **Role switching** — CO internally delegates to Recon (discovery), Medic (diagnosis), Engineer (execution), QA (verification)
- **Judge gate** — Judge runs a two-tier, evidence-based verdict (heuristic + LLM) and must cite concrete evidence before a PASS
- **Hill-climb refinement** — on a `rework` verdict, CO refines and re-verifies in a bounded, code-capped loop; it escalates to the user on budget/plateau instead of spinning
- **Output Guard** — every tool result is scanned for prompt-injection, credential leakage and encoded payloads; credentials are redacted in-place
- **Scribe recording** — Scribe auto-comments on work items + links PRs/branches
- **Model + reasoning per role** — Each role uses optimized model + reasoning effort
- **Safety gates** — Tool usage policies, approval prompts, tripwires prevent risky operations
- **Audit trail** — All decisions and transitions logged for compliance

> **Guard ownership:** Sentry/OPA authorizes tool calls **before** execution (the policy chokepoint). This project's output-guard redacts tool **results** after execution (prompt injection, credential leak). They do not overlap — Sentry does not scan tool output; the output-guard does not call OPA.

## Architecture

```
User Request
    |
CO (sole entry point) — User only talks to CO
    |
[Task Classification]
    |- Dispatcher classifies task type
    |- Generates dispatch plan (agents, parallel/sequential)
    `- Returns confidence score
    |
[Dispatch]
    |- CO spawns agents in parallel/sequential via task() tool
    |- Agents work independently with their own models
    `- Agents report results to CO
    |
[Judge Verification Gate]  (two-tier, evidence-based)
    |- CO invokes judge_verify(originalIntent, workCompleted)
    |- Tier 1: deterministic heuristic verdict (coverage + hard tripwires)
    |- Judge (LLM) inspects real artifacts, then calls judge_finalize(...)
    |- Verdicts merged (anti-gaming floor) -> PASS | PARTIAL | FAIL + accept | review | rework
    |- HILL-CLIMB directive (code-enforced):
    |    CONTINUE_REFINE -> CO routes gaps[] back, re-verifies (threads runId)
    |    STOP_BUDGET / STOP_PLATEAU -> escalate to user (no more looping)
    |    STOP_REVIEW -> surface gaps to user
    `- STOP_ACCEPT -> proceed to recording
    |
[Scribe Recording Gate]
    |- CO invokes scribe_record(workItemId, findings, linkedWork)
    |- Scribe auto-comments on existing work item
    |- Scribe links PRs/branches to tracking item
    `- Decision is now durable and linked
    |
Return to User (with full audit trail)
```

## Roles

| Role | Model (Copilot) | Purpose | Authorization |
|------|-------|---------|-----------------|
| **CO** | Claude Opus 4.8 | Orchestration, classification, delegation | Decision gate: Judge, Scribe |
| **Recon** | Gemini 3.5 Flash | Read-only discovery, evidence gathering | No mutations (safe) |
| **Medic** | Claude Opus 4.8 | Diagnosis, plan generation | Approval gate: `askOnMutations: true` |
| **Engineer** | GPT-5.5 | Implementation, code changes, testing | Approval gate: `askOnMutations: true` |
| **QA** | GPT-5.4 | Independent verification, test execution | Read-only (`denyMutations: true`) |
| **Scribe** | GPT-5.4 | Work item auto-comments, PR/branch linking | Auto-comments (no approval), links PRs |
| **Judge** | Gemini 3.1 Pro | Two-tier evidence-based intent verification (heuristic + LLM, anti-gaming merge) | Read-only; verdict via `judge_verify` + `judge_finalize` |

The canonical registry is [`core/roles.mjs`](./core/roles.mjs). Models are chosen for **vendor diversity**: QA and Judge deliberately do not share a family with Medic/CO. Harnesses that cannot select cross-vendor models (e.g. Claude Code) map roles to their nearest native tier (haiku/sonnet/opus) and rely on separate contexts plus the code-enforced anti-gaming merge for independence.

Shell tools (`bash`, `powershell`, …) are treated as mutating for read-only roles via `SHELL_TOOLS` in [`core/roles.mjs`](./core/roles.mjs).

## Repeatable Actions Library

All repeatable patterns are centralized in the shared core (`core/repeatable-actions.mjs`; the Copilot extension's `src/repeatable-actions.mjs` re-exports it):

- **Scribe**: `autoComment()`, `linkPRAndBranch()`
- **Judge**: `intentHeuristic()`, `parseVerdict()`, `normalizeVerdict()`, `mergeVerdicts()`, `fallbackVerdict()`, `verifyIntent()`, `validatePlan()`
- **Hill-climb**: `hillclimb.computeDirective()`, `hillclimb.runKey()`, `hillclimb.pruneRuns()`
- **Output Guard**: `guardActions.scanOutput()`
- **Engineer**: `pipelineFailureNotifierYaml()` (CI template string — referenced in role prompts)

See [REPEATABLE-ACTIONS.md](./.github/extensions/role-router/REPEATABLE-ACTIONS.md) for full reference.

## Judge verdict pipeline

Judge no longer returns a bare PASS/FAIL from keyword overlap. It runs a two-tier,
confidence-calibrated pipeline (inspired by evidence-grading judge designs):

1. **Tier 1 — heuristic** (`judge_verify`): a deterministic verdict from intent-keyword
   coverage plus **hard tripwires** — objective, non-overridable FAIL signals scanned from
   the work summary (failed tests, broken build, "not implemented", "could not complete",
   uncaught exceptions, "failed to …"). This verdict is stored against a `verificationId`.
2. **Tier 2 — LLM** (`judge_finalize`): the Judge model inspects the *real* artifacts
   (diff, files, test/build output) with read-only tools, then **calls `judge_finalize`**
   with a structured verdict: `verdict` (PASS | PARTIAL | FAIL), `recommendation`
   (accept | review | rework), `confidence` (0–1), `riskLevel`, `reasoning`, and an
   `evidence[]` array of concrete citations.

The two verdicts are then **merged with an anti-gaming policy**:

- The LLM may **worsen** a verdict and **raise** risk, but it **cannot clear a hard tripwire** —
  an objective failure forces FAIL (confidence floored ≥ 0.9).
- A **PASS with no concrete evidence** (a cited file/line, test, diff or commit) is
  **downgraded to PARTIAL** — vague assertions like "looks good" do not qualify.
- The recommendation is **derived deterministically** from verdict + confidence + risk, so it
  never contradicts the verdict.

The merged verdict is persisted to `verdicts.log` and control returns to CO. If Judge ever
stalls without finalizing, the next user turn **auto-recovers** the open verification with a
fallback verdict and returns the session to CO (it is never stranded in read-only Judge mode).

## Hill-climb refinement loop

A `rework` verdict no longer means "CO retries an unbounded number of times at its own
discretion." Every `judge_finalize` returns a **code-enforced directive** that decides whether
the loop continues, stops, or escalates — the round counter lives in `state.json` (keyed by a
stable `runId`), so the refinement budget survives reloads and cannot be reset by re-verifying:

| Directive | When | What CO does |
|---|---|---|
| `CONTINUE_REFINE` | `rework`, budget remains, still improving | Route `gaps[]` back to the owning role, re-verify (passing the same `runId`) |
| `STOP_BUDGET` | `maxRounds` (3) rework cycles reached | **Escalate to the user** with the best candidate + remaining gaps |
| `STOP_PLATEAU` | `maxFlatRounds` (2) consecutive rounds with no improvement | **Escalate to the user** |
| `STOP_REVIEW` | verdict is `review` | Surface gaps to the user before accepting |
| `STOP_ACCEPT` | verdict is `accept` | Proceed to the docs gate, then Scribe |

Design points (all enforced in `hillclimb.computeDirective()`, fully unit-tested):

- **Improvement is concrete:** a round counts as progress only if the gap count shrinks **or**
  confidence rises by ≥ `minConfidenceDelta` (0.05) — never raw confidence drift. Non-finite
  confidence is treated as *unknown* (no spurious "improvement").
- **Plateau needs persistence:** the loop stops only after `maxFlatRounds` **consecutive**
  non-improving rounds, so one noisy flat round does not abort genuine progress.
- **STOP is sticky:** once halted by budget/plateau, the run stays halted; CO cannot restart the
  same loop by re-verifying. A genuinely new task (new `runId`/intent) starts fresh.
- **Docs/Scribe are deferred** until a candidate is `STOP_ACCEPT`-ed, so intermediate candidates
  are never recorded as completed work.
- **Bounded state:** refine runs are pruned by TTL (6 h) and LRU-capped (`pruneRuns()`).

This is the **hill-climb (self-refine)** pattern from the orchestration-patterns investigation,
shipped as Phase 1. Fan-out (best-of-N) and Adversary (red-team) are planned follow-ups.

## Output Guard

Every tool result is scanned (`onPostToolUse` → `guardActions.scanOutput`) for content-level
threats before it reaches the model:

- **Prompt injection** (e.g. "ignore all previous instructions") — flagged high; the model is
  told to treat the tool output as untrusted **data**, not commands.
- **Credential leakage** (AWS keys, tokens, private keys, etc.) — flagged high and **redacted
  in-place** via `modifiedResult`, so the secret never reaches the transcript.
- **Encoded payloads, adversarial URLs, private-IP disclosure** — flagged at medium/low.

Detections are appended to `guard.log`. The guard never blocks the tool pipeline — on any
internal error it fails open and passes the original result through.

## Installation

### Claude Code

No install needed — open this repo in Claude Code. `CLAUDE.md` loads the CO protocol, the six role subagents come from `.claude/agents/`, and `.claude/settings.json` wires the shared Output Guard (`PostToolUse`) and dispatch-plan (`UserPromptSubmit`) hooks (both run via `node`, which must be on PATH).

**Limitations:** Claude Code runs Anthropic models only, so the cross-vendor QA/Judge split degrades to haiku/sonnet/opus tiers; `PostToolUse` hooks cannot rewrite tool output, so leaked credentials are flagged and logged but not redacted in-place.

### Gemini CLI

No install needed — open this repo in Gemini CLI. `GEMINI.md` loads the CO protocol, `.gemini/settings.json` wires the `AfterTool` guard (with real redaction — the hook replaces the tool result with redacted text) and the `BeforeAgent` dispatch plan, and `/judge-gate` + `/roles` project commands come from `.gemini/commands/`.

**Limitations:** no per-role subagent registry — CO adopts each role's protocol sequentially per `AGENTS.md`.

### Google Antigravity

No install needed — Antigravity reads `AGENTS.md`/`GEMINI.md` natively, plus workspace rules in `.agent/rules/` and the `/judge-gate` workflow in `.agent/workflows/`.

**Limitations:** Antigravity does not execute Gemini CLI hooks, so the Output Guard is manual (`node core/cli.mjs guard-scan`); judge/hill-climb still run code-enforced via `core/cli.mjs`.

### Cursor

No install needed — Cursor reads `AGENTS.md` and the always-on rule `.cursor/rules/role-router.mdc`; role subagents come from `.cursor/agents/` and the `postToolUse` Output Guard from `.cursor/hooks.json`. This is deliberately an in-repo integration (rules + agents + hooks committed with the project) rather than a `~/.cursor/plugins` plugin, so the protocol versions with the repo; publish a plugin later if you want cross-repo reuse.

**Limitations:** `postToolUse` hooks cannot rewrite non-MCP tool output, so credential redaction is advisory (flag + instruction not to repeat).

### GitHub Copilot CLI — this repository (repo-scoped extension)

If you're working in this repo, the extension is pre-configured as a project extension at `/.github/extensions/role-router/extension.mjs`. It loads automatically when you work in a Copilot session tied to this repo.

**No additional install needed** — just start a session and use the role commands:
```bash
role_set co          # Switch to CO (architecture) role
role_current         # Inspect active role + model
role_list            # Enumerate all available roles
role_history 10      # View recent role transitions
```

### GitHub Copilot CLI — other repos (global user install)

To install this extension globally, ask Copilot (or use the `install_extension` tool) with the repo URL:

```
Install the role-router extension from https://github.com/v-leorichard_microsoft/copilot-role-router
```

Or use `/extensions manage` in the Copilot CLI to open the extensions manager.

After install, use the same role commands in any session.

## Updating

### If installed globally (user install)

**Option 1 — Ask Copilot to reinstall (recommended):**

```
Reinstall the role-router extension from https://github.com/v-leorichard_microsoft/copilot-role-router
```

Copilot runs `install_extension`, which overwrites your existing install with the latest `extension.mjs`.

**Option 2 — Via the extensions manager:**

Type `/extensions manage` in the Copilot CLI to open the extensions manager UI.

**Option 3 — Manual pull + copy:**

```bash
cd <path-to-cloned-repo>
git pull origin main
cp .github/extensions/role-router/extension.mjs ~/.copilot/extensions/role-router/
```

After any option, ask Copilot to run `extensions_reload`.

### If installed as a repo-scoped extension (this repo)

The built `extension.mjs` is committed to the repo. Just pull:

```bash
git pull origin main
```

The extension reloads automatically on the next session start, or run `extensions_reload` immediately.

### Verify your version

After reloading, run `role_current`. The active role output includes the build version (e.g. `v1.2.0`).

## Build

The extension is bundled with [Bun](https://bun.sh).

**Install Bun (Windows):**
```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

Bun installs to `%USERPROFILE%\.bun\bin` and is **not** added to `PATH` automatically. If `npm run build` fails with `spawn bun.exe ENOENT`, add it for the current session:
```powershell
$env:PATH += ";$env:USERPROFILE\.bun\bin"
```

**Scripts:**
```bash
npm run build     # bundles src/ -> extension.mjs (bakes version from package.json)
npm run dev       # watch mode: rebuilds extension.mjs on every src/ change
npm run bump      # bump the semantic version (see VERSIONING.md)
npm run release   # build + commit + tag vX.Y.Z + push (triggers GitHub Actions)
```

Docs-only and CI-only changes do not bump the version or trigger a release. See [VERSIONING.md](./VERSIONING.md).

## Extension location

Repo-local extension entrypoint:

`/.github/extensions/role-router/extension.mjs`
