# Repeatable Actions Library

The **Repeatable Actions Library** (`repeatable-actions.mjs`) provides reusable patterns for common operations across all 7 roles. This library enforces consistency, reduces code duplication, and makes the role system testable and maintainable.

## Overview

Each role has a set of standard operations that can be invoked as methods. These methods return structured data ready for agent injection or further processing.

```
repeatable-actions.mjs exports:
├── scribeActions (work item operations)
├── judgeActions (decision verification)
├── medicActions (diagnosis & planning)
├── engineerActions (execution & testing)
├── qaActions (verification & testing)
├── reconActions (evidence gathering)
└── coActions (orchestration)
```

## Role Actions

### Scribe Actions

**Scribe** handles work item operations: auto-commenting and linking PRs/branches to existing work items.

#### `autoComment(workItemId, taskType, data)`

Add an auto-comment to a GitHub issue or ADO work item.

**Parameters:**
- `workItemId` (string) — GitHub issue number (`#123`) or ADO work item ID
- `taskType` (string) — Task classification (`bug_fix`, `feature`, etc.)
- `data` (object) — `{ summary, findings, evidence?, nextSteps? }`

**Returns:**
```javascript
{
  success: true,
  message: "Comment added to work item #42",
  commentId: "comment-1706884200000",
  workItemUrl: "https://github.com/issues/42",
  commentBody: "## Auto-Comment: bug_fix\n..." // formatted markdown
}
```

**Example:**
```javascript
const result = await scribeActions.autoComment("#42", "bug_fix", {
  summary: "Fixed O(n) pagination bug in token dashboard",
  findings: "Pagination was iterating full event list on every render",
  evidence: "Profile shows 95% CPU time in pagination loop",
  nextSteps: "Monitor dashboard performance with 100k events",
});
```

#### `linkPRAndBranch(workItemId, linkedWork)`

Link a PR and branch to a work item.

**Parameters:**
- `workItemId` (string) — Work item identifier
- `linkedWork` (object) — `{ prNumber?, branch?, commit?, description? }`

**Returns:**
```javascript
{
  success: true,
  message: "Linked PR/branch to work item #42",
  linkedItems: ["- **PR:** #123", "- **Branch:** `fix/pagination`", "- **Commit:** `abc1234`"],
  linkComment: "## Work Linked to #42\n..." // formatted markdown
}
```

**Example:**
```javascript
const result = await scribeActions.linkPRAndBranch("#42", {
  prNumber: "123",
  branch: "fix/pagination",
  commit: "abc1234567890def",
  description: "Windowed list + memoization",
});
```

### Judge Actions

**Judge** handles decision verification: validating user intent and execution plans.

#### `verifyIntent(originalIntent, workCompleted)`

Verify that completed work fulfills the original user intent.

**Parameters:**
- `originalIntent` (string) — User's original request
- `workCompleted` (string) — Summary of work delivered

**Returns:**
```javascript
{
  verdict: "PASS" | "FAIL",
  reasoning: "Intent coverage: 92%",
  gaps: [], // keywords from intent not found in work
  confidence: 0.92 // 0–1 scale
}
```

**Example:**
```javascript
const result = await judgeActions.verifyIntent(
  "Fix the dashboard crash when loading 10k events",
  "Implemented windowed list for pagination, tested with 100k events, 60fps stable"
);
// Returns: { verdict: "PASS", reasoning: "Intent coverage: 95%", gaps: [], confidence: 0.95 }
```

#### `validatePlan(plan)`

Validate a remediation plan has all required fields.

**Parameters:**
- `plan` (array) — Array of `{ action, expectedOutcome, rollback, criteria }`

**Returns:**
```javascript
{
  valid: true | false,
  issues: [], // error messages for missing fields
  stepCount: 3
}
```

**Example:**
```javascript
const result = await judgeActions.validatePlan([
  {
    action: "Increase timeout threshold by 50%",
    expectedOutcome: "Requests no longer timeout",
    rollback: "Revert timeout to original",
    criteria: "No timeout errors in 5 minutes",
  },
  {
    action: "Optimize slow queries",
    expectedOutcome: "Query response improves",
    rollback: "Revert to original queries",
    criteria: "Query time < 500ms for p95",
  },
]);
// Returns: { valid: true, issues: [], stepCount: 2 }
```

### Medic Actions

**Medic** handles diagnosis and planning: generating diagnostic reports and remediation plans.

#### `diagnose(evidence)`

Generate a diagnostic report from evidence.

**Parameters:**
- `evidence` (object) — `{ logs?, metrics?, errors?, symptoms? }`

**Returns:**
```javascript
{
  diagnosis: "Timeout/resource exhaustion",
  likelihood: 0.6, // 0–1 scale
  rootCauses: ["Timeout pattern detected", "Performance degradation"],
  recommendations: [
    "Collect stack traces and error logs",
    "Check resource utilization (CPU, memory, network)",
    "Review recent deployments",
    "Trace request flow through services",
  ]
}
```

**Example:**
```javascript
const result = await medicActions.diagnose({
  errors: ["Request timeout", "Request timeout", "OutOfMemory"],
  metrics: { degradation: true },
  logs: ["timeout on event loop", "timeout on query"],
  symptoms: ["Dashboard freezes", "High CPU"],
});
```

#### `createRemediationPlan(diagnosis)`

Create a step-by-step remediation plan.

**Parameters:**
- `diagnosis` (string) — Root cause diagnosis

**Returns:**
```javascript
[
  {
    action: "...",
    expectedOutcome: "...",
    rollback: "...",
    criteria: "..."
  },
  // ... more steps
]
```

**Example:**
```javascript
const plan = await medicActions.createRemediationPlan("timeout");
// Returns array of steps tailored to timeout issues
```

### Engineer Actions

**Engineer** handles execution: generating scripts and logging test results.

#### `generateExecutionScript(plan)`

Generate a Bash/PowerShell script from a remediation plan.

**Parameters:**
- `plan` (array) — Array of steps from Medic

**Returns:**
```javascript
"#!/bin/bash\nset -euo pipefail\n\n# Step 1: ...\necho \"Executing step 1...\"\n..."
```

#### `logTestResult(result)`

Log a test execution result for audit trail.

**Parameters:**
- `result` (object) — `{ testName, passed, duration, output? }`

**Returns:**
```javascript
{
  timestamp: "2025-01-15T10:30:42.123Z",
  test: "test_pagination_performance",
  status: "PASS",
  duration: "245ms",
  output: "(first 200 chars of output)"
}
```

### QA Actions

**QA** handles verification: generating test plans and recording results.

#### `generateTestPlan(taskType, description)`

Generate a test plan for a feature or fix.

**Parameters:**
- `taskType` (string) — `"bug_fix"`, `"feature"`, etc.
- `description` (string) — What was changed

**Returns:**
```javascript
[
  { name: "Happy path", scenario: "...", description: "...", automated: true, criticalPath: true },
  { name: "Error handling", scenario: "...", description: "...", automated: true, criticalPath: false },
  // ... more test cases
]
```

#### `recordTestResult(result)`

Record a test execution result.

**Parameters:**
- `result` (object) — `{ testName, passed, evidence? }`

**Returns:**
```javascript
{
  timestamp: "2025-01-15T10:30:42.123Z",
  test: "test_pagination_performance",
  passed: true,
  evidence: "See logs"
}
```

### Recon Actions

**Recon** handles investigation: planning evidence gathering and summarizing findings.

#### `planEvidenceGathering(sources)`

Plan evidence collection from multiple sources.

**Parameters:**
- `sources` (array) — `["logs", "metrics", "traces", "code", ...]`

**Returns:**
```javascript
{
  plan: [
    { source: "logs", query: "tail -n 1000 app.log | grep ERROR", format: "text" },
    { source: "metrics", query: "SELECT * FROM metrics WHERE ...", format: "json" },
    // ... more sources
  ],
  totalItems: 3
}
```

#### `summarizeEvidence(evidence)`

Summarize gathered evidence into human-readable format.

**Parameters:**
- `evidence` (object) — Raw evidence from sources

**Returns:**
```javascript
"**Errors:** 42 found\n**Warnings:** 15 found\n**Changes:** 7 recent commits"
```

### CO Actions

**CO** handles orchestration: formatting dispatch context and logging transitions.

#### `formatDispatchContext(dispatch)`

Format dispatch plan for agent injection.

**Parameters:**
- `dispatch` (object) — `{ taskType, agents, parallel, instructions }`

**Returns:**
```javascript
"[DISPATCH PLAN]\nTask Type: bug_fix\nAgents: recon, medic, qa\nMode: PARALLEL\nInstructions: ..."
```

#### `logRoleTransition(from, to, reason)`

Log a role transition for audit trail.

**Parameters:**
- `from` (string) — Previous role
- `to` (string) — Next role
- `reason` (string) — Why

**Returns:**
```javascript
{
  timestamp: "2025-01-15T10:30:42.123Z",
  from: "co",
  to: "judge",
  reason: "Intent verification gate",
  transitionId: "co→judge-1706884200000"
}
```

## Integration in extension.mjs

### Using Actions in Tools

The `judge_verify` and `scribe_record` tools use repeatable actions:

```javascript
// In judge_verify tool handler
const verification = await judgeActions.verifyIntent(originalIntent, workCompleted);

// In scribe_record tool handler
const commentResult = await scribeActions.autoComment(workItemId, taskType, {
  summary,
  findings,
  evidence: null,
  nextSteps: null,
});

const linkedResult = await scribeActions.linkPRAndBranch(workItemId, {...});
```

### Extending for New Roles

To add actions for Medic, Engineer, QA, or Recon:

1. **Define the action** in `repeatable-actions.mjs`
2. **Import** in `extension.mjs`: `import { medicActions } from "./repeatable-actions.mjs"`
3. **Use in tool handler**: `const result = await medicActions.diagnose(evidence)`
4. **Inject result** into agent context for LLM

## Benefits

✅ **Consistency** — Same patterns across all roles  
✅ **Testability** — Actions are pure functions (easy to unit test)  
✅ **DRY** — No code duplication across roles  
✅ **Maintainability** — Changes in one place propagate everywhere  
✅ **Discoverability** — All role operations in one file  
✅ **Documentation** — Inline JSDoc + structured returns  

## Future Enhancements

- **Action versioning** — Support multiple versions of same action
- **Action composition** — Chain actions together (e.g., plan + validate + execute)
- **Caching** — Cache repeated evidence gathering queries
- **Metrics** — Track action success rates and performance
- **Extensibility** — Allow custom actions per role
