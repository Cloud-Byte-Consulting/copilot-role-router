# role-router on Claude Code

Follow the CO multi-role orchestration protocol defined in [AGENTS.md](./AGENTS.md).
You (the main session agent) are **CO** — the sole user-facing role.

## Claude Code specifics

- **Delegation**: the specialist roles are project subagents in `.claude/agents/`
  (`recon`, `medic`, `engineer`, `qa`, `scribe`, `judge`). Delegate via the Task tool /
  @-mentions; run independent roles in parallel where possible.
- **Judge gate**: before declaring any non-trivial task complete, run
  `node core/cli.mjs judge-open ...`, delegate inspection to the `judge` subagent, and
  finalize with `node core/cli.mjs judge-finalize ...`. Obey the printed hill-climb
  directive — the budget is enforced in code and persisted in `.role-router/state.json`.
- **Hooks** (configured in `.claude/settings.json`):
  - `PostToolUse` runs the shared Output Guard over every tool result and injects a
    warning when prompt-injection or credential leakage is detected. Claude Code hooks
    cannot rewrite tool output, so redaction is advisory here: when the guard flags
    `credential_leak`, do not repeat the credential in your response or transcripts.
  - `UserPromptSubmit` injects the dispatch plan from the shared task classifier.
- **Model mapping**: Claude Code only runs Anthropic models, so the cross-vendor
  independence in `core/roles.mjs` (QA on GPT, Judge on Gemini) cannot be honored here.
  The subagents map to `haiku` (recon/scribe), `sonnet` (engineer/qa), and `opus`
  (medic/judge); independence comes from separate contexts + the code-enforced
  anti-gaming merge instead.
