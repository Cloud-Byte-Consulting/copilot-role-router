#!/usr/bin/env node
/**
 * Build script: reads version from package.json, bundles the role-router
 * extension with bun, externalizing @github/copilot-sdk (runtime-resolved by CLI).
 *
 * Source:  .github/extensions/role-router/src/extension.mjs
 * Output:  .github/extensions/role-router/extension.mjs
 *
 * Usage:  npm run build
 */
import { spawnSync } from "node:child_process";
import { readFileSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const version = pkg.version;

console.log(`Building ${pkg.name} v${version}...`);

// Keep the deployed dispatch config in sync with the shared-core source of truth.
copyFileSync(
    join(ROOT, "core", "agent-dispatch-config.json"),
    join(ROOT, ".github", "extensions", "role-router", "agent-dispatch-config.json"),
);

const bunBin = process.platform === "win32" ? "bun.exe" : "bun";
const result = spawnSync(
    bunBin,
    [
        "build",
        ".github/extensions/role-router/src/extension.mjs",
        "--outfile", ".github/extensions/role-router/extension.mjs",
        "--target", "node",
        "--format", "esm",
        "--external", "@github/copilot-sdk",
        "--define", `__VERSION__="${version}"`,
    ],
    { stdio: "inherit", cwd: ROOT }
);

if (result.status !== 0) {
    console.error("Build failed.");
    process.exit(result.status ?? 1);
}

console.log(`✓  Built .github/extensions/role-router/extension.mjs  (v${version})`);
