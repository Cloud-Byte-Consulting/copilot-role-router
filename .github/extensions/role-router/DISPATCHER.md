# Agent Dispatcher System

The **Agent Dispatcher** is an intelligent task-routing layer for the CO (Commanding Officer) role. It automatically classifies incoming requests and generates dispatch plans to coordinate multi-agent fleets. All dispatch operations use repeatable actions from `repeatable-actions.mjs`.

## How It Works

```
User Request (to CO only)
    ↓
Agent Dispatcher.classifyTask(userInput)
    ├─ Keyword matching: "crash", "dashboard", "events"
    ├─ Task type: "bug_fix" (confidence: 85%)
    └─ Returns: { taskType, confidence, agents, parallel, instructions }
    ↓
CO receives dispatch plan
    ↓
CO spawns agents in parallel using task() tool
    ├─ recon: evidence gathering
    ├─ medic: diagnosis + planning
    └─ qa: test preparation
    ↓
Agents work concurrently, report findings to CO
    ↓
CO synthesizes results
    ↓
Judge verifies intent fulfilled (judge_verify gate)
    ↓
Scribe auto-comments on work item + links PRs (scribe_record gate)
    ↓
User gets coordinated response with audit trail
```

## Task Types

The dispatcher recognizes 10 task types out of the box:

| Task Type | Agents | Mode | Use When |
|-----------|--------|------|----------|
| `bug_fix` | recon, medic, qa | parallel | Fixing bugs, errors, crashes |
| `feature_implementation` | recon, engineer, qa | parallel | Building new features |
| `documentation` | scribe | sequential | Writing docs, READMEs, guides |
| `code_review` | code-review | sequential | Auditing code changes |
| `research` | recon | sequential | Investigating topics |
| `performance` | recon, medic, qa | parallel | Optimizing performance |
| `security` | recon, medic, qa | parallel | Finding/fixing vulns (escalate to CO before deploy) |
| `deployment` | qa, judge | sequential | Deploying to prod (requires CO approval) |
| `testing` | engineer, qa | parallel | Writing/verifying tests |
| `refactoring` | recon, engineer, qa | parallel | Code cleanup & restructuring |

## Configuration

The dispatcher uses `agent-dispatch-config.json` to define task types and agent assignments.

### Adding a New Task Type

```json
{
  "taskTypes": {
    "my_task": {
      "description": "Brief description of the task",
      "keywords": ["keyword1", "keyword2", "related"],
      "agents": ["agent1", "agent2"],
      "parallel": true,
      "instructions": "How agents should work together"
    }
  }
}
```

### Config Fields

- **`description`** — Human-readable task summary
- **`keywords`** — List of keywords that trigger this task type (case-insensitive)
- **`agents`** — List of agent roles to dispatch (e.g., `["recon", "engineer", "qa"]`)
- **`parallel`** — `true` if agents work concurrently, `false` for sequential
- **`instructions`** — Coordination guidance for CO

## Usage

### As a User

Start with CO as your entry point:

```
/extension install https://github.com/v-leorichard_microsoft/copilot-role-router

role_set co
```

Then submit your request. CO will:
1. Classify the task type
2. Show you the dispatch plan
3. Spawn appropriate agents
4. Integrate results

### As a Developer (Extending Dispatcher)

1. **Edit `agent-dispatch-config.json`** to add/modify task types
2. **Restart the extension**: `/extension reload` or open a fresh session
3. **Test classification**: Submit a request matching your new keywords

The dispatcher uses **keyword matching** to classify tasks. It calculates confidence as:

```
confidence = (keywords_matched / total_keywords) * 100
```

Confidence must exceed the threshold (default: 60%) to match.

## Dispatch Logs

The dispatcher logs all dispatch decisions to `dispatch.log`:

```
2025-01-15T10:30:42.123Z Task: bug_fix (conf: 85%) | Agents: recon, medic, qa | Mode: PARALLEL
2025-01-15T10:30:45.456Z Task: documentation (conf: 90%) | Agents: scribe | Mode: SEQUENTIAL
```

## Integration with Repeatable Actions

The dispatcher output feeds directly into repeatable actions:

```javascript
// In extension.mjs onUserPromptSubmitted hook:
const dispatch = buildDispatchPlan(classification);

// CO formats dispatch context using repeatable action
const dispatchContext = await coActions.formatDispatchContext(dispatch);

// CO injects formatted context as additionalContext for agent
return {
  additionalContext: dispatchContext,
};
```

Each agent then has structured context for decision-making. See [REPEATABLE-ACTIONS.md](./REPEATABLE-ACTIONS.md) for how other roles (Judge, Scribe, Medic) use their repeatable patterns.

## Example: Bug Fix Flow

**User**: "The token dashboard crashes when opening with >10k events. Fix it."

**Dispatcher**: Classifies as `bug_fix` (confidence: 92%)
```
Dispatch Plan:
  Task: bug_fix
  Agents: recon, medic, qa (parallel)
  Mode: PARALLEL
```

**CO**: Spawns three agents in parallel
```
task("explore", "Investigate token dashboard crashes with large datasets...")
task("task", "Run diagnostics on event handling...")
task("code-review", "Audit dashboard event processing code...")
```

**Agents**: Work concurrently
- Recon: Finds issue in pagination logic
- Medic: Proposes caching + lazy loading fix
- QA: Begins test prep

**CO**: Integrates findings
```
Root cause: O(n) event iteration on render
Fix: Implement windowed list (recon + medic findings)
QA will verify performance with 100k events
→ Ready for Engineer implementation
```

**Flow**: CO → Recon/Medic/QA (parallel) → CO (synthesis) → Engineer (implementation) → QA (verification)

## Confidence Threshold

Default confidence threshold is **60%**. Adjust in `agent-dispatch-config.json`:

```json
"defaults": {
  "confidenceThreshold": 0.75
}
```

Higher = stricter matching; requests below threshold fall back to `fallbackAgents` (default: `["recon"]`).

## Future Extensions

Possible enhancements:

- **Cost-aware dispatch** — Route expensive tasks to cheaper models when confidence is low
- **Priority routing** — Escalate security/deployment tasks to high-reasoning models (Claude Opus)
- **Sub-task decomposition** — Break complex tasks into multiple dispatch rounds
- **Learning feedback loop** — Track which agent combinations produce best results for each task type
- **Observability** — Dashboard showing dispatch patterns, agent utilization, success rates

