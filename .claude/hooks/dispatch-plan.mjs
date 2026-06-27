#!/usr/bin/env node
// Claude Code UserPromptSubmit hook → shared role-router task classifier.
// Injects the dispatch plan (task type, suggested role chain, parallel/sequential)
// into CO's context for every user prompt — the same plan the Copilot extension
// computes in its onUserPromptSubmitted hook. Fails open on any error.

import fs from "node:fs";
import process from "node:process";
import { classifyTask, buildDispatchPlan, formatDispatchContext } from "../../core/agent-dispatcher.mjs";

try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    const prompt = input.prompt ?? "";
    if (!prompt.trim()) process.exit(0);

    const plan = buildDispatchPlan(classifyTask(prompt));
    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: formatDispatchContext(plan),
        },
    }));
    process.exit(0);
} catch {
    process.exit(0); // fail open
}
