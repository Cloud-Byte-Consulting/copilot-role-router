// Agent dispatcher: smart agent routing for the CO role
// Analyzes user requests, classifies task type, spawns parallel agents

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(__dirname, "agent-dispatch-config.json");

// Load dispatch config
function loadConfig() {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    } catch (e) {
        console.error(`[dispatcher] Failed to load config: ${e.message}`);
        return { taskTypes: {}, defaults: { fallbackAgents: ["recon"] } };
    }
}

const config = loadConfig();

/**
 * Classify the user's request into a task type.
 * Returns { taskType, confidence, description, agents }
 */
export function classifyTask(userMessage) {
    const msg = userMessage.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const [taskType, taskConfig] of Object.entries(config.taskTypes ?? {})) {
        let score = 0;
        const keywords = taskConfig.keywords ?? [];

        // Keyword matching
        for (const kw of keywords) {
            if (msg.includes(kw.toLowerCase())) {
                score += 1;
            }
        }

        // Normalize by keyword count (rough confidence estimate)
        const confidence = keywords.length > 0 ? score / keywords.length : 0;

        if (confidence > bestScore) {
            bestScore = confidence;
            bestMatch = { taskType, confidence, taskConfig };
        }
    }

    const threshold = config.defaults?.confidenceThreshold ?? 0.6;
    if (bestMatch && bestScore >= threshold) {
        return {
            taskType: bestMatch.taskType,
            confidence: bestScore,
            description: bestMatch.taskConfig.description,
            agents: bestMatch.taskConfig.agents,
            instructions: bestMatch.taskConfig.instructions,
            parallel: bestMatch.taskConfig.parallel ?? true,
        };
    }

    // Fallback
    return {
        taskType: "unknown",
        confidence: 0,
        description: config.defaults?.fallbackDescription ?? "Generic task",
        agents: config.defaults?.fallbackAgents ?? ["recon"],
        instructions: "Recon will investigate and report findings.",
        parallel: false,
    };
}

/**
 * Build agent dispatch plan based on task classification.
 * Returns { taskType, agents, parallel, summary }
 */
export function buildDispatchPlan(classification) {
    return {
        taskType: classification.taskType,
        confidence: classification.confidence,
        description: classification.description,
        agents: classification.agents,
        parallel: classification.parallel,
        summary:
            `Classified as: ${classification.taskType} (confidence: ${(classification.confidence * 100).toFixed(0)}%)\n` +
            `Dispatching agents: ${classification.agents.join(", ")}\n` +
            `Mode: ${classification.parallel ? "parallel" : "sequential"}\n` +
            `Instructions: ${classification.instructions}`,
    };
}

/**
 * Format dispatch plan for CO's additional context.
 */
export function formatDispatchContext(plan) {
    return (
        `[agent-dispatcher] Task classified as: ${plan.taskType}\n` +
        `[agent-dispatcher] Confidence: ${(plan.confidence * 100).toFixed(0)}%\n` +
        `[agent-dispatcher] Dispatching agents: ${plan.agents.join(", ")}\n` +
        `[agent-dispatcher] Mode: ${plan.parallel ? "PARALLEL" : "SEQUENTIAL"}\n` +
        `[agent-dispatcher] Instructions: ${plan.description}\n` +
        `---\n` +
        `CO: You may use this plan to coordinate sub-agents. Call tools like task() to spawn agents in parallel.\n` +
        `For example: task("explore", "your prompt") launches an agent in the background.`
    );
}

export default { classifyTask, buildDispatchPlan, formatDispatchContext };
