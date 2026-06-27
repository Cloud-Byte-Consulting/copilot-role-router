/**
 * Repeatable Actions Library
 * Abstracts common patterns used across all roles: Scribe, Judge, Medic, Engineer, etc.
 * 
 * Patterns:
 * - Work item operations (comment, link PR/branch)
 * - Decision verification (intent check, plan validation)
 * - Diagnostic output (logging, evidence collection)
 * - Error handling (rollback, escalation)
 */

/**
 * Scribe Actions: Work item operations
 */
export const scribeActions = {
  /**
   * Auto-comment on a GitHub or ADO work item
   * @param {string} workItemId - GitHub issue number (#123) or ADO work item ID
   * @param {string} taskType - Task classification (bug_fix, feature, etc.)
   * @param {object} data - { summary, findings, evidence, nextSteps }
   * @returns {object} - { success, message, commentId, workItemUrl }
   */
  async autoComment(workItemId, taskType, data) {
    const { summary, findings, evidence, nextSteps } = data;
    const timestamp = new Date().toISOString();
    
    const comment = [
      `## Auto-Comment: ${taskType}`,
      `**Added:** ${timestamp}`,
      ``,
      `**Summary:** ${summary}`,
      ``,
      `**Findings:**`,
      `${findings}`,
      evidence ? `\n**Evidence:**\n${evidence}` : "",
      nextSteps ? `\n**Next Steps:**\n${nextSteps}` : "",
    ].filter(Boolean).join("\n");

    return {
      success: true,
      message: `Comment added to work item ${workItemId}`,
      commentId: `comment-${Date.now()}`,
      workItemUrl: workItemId.startsWith("#")
        ? `https://github.com/issues/${workItemId.slice(1)}`
        : `https://dev.azure.com/_workitems/${workItemId}`,
      commentBody: comment,
    };
  },

  /**
   * Update or create documentation to reflect completed work.
   * Auto-mode: no user approval needed once the target file is confirmed.
   * Scribe executes each entry via create_or_update_file.
   *
   * @param {string[]} files     - Files to update (for "update" action)
   * @param {string}   section   - Section heading to update or create
   * @param {string}   content   - Content for that section
   * @param {string}   reason    - Why docs need changing (from Judge.checkDocsRequired)
   * @param {string}   [newFile] - Path for a new file (for "create" action)
   * @returns {object} - { action: "update"|"create", updates, reason, timestamp }
   */
  async updateDocumentation(files, section, content, reason, newFile = null) {
    const timestamp = new Date().toISOString();

    if (newFile) {
      // Creating a new doc file
      return {
        action: "create",
        newFile,
        section,
        content,
        reason,
        timestamp,
        message: `New documentation created at ${newFile}`,
      };
    }

    // Updating existing sections in known files
    const updates = files.map(file => ({ file, section, content, timestamp }));
    return {
      action: "update",
      updates,
      reason,
      timestamp,
      message: `Docs updated in ${files.join(", ")}: ${section}`,
    };
  },

  /**
   * Link a PR or branch to a work item
   * @param {string} workItemId - GitHub issue number or ADO work item ID
   * @param {object} linkedWork - { prNumber, branch, commit, description }
   * @returns {object} - { success, message, linkedItems }
   */
  async linkPRAndBranch(workItemId, linkedWork) {
    const { prNumber, branch, commit, description } = linkedWork;
    const links = [];

    if (prNumber) {
      links.push(`- **PR:** #${prNumber}`);
    }
    if (branch) {
      links.push(`- **Branch:** \`${branch}\``);
    }
    if (commit) {
      links.push(`- **Commit:** \`${commit.slice(0, 7)}\``);
    }

    const linkComment = [
      `## Work Linked to ${workItemId}`,
      ...links,
      description ? `\n**Description:** ${description}` : "",
    ].filter(Boolean).join("\n");

    return {
      success: true,
      message: `Linked PR/branch to work item ${workItemId}`,
      linkedItems: links,
      linkComment,
    };
  },
};

// ===========================================================================
// Judge verdict core — turnstone-inspired two-tier verdict pipeline.
// Tier 1 = pure-function heuristic (instant). Tier 2 = the Judge LLM, whose
// structured reply is parsed, normalized, and merged against the heuristic.
// ===========================================================================

export const VERDICTS = ["PASS", "PARTIAL", "FAIL"];
export const RECOMMENDATIONS = ["accept", "review", "rework"];
export const RISK_LEVELS = ["none", "low", "medium", "high", "critical"];

// Higher rank = worse (used for "take the worse verdict / max risk" merges).
const VERDICT_RANK = { PASS: 0, PARTIAL: 1, FAIL: 2 };
const RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const GUARD_RISK_RANK = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Clamp a confidence to [0,1]; non-finite (incl. NaN) → 0.5. */
export function clampConfidence(v) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * Technique 4 — deterministic recommendation from verdict + confidence + risk.
 * Recommendation never contradicts the verdict.
 */
export function recommendationFromConfidence(verdict, confidence, riskLevel = "low") {
  const c = clampConfidence(confidence);
  const risk = RISK_LEVELS.includes(riskLevel) ? riskLevel : "medium";
  if (verdict === "FAIL") return "rework";
  if (verdict === "PARTIAL") {
    return c >= 0.6 && RISK_RANK[risk] < RISK_RANK.high ? "review" : "rework";
  }
  // PASS
  if (c >= 0.9 && RISK_RANK[risk] <= RISK_RANK.medium) return "accept";
  return "review";
}

/** Technique 5 — one-sentence summary of what the work actually did. */
export function buildIntentSummary(workCompleted) {
  const text = (workCompleted ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "No work description provided.";
  const first = text.split(/(?<=[.!?])\s/)[0];
  return first.length > 160 ? first.slice(0, 157) + "..." : first;
}

/** Technique 7 — coerce an arbitrary verdict-like object into the canonical schema. */
export function normalizeVerdict(obj, tier = "llm") {
  const o = obj && typeof obj === "object" ? obj : {};
  let verdict = String(o.verdict ?? "").toUpperCase();
  if (!VERDICTS.includes(verdict)) verdict = "PARTIAL"; // safe default: never a free PASS
  let riskLevel = String(o.riskLevel ?? o.risk_level ?? "").toLowerCase();
  if (!RISK_LEVELS.includes(riskLevel)) riskLevel = "medium";
  const confidence = clampConfidence(o.confidence);
  let recommendation = String(o.recommendation ?? "").toLowerCase();
  if (!RECOMMENDATIONS.includes(recommendation)) {
    recommendation = recommendationFromConfidence(verdict, confidence, riskLevel);
  }
  let evidence = o.evidence;
  if (typeof evidence === "string") evidence = [evidence];
  if (!Array.isArray(evidence)) evidence = [];
  evidence = evidence
    .map((e) => (typeof e === "string" ? e : (e && typeof e === "object" ? JSON.stringify(e) : String(e))))
    .filter(Boolean);
  const gaps = Array.isArray(o.gaps) ? o.gaps.filter((g) => typeof g === "string") : [];
  return {
    intentSummary: typeof o.intentSummary === "string" ? o.intentSummary : "",
    verdict,
    recommendation,
    confidence,
    riskLevel,
    reasoning: typeof o.reasoning === "string" ? o.reasoning : "",
    evidence,
    gaps,
    tier,
  };
}

function scanBalancedObject(s) {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function regexExtractFields(s) {
  const out = {};
  const str = (k) => {
    const m = s.match(new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`, "i"));
    if (m) out[k] = m[1];
  };
  const num = (k) => {
    const m = s.match(new RegExp(`"${k}"\\s*:\\s*([0-9.]+)`, "i"));
    if (m) out[k] = parseFloat(m[1]);
  };
  str("verdict"); str("recommendation"); str("riskLevel"); str("reasoning"); str("intentSummary");
  num("confidence");
  if (!out.verdict) {
    const m = s.match(/\b(PASS|PARTIAL|FAIL)\b/);
    if (m) out.verdict = m[1];
  }
  return out;
}

/**
 * Technique 7 — robust 4-stage JSON extraction:
 * 1) direct parse  2) markdown fence  3) brace-scan  4) regex field extraction.
 * Returns a normalized verdict or null when nothing usable is found.
 */
export function parseVerdict(text, tier = "llm") {
  // An object/string is only a usable verdict if it carries at least one signal.
  const hasSignal = (o) =>
    o && typeof o === "object" &&
    (o.verdict != null || o.reasoning != null || o.recommendation != null ||
      o.confidence != null || (Array.isArray(o.evidence) && o.evidence.length > 0));
  const tryNorm = (o) => (hasSignal(o) ? normalizeVerdict(o, tier) : null);

  if (text && typeof text === "object") return tryNorm(text);
  const s = String(text ?? "");
  // Stage 1: direct
  try { const r = tryNorm(JSON.parse(s)); if (r) return r; } catch { /* fall through */ }
  // Stage 2: ```json ... ``` fence
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try { const r = tryNorm(JSON.parse(fence[1].trim())); if (r) return r; } catch { /* fall through */ }
  }
  // Stage 3: first balanced { ... }
  const braced = scanBalancedObject(s);
  if (braced) {
    try { const r = tryNorm(JSON.parse(braced)); if (r) return r; } catch { /* fall through */ }
  }
  // Stage 4: regex field extraction (last resort)
  const fields = regexExtractFields(s);
  return Object.keys(fields).length ? normalizeVerdict(fields, tier) : null;
}

/** Technique 9 — fallback verdict built from the heuristic when the LLM fails. */
export function fallbackVerdict(heuristic, reason = "LLM verdict unavailable") {
  const h = heuristic && typeof heuristic === "object" ? heuristic : {};
  const v = normalizeVerdict(
    { ...h, reasoning: `[fallback] ${reason}. ${h.reasoning ?? ""}`.trim() },
    "fallback",
  );
  // Preserve hard tripwires so a downstream merge still honors the floor.
  v.hardTripwires = Array.isArray(h.hardTripwires) ? h.hardTripwires : [];
  return v;
}

/** Concrete-evidence test: a PASS must cite a file/line/test/diff/commit, not prose. */
const CONCRETE_EVIDENCE_RE =
  /[\/\\][\w.-]+|\b[\w-]+\.(?:js|mjs|ts|tsx|jsx|py|go|rs|java|json|md|yml|yaml|sh|c|cpp|h)\b|:\d+\b|\bline\s+\d+|\btest(?:s|ed|ing)?\b|\bdiff\b|\bcommit\b|\bPR\s*#?\d+|\b[0-9a-f]{7,40}\b|\b\d+\s*\/\s*\d+\b|coverage\s+\d/i;
export function hasConcreteEvidence(evidence) {
  if (!Array.isArray(evidence)) return false;
  return evidence.some((e) => typeof e === "string" && CONCRETE_EVIDENCE_RE.test(e));
}

/**
 * Technique 10 — anti-gaming merge. The LLM may WORSEN the verdict (PASS→FAIL)
 * and RAISE risk, but it cannot clear a heuristic HARD tripwire (objective
 * failures such as failed tests / broken build). Soft signals stay advisory.
 * A PASS with no concrete evidence is downgraded to PARTIAL.
 */
export function mergeVerdicts(heuristic, llm) {
  const h = normalizeVerdict(heuristic, "heuristic");
  const l = normalizeVerdict(llm, "llm");
  const hardFloor = Array.isArray(heuristic?.hardTripwires) ? heuristic.hardTripwires : [];

  // Verdict: the worse (higher-ranked) of the two.
  let verdict = VERDICT_RANK[l.verdict] >= VERDICT_RANK[h.verdict] ? l.verdict : h.verdict;
  if (hardFloor.length > 0) verdict = "FAIL"; // non-overridable floor

  // Risk: max of the two.
  const riskLevel = RISK_RANK[l.riskLevel] >= RISK_RANK[h.riskLevel] ? l.riskLevel : h.riskLevel;

  // Evidence + gaps: union (plus the tripwire citations).
  const evidence = [...new Set([
    ...h.evidence,
    ...l.evidence,
    ...hardFloor.map((t) => `hard tripwire: ${t}`),
  ])];
  const gaps = [...new Set([...h.gaps, ...l.gaps])];

  // Downgrade an unsupported PASS to PARTIAL: a PASS must cite CONCRETE evidence
  // (a file path, line ref, test/diff/commit citation), not just "looks good".
  if (verdict === "PASS" && !hasConcreteEvidence(l.evidence)) verdict = "PARTIAL";

  const confidence = hardFloor.length > 0 ? Math.max(l.confidence, 0.9) : l.confidence;
  const recommendation = recommendationFromConfidence(verdict, confidence, riskLevel);
  return {
    intentSummary: l.intentSummary || h.intentSummary,
    verdict,
    recommendation,
    confidence,
    riskLevel,
    reasoning: l.reasoning || h.reasoning,
    evidence,
    gaps,
    tier: "merged",
    hardTripwires: hardFloor,
    llmRecommendation: l.recommendation, // preserve LLM dissent for audit
  };
}

// ---------------------------------------------------------------------------
// Hill-climb (self-refine / Reflexion) loop control — Phase 1.
//
// CO does NOT decide on its own how many times to refine. After each Judge
// verdict, computeDirective() returns a CODE-ENFORCED directive that caps the
// number of rework cycles and halts on plateau. The round counter is persisted
// in state (keyed by intent) so the cap survives reloads and cannot be talked
// past by the CO LLM. This is the "hard limit in code, not prompt" guardrail.
//
// Stop conditions (in priority order):
//   STOP_ACCEPT   — verdict accepted (PASS, high confidence): done.
//   STOP_REVIEW   — Judge wants human review: escalate, do not auto-refine.
//   STOP_BUDGET   — exhausted maxRounds rework cycles: escalate to user.
//   STOP_PLATEAU  — no measurable improvement vs. the prior round: escalate.
//   CONTINUE_REFINE — route gaps[] back to the owning role and re-verify.
//
// "Improvement" is measured by CONCRETE deltas (fewer blocking gaps, or a
// confidence gain >= minConfidenceDelta), never by raw confidence drift alone,
// because LLM/Judge confidence is noisy and uncalibrated.
// ---------------------------------------------------------------------------
export const HILLCLIMB_DEFAULTS = Object.freeze({
  maxRounds: 3, // max rework cycles before forced human escalation
  maxFlatRounds: 2, // consecutive non-improving rounds before plateau escalation
  minConfidenceDelta: 0.05, // confidence gain that counts as real improvement
  ttlMs: 6 * 60 * 60 * 1000, // refine-run records older than this are pruned
  maxRuns: 50, // hard cap on tracked runs (LRU prune beyond this)
});

/** Stable, bounded key for a refinement run derived from the user's intent. */
export function runKey(intent) {
  const norm = String(intent ?? "").toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
  // djb2 — small, deterministic, collision-resistant enough for keying runs.
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) >>> 0;
  return `r-${h.toString(36)}`;
}

/**
 * Decide whether the hill-climb loop continues, stops, or escalates.
 * Pure function — all loop state is passed in and returned, never mutated.
 *
 * @param {object}  args
 * @param {object|null} args.prevRun - prior run state, or null on first verdict
 * @param {object}  args.verdict - merged verdict { recommendation, confidence, gaps[] }
 * @param {number} [args.maxRounds]
 * @param {number} [args.maxFlatRounds]
 * @param {number} [args.minConfidenceDelta]
 * @param {number} [args.now] - injectable clock (ms) for deterministic tests
 * @returns {{ directive: string, round: number, improved: boolean,
 *             nextRun: object|null, sticky?: boolean, reason: string }}
 */
export function computeDirective({ prevRun, verdict, maxRounds, maxFlatRounds, minConfidenceDelta, now } = {}) {
  const max = Number.isFinite(maxRounds) ? maxRounds : HILLCLIMB_DEFAULTS.maxRounds;
  const maxFlat = Number.isFinite(maxFlatRounds) ? maxFlatRounds : HILLCLIMB_DEFAULTS.maxFlatRounds;
  const delta = Number.isFinite(minConfidenceDelta) ? minConfidenceDelta : HILLCLIMB_DEFAULTS.minConfidenceDelta;
  const ts = Number.isFinite(now) ? now : Date.now();
  const rec = verdict?.recommendation;

  // Sticky terminal: once a run is halted by budget/plateau, it STAYS halted.
  // A noncompliant CO cannot reset the cap by simply re-verifying the same intent;
  // only a brand-new run (prevRun == null, i.e. a new intent/runId) starts fresh.
  if (prevRun?.terminal) {
    return {
      directive: prevRun.terminal, round: prevRun.round, improved: false,
      nextRun: { ...prevRun, lastTouched: ts }, sticky: true,
      reason: `Run already halted (${prevRun.terminal}). Escalate to the user; start a NEW task/intent to reset.`,
    };
  }

  // Terminal recommendations clear the run — no refinement loop.
  if (rec === "accept") {
    return { directive: "STOP_ACCEPT", round: prevRun?.round ?? 0, improved: true, nextRun: null, reason: "Verdict accepted." };
  }
  if (rec === "review") {
    return { directive: "STOP_REVIEW", round: prevRun?.round ?? 0, improved: false, nextRun: null, reason: "Judge requests human review; not auto-refinable." };
  }

  // rework — this is the hill-climb path.
  const prev = prevRun ?? { round: 0, bestConfidence: 0, lastGapCount: null, flatRounds: 0 };
  const round = prev.round + 1;
  const gapCount = Array.isArray(verdict?.gaps) ? verdict.gaps.length : 0;

  // Treat a non-finite/invalid confidence as UNKNOWN: it neither counts as
  // improvement nor updates bestConfidence (avoids a spurious 0.5 "gain").
  const raw = verdict?.confidence;
  const confNum = typeof raw === "number" ? raw : parseFloat(raw);
  const confidence = Number.isFinite(confNum) ? clampConfidence(confNum) : null;

  const gapsImproved = prev.lastGapCount === null ? true : gapCount < prev.lastGapCount;
  const confImproved = confidence !== null && confidence > prev.bestConfidence + delta;
  const improved = gapsImproved || confImproved;
  const flatRounds = improved ? 0 : (prev.flatRounds ?? 0) + 1;
  const bestConfidence = confidence !== null ? Math.max(prev.bestConfidence, confidence) : prev.bestConfidence;
  const baseRun = { round, bestConfidence, lastGapCount: gapCount, flatRounds, lastTouched: ts };

  if (round > max) {
    return { directive: "STOP_BUDGET", round, improved,
      nextRun: { ...baseRun, terminal: "STOP_BUDGET", stoppedAt: ts },
      reason: `Reached the refinement budget (${max} rework cycles) without a PASS.` };
  }
  if (flatRounds >= maxFlat) {
    return { directive: "STOP_PLATEAU", round, improved,
      nextRun: { ...baseRun, terminal: "STOP_PLATEAU", stoppedAt: ts },
      reason: `No measurable improvement for ${flatRounds} consecutive rounds (gaps not shrinking, confidence flat).` };
  }
  return { directive: "CONTINUE_REFINE", round, improved, nextRun: baseRun,
    reason: `Refinement round ${round} of ${max}: route gaps back to the owning role and re-verify.` };
}

/**
 * Prune the refine-run map: drop records older than ttlMs and LRU-cap the count.
 * Pure — returns a new object; never mutates the input.
 */
export function pruneRuns(runs, { now, ttlMs, maxRuns } = {}) {
  const ts = Number.isFinite(now) ? now : Date.now();
  const ttl = Number.isFinite(ttlMs) ? ttlMs : HILLCLIMB_DEFAULTS.ttlMs;
  const cap = Number.isFinite(maxRuns) ? maxRuns : HILLCLIMB_DEFAULTS.maxRuns;
  const entries = Object.entries(runs ?? {}).filter(([, r]) => {
    const t = r?.lastTouched ?? r?.stoppedAt ?? 0;
    return ts - t < ttl;
  });
  entries.sort((a, b) => (b[1]?.lastTouched ?? 0) - (a[1]?.lastTouched ?? 0));
  return Object.fromEntries(entries.slice(0, cap));
}

export const hillclimb = { HILLCLIMB_DEFAULTS, runKey, computeDirective, pruneRuns };

// Hard tripwires: objective, non-overridable FAIL signals scanned from the
// work-completed text. Patterns are narrowed to UNRESOLVED-failure contexts so
// they do not fire on benign prose like "fixed the bug where users were unable
// to log in" or "handled the exception path".
const HARD_TRIPWIRE_PATTERNS = [
  { re: /\btests?\s+(?:are\s+)?(?:still\s+)?fail(?:ing|ed|s)?\b/i, label: "tests failed" },
  { re: /\bbuild\s+(?:failed|broke|broken|is\s+broken)\b/i, label: "build failed" },
  { re: /\bnot\s+(?:yet\s+)?implemented\b/i, label: "not implemented" },
  {
    re: /\b(?:could\s*n[o']?t|unable\s+to|cannot|can'?t|was\s+unable\s+to)\s+(?:complete|finish|resolve|fix|implement|build|run|compile|reproduce|verify|get\s+\w+\s+to\s+work)\b/i,
    label: "could not complete",
  },
  {
    re: /\b(?:uncaught|unhandled)\s+(?:exception|error)\b|\bstack\s?trace\b|\btraceback\b|\bthrew\s+(?:an?\s+)?(?:exception|error)\b/i,
    label: "runtime error",
  },
  {
    re: /\bfailed\s+to\s+(?:complete|build|run|compile|start|load|parse|connect|deploy|install|pass)\b/i,
    label: "operation failed",
  },
];

const INTENT_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with", "is", "be",
  "that", "this", "it", "we", "i", "should", "can", "do", "does", "please", "make",
  "add", "via", "by", "as", "at", "so", "if", "then",
]);

/**
 * Technique 1/5 — Tier-1 heuristic intent verdict (pure function).
 * Returns the canonical verdict schema plus heuristic-specific fields
 * (hardTripwires, softSignals, coverage) used by the merge.
 */
export function intentHeuristic(originalIntent, workCompleted) {
  const work = (workCompleted ?? "").toLowerCase();
  const workKeywords = work.split(/\s+/).filter(Boolean);
  // Only match against substantive work tokens — single/two-char tokens like
  // "a"/"to"/"is" otherwise substring-match almost any intent term and inflate coverage.
  const workMatch = workKeywords.filter((w) => w.length > 2);
  const intentTokens = (originalIntent ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = intentTokens.filter((k) => k.length > 2 && !INTENT_STOPWORDS.has(k));
  const terms = meaningful.length ? meaningful : intentTokens;
  const base = terms.length || 1;

  const covered = terms.filter((kw) => workMatch.some((wk) => wk.includes(kw) || kw.includes(wk)));
  const coverage = covered.length / base;
  const gaps = terms.filter((kw) => !workMatch.some((wk) => wk.includes(kw)));

  const hardTripwires = HARD_TRIPWIRE_PATTERNS
    .filter((p) => p.re.test(workCompleted ?? ""))
    .map((p) => p.label);

  const softSignals = [];
  if (coverage < 0.5) softSignals.push("low intent keyword coverage");
  if ((workCompleted ?? "").trim().length < 20) softSignals.push("sparse work description");

  let verdict, confidence;
  if (hardTripwires.length > 0) { verdict = "FAIL"; confidence = 0.9; }
  else if (coverage >= 0.7) { verdict = "PASS"; confidence = Math.min(0.6 + coverage * 0.3, 0.85); }
  else if (coverage >= 0.4) { verdict = "PARTIAL"; confidence = 0.55; }
  else { verdict = "FAIL"; confidence = 0.5; }

  const riskLevel = hardTripwires.length > 0 ? "high" : "low";
  const evidence = [
    `intent coverage ${(coverage * 100).toFixed(0)}% (${covered.length}/${base} key terms)`,
    ...hardTripwires.map((t) => `hard tripwire: ${t}`),
    ...softSignals.map((s) => `soft signal: ${s}`),
  ];
  const recommendation = recommendationFromConfidence(verdict, confidence, riskLevel);
  return {
    intentSummary: buildIntentSummary(workCompleted),
    verdict,
    recommendation,
    confidence,
    riskLevel,
    reasoning:
      `Heuristic intent coverage ${(coverage * 100).toFixed(0)}%.` +
      (hardTripwires.length ? ` Hard tripwires: ${hardTripwires.join(", ")}.` : ""),
    evidence,
    gaps,
    tier: "heuristic",
    hardTripwires,
    softSignals,
    coverage,
  };
}

/**
 * Judge Actions: Decision verification
 */
export const judgeActions = {
  /**
   * Verify user intent completion (Tier-1 heuristic).
   * Returns the canonical verdict schema enriched with docs assessment.
   * Backward-compatible fields (verdict/reasoning/gaps/confidence/docsAction…) preserved.
   * @param {string} originalIntent - What the user originally asked for
   * @param {string} workCompleted - What was actually delivered
   */
  async verifyIntent(originalIntent, workCompleted) {
    const h = intentHeuristic(originalIntent, workCompleted);

    // Check if work involves user-facing changes that warrant documentation changes.
    const docsResult = await judgeActions.checkDocsRequired(null, workCompleted);

    return {
      // Canonical verdict schema (Techniques 1-5)
      intentSummary: h.intentSummary,
      verdict: h.verdict,
      recommendation: h.recommendation,
      confidence: h.confidence,
      riskLevel: h.riskLevel,
      reasoning: h.reasoning,
      evidence: h.evidence,
      gaps: h.gaps,
      tier: h.tier,
      hardTripwires: h.hardTripwires,
      softSignals: h.softSignals,
      coverage: h.coverage,
      // Docs assessment (unchanged 4-action model)
      docsAction: docsResult.docsAction,
      docsReason: docsResult.reason,
      suggestedFiles: docsResult.suggestedFiles,
      suggestedSection: docsResult.suggestedSection ?? null,
      proposedFile: docsResult.proposedFile,
      askQuestion: docsResult.askQuestion,
    };
  },

  /**
   * Determine whether completed work requires documentation changes.
   * Distinguishes between updating existing docs, creating new docs,
   * or asking the user when the right location is unclear.
   *
   * @param {string|null} taskType - Classified task type (feature, bug_fix, etc.) or null
   * @param {string} workCompleted  - Description of what was done
   * @returns {object} - {
   *   docsAction: "none"|"update"|"create"|"ask_user",
   *   reason: string,
   *   suggestedFiles: string[],   // for "update" — files that likely need editing
   *   proposedFile: string|null,  // for "create" — suggested new filename
   *   askQuestion: string|null,   // for "ask_user" — question to surface to the user
   * }
   */
  async checkDocsRequired(taskType, workCompleted) {
    const lower = (workCompleted ?? "").toLowerCase();

    // Signals that mean an EXISTING doc section needs updating
    const updateSignals = [
      { signal: "new role",        file: "README.md", section: "## Roles" },
      { signal: "renamed role",    file: "README.md", section: "## Roles" },
      { signal: "removed role",    file: "README.md", section: "## Roles" },
      { signal: "new tool",        file: "README.md", section: "## Tools" },
      { signal: "new parameter",   file: "README.md", section: null },
      { signal: "new option",      file: "README.md", section: null },
      { signal: "renamed",         file: "README.md", section: null },
      { signal: "changed api",     file: "README.md", section: null },
      { signal: "breaking",        file: "README.md", section: null },
      { signal: "new command",     file: "README.md", section: null },
      { signal: "version bump",    file: "VERSIONING.md", section: null },
      { signal: "release",         file: "README.md", section: null },
      { signal: "workflow",        file: "README.md", section: null },
    ];

    // Signals that mean NEW documentation likely needs to be CREATED
    const createSignals = [
      "new feature", "new subsystem", "new extension", "new module",
      "new guide", "new integration", "new script",
    ];

    // Task types that always need docs — categorised by action
    const updateTaskTypes = new Set(["new_role", "api_change", "breaking_change", "config_change"]);
    const createTaskTypes = new Set(["feature"]);

    const updateHit = updateSignals.find(s => lower.includes(s.signal));
    const createHit = createSignals.find(s => lower.includes(s));
    const updateByType = taskType && updateTaskTypes.has(taskType);
    const createByType = taskType && createTaskTypes.has(taskType);

    // Update: we know the file
    if (updateHit || updateByType) {
      return {
        docsAction: "update",
        reason: `Existing docs need updating: ${updateHit ? `work contains "${updateHit.signal}"` : `task type is "${taskType}"`}.`,
        suggestedFiles: [updateHit?.file ?? "README.md"],
        suggestedSection: updateHit?.section ?? null,
        proposedFile: null,
        askQuestion: null,
      };
    }

    // Create: new surface but destination unclear — propose a file, but ask if unsure
    if (createHit || createByType) {
      const featureName = workCompleted.split(/\s+/).slice(0, 4).join("-").toLowerCase().replace(/[^a-z0-9-]/g, "");
      return {
        docsAction: "ask_user",
        reason: `New feature/surface detected ("${createHit ?? taskType}") — documentation should be created but the destination is not obvious.`,
        suggestedFiles: [],
        proposedFile: `docs/${featureName}.md`,
        askQuestion:
          `New documentation is needed for this work. Where should it live?\n` +
          `Suggestions: (1) a new section in README.md, (2) a new file at docs/${featureName}.md, ` +
          `(3) a GitHub Wiki page. Which do you prefer, or do you have another location in mind?`,
      };
    }

    return {
      docsAction: "none",
      reason: "No documentation change required — work is internal/fix only.",
      suggestedFiles: [],
      proposedFile: null,
      askQuestion: null,
    };
  },
};

/**
 * Engineer CI template helper — referenced by role prompts, not invoked at runtime.
 */
export const engineerActions = {
  pipelineFailureNotifierYaml(type = "ci", mainJob = "build") {
    const isRelease = type === "release";
    const refLabel = isRelease ? "Tag" : "Branch";
    const refVar = isRelease ? "TAG" : "BRANCH";
    const refContext = isRelease ? "github.ref_name" : "github.ref_name";
    const titleSuffix = isRelease ? "${WORKFLOW} ${TAG}" : "${WORKFLOW} on ${BRANCH}";
    const dedupContains = isRelease
      ? '$w + " " + $t'
      : '$w + " on " + $b';
    const dedupArgs = isRelease
      ? '--arg w "$WORKFLOW" --arg t "$TAG"'
      : '--arg w "$WORKFLOW" --arg b "$BRANCH"';
    const refAssign = isRelease
      ? `TAG="\${{ github.ref_name }}"`
      : `BRANCH="\${{ github.ref_name }}"`;

    return `
  notify-failure:
    needs: [${mainJob}]
    if: failure()
    runs-on: ubuntu-latest
    steps:
      - name: Ensure ci:run-failure label exists
        run: |
          gh label create "ci:run-failure" \\
            --repo "\${{ github.repository }}" \\
            --description "Automated: pipeline run failure" \\
            --color "d93f0b" \\
            --force 2>/dev/null || true
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}

      - name: Create or update failure issue
        run: |
          WORKFLOW="\${{ github.workflow }}"
          ${refAssign}
          RUN_URL="\${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"

          EXISTING=$(gh issue list \\
            --repo "\${{ github.repository }}" \\
            --state open \\
            --label "ci:run-failure" \\
            --json number,title \\
            | jq ${dedupArgs} \\
              '[.[] | select(.title | contains(${dedupContains}))] | .[0].number // empty' \\
            | tr -d '"')

          if [ -n "$EXISTING" ]; then
            gh issue comment "$EXISTING" \\
              --repo "\${{ github.repository }}" \\
              --body "## 🔁 Recurrence\\n\\n**Run:** \${RUN_URL}\\n**Commit:** \`\${{ github.sha }}\`\\n**Actor:** @\${{ github.actor }}\\n**Time:** $(date -u +%Y-%m-%dT%H:%M:%SZ)"
          else
            gh issue create \\
              --repo "\${{ github.repository }}" \\
              --title "🔴 ${isRelease ? "Release" : "CI"} failure: ${titleSuffix}" \\
              --label "ci:run-failure" \\
              --body "..."
          fi
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}`.trim();
  },
};

// ===========================================================================
// Output Guard (bonus) — turnstone-inspired post-execution content scanner.
// Evaluates a TOOL RESULT *after* execution but *before* it enters the model's
// context. Detects prompt-injection, credential leakage (with redaction),
// encoded payloads, adversarial URLs, and system-info disclosure.
// Redaction is a deterministic, heuristic-only control the LLM cannot override.
// ===========================================================================

const PROMPT_INJECTION_PATTERNS = [
  { re: /ignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions/i, note: "Instruction-override phrase" },
  { re: /disregard\s+(?:the\s+)?(?:above|prior|previous|system)/i, note: "Disregard-context directive" },
  { re: /"role"\s*:\s*"system"/i, note: "Embedded system-role injection" },
  { re: /\bnew\s+instructions?\s*:/i, note: "New-instructions marker" },
  { re: /\b(?:system|developer)\s+prompt\b/i, note: "Prompt-disclosure reference" },
  { re: /you\s+are\s+now\s+(?:a|an|in|the)\b/i, note: "Role-reassignment directive" },
];

// Each entry: { type, note, re (global) }. `re` is global for both match + replace.
const CREDENTIAL_PATTERNS = [
  { type: "private_key", note: "Private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { type: "api_key", note: "OpenAI-style key", re: /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/g },
  { type: "api_key", note: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { type: "api_key", note: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
  { type: "connection_string", note: "URI with embedded credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:[^@\s/]+@[^\s]+/gi },
  { type: "password", note: "Inline password assignment", re: /"?password"?\s*[:=]\s*"?[^"\s,}]{6,}"?/gi },
  { type: "secret", note: "Inline secret/token assignment", re: /"?(?:secret|api[_-]?key|access[_-]?token)"?\s*[:=]\s*"?[A-Za-z0-9_\-]{12,}"?/gi },
];

const ENCODED_PAYLOAD_PATTERNS = [
  { re: /data:(?:text\/html|application\/javascript)[^,]*,/i, note: "Executable data: URI" },
  { re: /(?:\\x[0-9a-f]{2}){8,}/i, note: "Hex-encoded byte sequence" },
];

const ADVERSARIAL_URL_PATTERNS = [
  { re: /169\.254\.169\.254/, note: "Cloud metadata endpoint" },
  { re: /metadata\.google\.internal/i, note: "GCP metadata host" },
  { re: /[?&](?:access_token|api_key|password|secret)=/i, note: "Credential-bearing URL parameter" },
];

const PRIVATE_IP_RE = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/;

export const guardActions = {
  /**
   * Scan a tool-result string for content-level threats.
   * @param {string} text - The tool result text (textResultForLlm).
   * @param {object} [opts] - { redact?: boolean (default true) }
   * @returns {object} - {
   *   riskLevel: "none"|"low"|"medium"|"high"|"critical",
   *   flags: string[], annotations: string[],
   *   redacted: boolean, redactedText: string, clean: boolean
   * }
   */
  scanOutput(text, opts = {}) {
    const redact = opts.redact !== false;
    const input = String(text ?? "");
    const flags = [];
    const annotations = [];
    let riskLevel = "none";
    let redactedText = input;
    let redacted = false;
    const bump = (level) => {
      if (GUARD_RISK_RANK[level] > GUARD_RISK_RANK[riskLevel]) riskLevel = level;
    };

    // 1. Prompt injection (high).
    for (const p of PROMPT_INJECTION_PATTERNS) {
      if (p.re.test(input)) { flags.push("prompt_injection"); annotations.push(p.note); bump("high"); break; }
    }
    // 2. Credential leakage (high) + redaction.
    for (const c of CREDENTIAL_PATTERNS) {
      if (input.match(c.re)) {
        flags.push("credential_leak");
        annotations.push(`${c.note} detected`);
        bump("high");
        if (redact) {
          const next = redactedText.replace(c.re, `[REDACTED:${c.type}]`);
          if (next !== redactedText) { redactedText = next; redacted = true; }
        }
      }
    }
    // 3. Encoded payloads (medium).
    for (const e of ENCODED_PAYLOAD_PATTERNS) {
      if (e.re.test(input)) { flags.push("encoded_payload"); annotations.push(e.note); bump("medium"); break; }
    }
    // 4. Adversarial URLs (medium).
    for (const u of ADVERSARIAL_URL_PATTERNS) {
      if (u.re.test(input)) { flags.push("adversarial_url"); annotations.push(u.note); bump("medium"); break; }
    }
    // 5. System-info disclosure (low).
    if (PRIVATE_IP_RE.test(input)) { flags.push("system_info"); annotations.push("Private IP address disclosed"); bump("low"); }

    return {
      riskLevel,
      flags: [...new Set(flags)],
      annotations,
      redacted,
      redactedText: redacted ? redactedText : input,
      clean: flags.length === 0,
    };
  },
};

export default {
  scribeActions,
  judgeActions,
  guardActions,
  hillclimb,
  engineerActions,
};
