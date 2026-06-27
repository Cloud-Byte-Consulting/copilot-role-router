// Shim: the implementation lives in the harness-agnostic shared core.
// Kept so the Copilot extension source tree (and its tests/build) is unchanged.
export * from "../../../../core/agent-dispatcher.mjs";
export { default } from "../../../../core/agent-dispatcher.mjs";
