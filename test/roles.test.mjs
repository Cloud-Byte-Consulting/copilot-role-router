import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMutating, SHELL_TOOLS } from "../core/roles.mjs";

describe("SHELL_TOOLS read-only enforcement", () => {
    it("classifies bash as mutating", () => {
        assert.equal(SHELL_TOOLS.has("bash"), true);
        assert.equal(isMutating("bash"), true);
    });

    it("classifies powershell as mutating", () => {
        assert.equal(isMutating("powershell"), true);
    });

    it("does not classify read tools as mutating", () => {
        assert.equal(isMutating("grep"), false);
    });
});
