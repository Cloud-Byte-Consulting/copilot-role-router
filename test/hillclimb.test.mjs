import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runKey,
  computeDirective,
  pruneRuns,
  hillclimb,
  HILLCLIMB_DEFAULTS,
} from "../.github/extensions/role-router/src/repeatable-actions.mjs";

// Helpers to build merged-verdict-shaped objects.
const rework = (gaps = [], confidence = 0.4) => ({ recommendation: "rework", confidence, gaps });
const accept = () => ({ recommendation: "accept", confidence: 0.95, gaps: [] });
const review = () => ({ recommendation: "review", confidence: 0.7, gaps: ["g"] });

// --------------------------------------------------------------------------
// runKey
// --------------------------------------------------------------------------
test("runKey is stable across whitespace/case/punctuation variations of the same intent", () => {
  const a = runKey("Fix the  Login,  BUG!");
  const b = runKey("fix the login bug");
  assert.equal(a, b);
  assert.match(a, /^r-[0-9a-z]+$/);
});

test("runKey differs for different intents", () => {
  assert.notEqual(runKey("fix login"), runKey("add logout"));
});

test("runKey tolerates null/undefined intent", () => {
  assert.equal(typeof runKey(undefined), "string");
  assert.equal(runKey(null), runKey(""));
});

// --------------------------------------------------------------------------
// Terminal recommendations clear the run (no refine loop)
// --------------------------------------------------------------------------
test("accept yields STOP_ACCEPT and clears the run", () => {
  const r = computeDirective({ prevRun: { round: 2, bestConfidence: 0.5, lastGapCount: 3 }, verdict: accept() });
  assert.equal(r.directive, "STOP_ACCEPT");
  assert.equal(r.nextRun, null);
});

test("review yields STOP_REVIEW and clears the run", () => {
  const r = computeDirective({ prevRun: null, verdict: review() });
  assert.equal(r.directive, "STOP_REVIEW");
  assert.equal(r.nextRun, null);
});

// --------------------------------------------------------------------------
// First rework continues and seeds the run
// --------------------------------------------------------------------------
test("first rework -> CONTINUE_REFINE round 1, seeds run state", () => {
  const r = computeDirective({ prevRun: null, verdict: rework(["a", "b", "c"], 0.4) });
  assert.equal(r.directive, "CONTINUE_REFINE");
  assert.equal(r.round, 1);
  assert.equal(r.nextRun.round, 1);
  assert.equal(r.nextRun.lastGapCount, 3);
  assert.equal(r.nextRun.bestConfidence, 0.4);
});

// --------------------------------------------------------------------------
// Improvement = fewer gaps OR a real confidence gain
// --------------------------------------------------------------------------
test("round 2 with fewer gaps -> CONTINUE_REFINE (improved)", () => {
  const prev = { round: 1, bestConfidence: 0.4, lastGapCount: 3 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a"], 0.4) });
  assert.equal(r.directive, "CONTINUE_REFINE");
  assert.equal(r.round, 2);
  assert.equal(r.improved, true);
});

test("round 2 with confidence gain >= delta but same gaps -> CONTINUE_REFINE", () => {
  const prev = { round: 1, bestConfidence: 0.4, lastGapCount: 2 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a", "b"], 0.4 + HILLCLIMB_DEFAULTS.minConfidenceDelta + 0.01) });
  assert.equal(r.directive, "CONTINUE_REFINE");
  assert.equal(r.improved, true);
});

// --------------------------------------------------------------------------
// Plateau detection requires maxFlatRounds CONSECUTIVE non-improving rounds
// --------------------------------------------------------------------------
test("a single flat round does NOT stop (keeps refining)", () => {
  const prev = { round: 1, bestConfidence: 0.4, lastGapCount: 2, flatRounds: 0 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a", "b"], 0.41) }); // <0.05 gain, same gaps
  assert.equal(r.directive, "CONTINUE_REFINE");
  assert.equal(r.improved, false);
  assert.equal(r.nextRun.flatRounds, 1);
});

test("two consecutive flat rounds -> STOP_PLATEAU (sticky terminal set)", () => {
  const prev = { round: 2, bestConfidence: 0.4, lastGapCount: 2, flatRounds: 1 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a", "b"], 0.41) });
  assert.equal(r.directive, "STOP_PLATEAU");
  assert.equal(r.nextRun.terminal, "STOP_PLATEAU");
});

test("a flat round resets when improvement resumes", () => {
  const prev = { round: 2, bestConfidence: 0.4, lastGapCount: 2, flatRounds: 1 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a"], 0.4) }); // fewer gaps
  assert.equal(r.directive, "CONTINUE_REFINE");
  assert.equal(r.nextRun.flatRounds, 0);
});

// --------------------------------------------------------------------------
// Budget cap — cannot exceed maxRounds even if still improving
// --------------------------------------------------------------------------
test("exceeding maxRounds -> STOP_BUDGET even when improving, sets sticky terminal", () => {
  const max = HILLCLIMB_DEFAULTS.maxRounds; // 3
  const prev = { round: max, bestConfidence: 0.4, lastGapCount: 5, flatRounds: 0 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a"], 0.9) }); // big improvement
  assert.equal(r.round, max + 1);
  assert.equal(r.directive, "STOP_BUDGET");
  assert.equal(r.nextRun.terminal, "STOP_BUDGET");
});

test("budget cap is honored with a custom maxRounds", () => {
  const prev = { round: 1, bestConfidence: 0.4, lastGapCount: 2, flatRounds: 0 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a"], 0.9), maxRounds: 1 });
  assert.equal(r.directive, "STOP_BUDGET");
});

// --------------------------------------------------------------------------
// Sticky terminal — a halted run cannot be restarted by re-verifying
// --------------------------------------------------------------------------
test("sticky terminal returns the same STOP and does not reset the round", () => {
  const halted = { round: 4, bestConfidence: 0.6, lastGapCount: 2, flatRounds: 0, terminal: "STOP_BUDGET" };
  const r = computeDirective({ prevRun: halted, verdict: rework(["a"], 0.99) });
  assert.equal(r.directive, "STOP_BUDGET");
  assert.equal(r.sticky, true);
  assert.equal(r.round, 4);
  assert.equal(r.nextRun.terminal, "STOP_BUDGET");
});

test("an accept verdict cannot override a sticky terminal", () => {
  const halted = { round: 4, bestConfidence: 0.6, lastGapCount: 2, flatRounds: 0, terminal: "STOP_PLATEAU" };
  const r = computeDirective({ prevRun: halted, verdict: accept() });
  assert.equal(r.directive, "STOP_PLATEAU");
  assert.equal(r.sticky, true);
});

// --------------------------------------------------------------------------
// Non-finite confidence is treated as UNKNOWN (no spurious improvement)
// --------------------------------------------------------------------------
test("non-finite confidence does not count as improvement nor bump bestConfidence", () => {
  const prev = { round: 1, bestConfidence: 0, lastGapCount: 2, flatRounds: 0 };
  const r = computeDirective({ prevRun: prev, verdict: { recommendation: "rework", confidence: "n/a", gaps: ["a", "b"] } });
  // same gaps + unknown confidence => not improved
  assert.equal(r.improved, false);
  assert.equal(r.nextRun.bestConfidence, 0);
  assert.equal(r.nextRun.flatRounds, 1);
});

// --------------------------------------------------------------------------
// A full converging walk: rework -> rework(improve) -> accept
// --------------------------------------------------------------------------
test("converging walk terminates at STOP_ACCEPT", () => {
  let run = null;
  let r = computeDirective({ prevRun: run, verdict: rework(["a", "b", "c"], 0.3) });
  assert.equal(r.directive, "CONTINUE_REFINE");
  run = r.nextRun;
  r = computeDirective({ prevRun: run, verdict: rework(["a"], 0.5) });
  assert.equal(r.directive, "CONTINUE_REFINE");
  run = r.nextRun;
  r = computeDirective({ prevRun: run, verdict: accept() });
  assert.equal(r.directive, "STOP_ACCEPT");
  assert.equal(r.nextRun, null);
});

// --------------------------------------------------------------------------
// bestConfidence is monotonic (max), defaults wired through namespace export
// --------------------------------------------------------------------------
test("nextRun.bestConfidence never decreases", () => {
  const prev = { round: 1, bestConfidence: 0.8, lastGapCount: 2 };
  const r = computeDirective({ prevRun: prev, verdict: rework(["a"], 0.2) });
  assert.equal(r.nextRun.bestConfidence, 0.8);
});

test("hillclimb namespace re-exports the same functions and defaults", () => {
  assert.equal(hillclimb.runKey, runKey);
  assert.equal(hillclimb.computeDirective, computeDirective);
  assert.equal(hillclimb.pruneRuns, pruneRuns);
  assert.equal(hillclimb.HILLCLIMB_DEFAULTS.maxRounds, HILLCLIMB_DEFAULTS.maxRounds);
});

// --------------------------------------------------------------------------
// pruneRuns — TTL expiry + LRU cap
// --------------------------------------------------------------------------
test("pruneRuns drops records older than the TTL", () => {
  const now = 1_000_000;
  const runs = {
    fresh: { round: 1, lastTouched: now - 1000 },
    stale: { round: 1, lastTouched: now - (7 * 60 * 60 * 1000) }, // > 6h default
  };
  const out = pruneRuns(runs, { now });
  assert.ok(out.fresh);
  assert.equal(out.stale, undefined);
});

test("pruneRuns LRU-caps to maxRuns, keeping the most recently touched", () => {
  const now = 1_000_000;
  const runs = {};
  for (let i = 0; i < 5; i++) runs[`k${i}`] = { round: 1, lastTouched: now - i };
  const out = pruneRuns(runs, { now, maxRuns: 2 });
  assert.equal(Object.keys(out).length, 2);
  assert.ok(out.k0 && out.k1); // most recent (smallest offset)
  assert.equal(out.k4, undefined);
});

test("pruneRuns falls back to stoppedAt when lastTouched is absent", () => {
  const now = 1_000_000;
  const runs = { halted: { round: 4, terminal: "STOP_BUDGET", stoppedAt: now - 500 } };
  const out = pruneRuns(runs, { now });
  assert.ok(out.halted);
});
