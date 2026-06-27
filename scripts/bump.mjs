#!/usr/bin/env node
/**
 * Semantic version bump script.
 * Usage:  node scripts/bump.mjs [major|minor|patch]
 *
 * Reads version from package.json, bumps the requested segment,
 * writes back, and prints next steps.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(ROOT, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));

const RULES = `
  PATCH  x.x.Z  Bug fix, prompt correction, docs, build/tooling only
  MINOR  x.Y.0  New role, new tool, new view/chart, new optional param
  MAJOR  X.0.0  Removed/renamed role or tool, breaking param change,
                extension ID changed, state format incompatible
`;

const bumpType = process.argv[2];

// Warn: docs-only changes should never reach bump.mjs
const docsOnly = process.argv[3] === "--docs-only";
if (docsOnly) {
    console.error(
        "\n  ✗ Documentation-only changes do not require a version bump.\n" +
        "    Commit and push the .md changes directly — no tag, no release.\n" +
        "    CI is automatically skipped for docs-only pushes.\n"
    );
    process.exit(1);
}

if (!["major", "minor", "patch"].includes(bumpType)) {
    console.error(`Usage: node scripts/bump.mjs [major|minor|patch]\n${RULES}`);
    process.exit(1);
}

const [major, minor, patch] = pkg.version.split(".").map(Number);

const next = {
    major: `${major + 1}.0.0`,
    minor: `${major}.${minor + 1}.0`,
    patch: `${major}.${minor}.${patch + 1}`,
}[bumpType];

pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

console.log(`\n  ${pkg.name}`);
console.log(`  ${bumpType.toUpperCase()} bump: ${pkg.version.replace(next, "?")} → ${next}\n`);
console.log(`  Next steps:`);
console.log(`    npm run build     # bakes v${next} into extension.mjs`);
console.log(`    git add -A && git commit -m "chore: bump to v${next}"`);
console.log(`    npm run release   # tags v${next}, pushes, triggers GH Actions\n`);
