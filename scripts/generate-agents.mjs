#!/usr/bin/env node
/**
 * Generate harness agent definitions from core/roles.mjs (canonical source).
 * Usage: node scripts/generate-agents.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROLES } from "../core/roles.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const CLAUDE_TOOLS = {
    co: "Read, Grep, Glob, Bash, Task",
    recon: "Read, Grep, Glob",
    medic: "Read, Grep, Glob, Bash",
    engineer: "Read, Grep, Glob, Bash, Edit, Write",
    scribe: "Read, Grep, Glob, Bash",
    qa: "Read, Grep, Glob",
    judge: "Read, Grep, Glob",
};

const DESCRIPTIONS = {
    co: "Commanding Officer — sole user-facing orchestrator. Classifies, delegates, gates, synthesizes.",
    recon: "Pure read-only discovery and evidence gathering. Never mutates.",
    medic: "Diagnosis and remediation planning. No mutations until user approves the plan.",
    engineer: "Deterministic implementation with tests. Defensive code, minimal scope.",
    scribe: "Work-item comments, PR linking, docs updates. Never creates issues without approval.",
    qa: "Independent verification — re-derives checks from success criteria. Read-only.",
    judge: "Two-tier evidence-based intent verification. Read-only inspection.",
};

function claudeAgent(name, role) {
    const lines = [
        "---",
        `name: ${name}`,
        `description: >-`,
        `  ${DESCRIPTIONS[name]}`,
        `tools: ${CLAUDE_TOOLS[name]}`,
        `model: ${name === "recon" || name === "judge" ? "haiku" : name === "engineer" || name === "qa" || name === "scribe" ? "sonnet" : "opus"}`,
        "---",
        "",
        role.prompt,
    ];
    if (name === "recon") {
        lines.push("", "- You are read-only: never edit files, run mutating commands, or create branches/PRs.");
    }
    return lines.join("\n") + "\n";
}

function cursorAgent(name, role) {
    return [
        "---",
        `name: ${name}`,
        `description: >-`,
        `  ${DESCRIPTIONS[name]}`,
        "---",
        "",
        role.prompt,
        name === "recon" ? "\n- You are read-only: never edit files, run mutating commands, or create branches/PRs." : "",
    ].filter(Boolean).join("\n") + "\n";
}

for (const [name, role] of Object.entries(ROLES)) {
    const claudeDir = join(ROOT, ".claude", "agents");
    const cursorDir = join(ROOT, ".cursor", "agents");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(join(claudeDir, `${name}.md`), claudeAgent(name, role));
    writeFileSync(join(cursorDir, `${name}.md`), cursorAgent(name, role));
}

console.log(`Generated ${Object.keys(ROLES).length} agents × 2 harnesses from core/roles.mjs`);
