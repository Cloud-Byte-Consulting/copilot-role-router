#!/usr/bin/env node
// role-router core CLI — the portable execution surface for harnesses that
// cannot register programmatic tools (Claude Code, Gemini CLI / Antigravity,
// Cursor). It runs the SAME judge / hill-climb / guard / dispatcher code the
// Copilot extension uses, with state persisted under .role-router/ in the
// project root, so the refinement budget is code-enforced on every harness.
//
// Commands:
//   classify <message...>                      Print the dispatch plan for a user request.
//   judge-open --intent <s> --work <s>         Open a verification: prints the Tier-1
//              [--run-id <id>]                 heuristic verdict + a verificationId.
//   judge-finalize --id <verificationId>       Merge the Judge's structured verdict
//              [--json <json>]  (or stdin)     (anti-gaming floor) + print the
//                                              code-enforced hill-climb directive.
//   guard-scan                       (stdin)   Scan text for injection/credentials;
//                                              prints JSON {riskLevel, flags, redactedText...}.
//   roles                                      List the canonical role registry.
//
// Exit codes: 0 = success; 1 = usage/state error.

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import {
    judgeActions,
    guardActions,
    parseVerdict,
    mergeVerdicts,
    fallbackVerdict,
    normalizeVerdict,
    hillclimb,
} from "./repeatable-actions.mjs";
import { classifyTask, buildDispatchPlan, formatDispatchContext } from "./agent-dispatcher.mjs";
import { ROLES } from "./roles.mjs";

const STATE_DIR = process.env.ROLE_ROUTER_STATE_DIR ?? path.join(process.cwd(), ".role-router");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const VERDICT_LOG = path.join(STATE_DIR, "verdicts.log");

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return { pendingVerdicts: {}, refineRuns: {} };
    }
}

function saveState(state) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendVerdictLog(record) {
    try {
        fs.mkdirSync(STATE_DIR, { recursive: true });
        fs.appendFileSync(VERDICT_LOG, JSON.stringify(record) + "\n");
    } catch { /* non-fatal */ }
}

function readStdin() {
    try {
        return fs.readFileSync(0, "utf8");
    } catch {
        return "";
    }
}

function fail(msg) {
    process.stderr.write(`${msg}\n`);
    process.exit(1);
}

// ---------------------------------------------------------------------------

function cmdClassify(args) {
    const message = args.join(" ").trim();
    if (!message) fail("Usage: cli.mjs classify <user message>");
    const classification = classifyTask(message);
    const plan = buildDispatchPlan(classification);
    process.stdout.write(formatDispatchContext(plan) + "\n");
}

async function cmdJudgeOpen(args) {
    const { values } = parseArgs({
        args,
        options: {
            intent: { type: "string" },
            work: { type: "string" },
            "run-id": { type: "string" },
        },
    });
    const { intent, work } = values;
    if (!intent || !work) fail('Usage: cli.mjs judge-open --intent "<original intent>" --work "<work completed>" [--run-id <id>]');

    const heuristic = await judgeActions.verifyIntent(intent, work);
    const runId = values["run-id"]?.trim() || hillclimb.runKey(intent);
    const verificationId = `v-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const state = loadState();
    state.pendingVerdicts = state.pendingVerdicts ?? {};
    state.pendingVerdicts[verificationId] = {
        verificationId,
        originalIntent: intent,
        workCompleted: work,
        heuristic,
        runId,
        openedAt: Date.now(),
    };
    const ids = Object.keys(state.pendingVerdicts);
    if (ids.length > 50) delete state.pendingVerdicts[ids.sort()[0]];
    saveState(state);

    const out = [
        `[JUDGE VERIFICATION GATE]  verificationId: ${verificationId}  runId: ${runId}`,
        `Original User Intent: ${intent}`,
        `Work Completed (claim): ${work}`,
        ``,
        `Tier-1 heuristic (preliminary — confirm or override with live evidence):`,
        `- intentSummary: ${heuristic.intentSummary}`,
        `- verdict: ${heuristic.verdict}  recommendation: ${heuristic.recommendation}`,
        `- confidence: ${(heuristic.confidence * 100).toFixed(0)}%  risk: ${heuristic.riskLevel}`,
        heuristic.hardTripwires.length
            ? `- HARD TRIPWIRES (non-overridable FAIL floor): ${heuristic.hardTripwires.join(", ")}`
            : `- hard tripwires: none`,
        heuristic.gaps.length ? `- candidate gaps: ${heuristic.gaps.join(", ")}` : "",
        ``,
        `Judge: INSPECT the real artifacts (diff/files/test output) with read-only tools, then finalize:`,
        `  node core/cli.mjs judge-finalize --id ${verificationId} --json "<structured verdict JSON>"`,
        `Structured verdict fields: { "verdict": "PASS|PARTIAL|FAIL", "recommendation": "accept|review|rework",`,
        `  "confidence": 0-1, "riskLevel": "none|low|medium|high|critical", "reasoning": "...",`,
        `  "evidence": ["file:line ...", ...], "gaps": [...], "intentSummary": "...",`,
        `  "docsAction": "none|update|create|ask_user", "suggestedFiles": [...], "suggestedSection": "...",`,
        `  "proposedFile": "...", "askQuestion": "..." }`,
        `A PASS with no concrete evidence (file/line/test/diff/commit) is auto-downgraded to PARTIAL.`,
    ].filter(Boolean).join("\n");
    process.stdout.write(out + "\n");
}

function cmdJudgeFinalize(args) {
    const { values } = parseArgs({
        args,
        options: {
            id: { type: "string" },
            json: { type: "string" },
        },
    });
    const verificationId = values.id;
    if (!verificationId) fail("Usage: cli.mjs judge-finalize --id <verificationId> [--json <verdict json>]  (or pipe JSON on stdin)");

    const state = loadState();
    const pending = state.pendingVerdicts?.[verificationId];
    if (!pending) {
        fail(
            `No open verification with id "${verificationId}". ` +
            `It may have already been finalized, or judge-open was never run. ` +
            `Open verifications: ${Object.keys(state.pendingVerdicts ?? {}).join(", ") || "(none)"}`,
        );
    }

    const raw = values.json ?? readStdin();
    let llm = raw ? parseVerdict(raw, "llm") : null;
    if (!llm) llm = fallbackVerdict(pending.heuristic, "Judge supplied no parseable verdict");
    const final = mergeVerdicts(pending.heuristic, llm);

    // Hill-climb loop control — identical semantics to the Copilot extension.
    const rkey = pending.runId ?? hillclimb.runKey(pending.originalIntent);
    const prevRun = state.refineRuns?.[rkey] ?? null;
    const loop = hillclimb.computeDirective({ prevRun, verdict: final });
    state.refineRuns = state.refineRuns ?? {};
    if (loop.nextRun) state.refineRuns[rkey] = loop.nextRun;
    else delete state.refineRuns[rkey];
    state.refineRuns = hillclimb.pruneRuns(state.refineRuns);
    const accepted = loop.directive === "STOP_ACCEPT";

    // Docs guidance: prefer the Judge's explicit call, fall back to the heuristic.
    const fields = raw ? (() => { try { return JSON.parse(raw); } catch { return {}; } })() : {};
    const docs = {
        docsAction: fields.docsAction ?? pending.heuristic.docsAction ?? "none",
        docsReason: fields.docsReason ?? pending.heuristic.docsReason ?? "",
        suggestedFiles: fields.suggestedFiles ?? pending.heuristic.suggestedFiles ?? [],
        suggestedSection: fields.suggestedSection ?? pending.heuristic.suggestedSection ?? null,
        proposedFile: fields.proposedFile ?? pending.heuristic.proposedFile ?? null,
        askQuestion: fields.askQuestion ?? pending.heuristic.askQuestion ?? null,
    };

    appendVerdictLog({
        verificationId,
        originalIntent: pending.originalIntent,
        final,
        docs,
        closedAt: Date.now(),
    });
    delete state.pendingVerdicts[verificationId];
    saveState(state);

    const loopLine = (() => {
        switch (loop.directive) {
            case "CONTINUE_REFINE":
                return `HILL-CLIMB ${loop.directive} (round ${loop.round}/${hillclimb.HILLCLIMB_DEFAULTS.maxRounds}): ${loop.reason}\n` +
                    `  → Route these gaps to the owning role to refine, then run judge-open AGAIN with --run-id ${rkey} (and the same original intent).\n` +
                    `  → Do NOT accept, and do NOT run docs/Scribe yet.`;
            case "STOP_BUDGET":
            case "STOP_PLATEAU":
                return `HILL-CLIMB ${loop.directive}: ${loop.reason}\n` +
                    `  → STOP refining. Present the best candidate so far + remaining gaps to the USER and ask how to proceed (human escalation).\n` +
                    `  → Do NOT run docs/Scribe.`;
            case "STOP_REVIEW":
                return `HILL-CLIMB ${loop.directive}: ${loop.reason}\n` +
                    `  → Surface the gaps to the USER before accepting. Do NOT run docs/Scribe.`;
            default: // STOP_ACCEPT
                return `HILL-CLIMB ${loop.directive}: ${loop.reason} → proceed to the docs gate, then Scribe.`;
        }
    })();

    const out = [
        `[JUDGE VERDICT — ${verificationId}]`,
        `verdict: ${final.verdict}  |  recommendation: ${final.recommendation}  |  confidence: ${(final.confidence * 100).toFixed(0)}%  |  risk: ${final.riskLevel}`,
        `intentSummary: ${final.intentSummary}`,
        `reasoning: ${final.reasoning}`,
        final.evidence.length ? `evidence:\n- ${final.evidence.join("\n- ")}` : `evidence: (none cited)`,
        final.gaps.length ? `gaps: ${final.gaps.join(", ")}` : "",
        final.hardTripwires.length ? `hardTripwires (forced FAIL floor): ${final.hardTripwires.join(", ")}` : "",
        final.llmRecommendation && final.llmRecommendation !== final.recommendation
            ? `note: Judge suggested "${final.llmRecommendation}" but merged policy yields "${final.recommendation}".`
            : "",
        ``,
        loopLine,
        ``,
        accepted
            ? `docsAction: ${docs.docsAction}${docs.docsReason ? ` — ${docs.docsReason}` : ""}`
            : `docs/Scribe: DEFERRED until a candidate is accepted.`,
        accepted && docs.docsAction === "update" && docs.suggestedFiles.length ? `  files: ${docs.suggestedFiles.join(", ")}${docs.suggestedSection ? ` / ${docs.suggestedSection}` : ""}` : "",
        accepted && docs.docsAction === "create" && docs.proposedFile ? `  proposed: ${docs.proposedFile}` : "",
        accepted && docs.docsAction === "ask_user" && docs.askQuestion ? `  ask: ${docs.askQuestion}` : "",
        ``,
        `Control returned to CO.`,
    ].filter(Boolean).join("\n");
    process.stdout.write(out + "\n");
}

function cmdGuardScan() {
    const text = readStdin();
    const scan = guardActions.scanOutput(text, { redact: true });
    process.stdout.write(JSON.stringify(scan, null, 2) + "\n");
}

function cmdRoles() {
    const out = Object.entries(ROLES)
        .map(([k, v]) => `${k.padEnd(9)}  ${v.model.padEnd(28)}  reasoning=${v.reasoningEffort}  policy=${JSON.stringify(v.toolPolicy)}`)
        .join("\n");
    process.stdout.write(out + "\n");
}

// ---------------------------------------------------------------------------

const [, , command, ...rest] = process.argv;
switch (command) {
    case "classify":
        cmdClassify(rest);
        break;
    case "judge-open":
        await cmdJudgeOpen(rest);
        break;
    case "judge-finalize":
        cmdJudgeFinalize(rest);
        break;
    case "guard-scan":
        cmdGuardScan();
        break;
    case "roles":
        cmdRoles();
        break;
    default:
        fail(
            "role-router core CLI\n" +
            "Usage: node core/cli.mjs <command>\n" +
            "Commands: classify | judge-open | judge-finalize | guard-scan | roles",
        );
}
