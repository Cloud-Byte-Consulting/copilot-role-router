# Semantic Versioning Guide

Version format: **`MAJOR.MINOR.PATCH`** (e.g. `1.2.3`)

---

## Decision Table

| What changed | Bump |
|---|---|
| Bug fix — broken behavior corrected | **PATCH** |
| Prompt / wording correction (no behavior change) | **PATCH** |
| Build, tooling, or CI-only change | **PATCH** |
| Internal refactor (same public surface) | **PATCH** |
| **Documentation update only** | **none — no version bump, no release** |
| New role added *(role-router)* | **MINOR** |
| New tool added | **MINOR** |
| New dashboard view or chart *(token-dashboard)* | **MINOR** |
| New optional parameter on existing tool | **MINOR** |
| New repeatable action pattern | **MINOR** |
| New event handler or hook | **MINOR** |
| Role removed or renamed | **MAJOR** |
| Tool name changed or removed | **MAJOR** |
| Required parameter added to existing tool | **MAJOR** |
| Extension ID or install path changed | **MAJOR** |
| State / log file format incompatible with prior version | **MAJOR** |
| Minimum Copilot SDK version bumped | **MAJOR** |

---

## Rules

### PATCH `x.x.Z`
Increment when you fix something without adding or removing any surface.
The user installs the update and nothing they relied on breaks or changes.

### MINOR `x.Y.0`
Increment (and reset PATCH to 0) when you add something new that is
backwards-compatible. Existing workflows keep working; new capabilities
are opt-in.

### MAJOR `X.0.0`
Increment (and reset MINOR + PATCH to 0) when existing users must change
how they use the extension after updating. Requires a migration note in
the release.

---

## How to bump

```bash
npm run bump patch    # x.x.Z → x.x.Z+1
npm run bump minor    # x.Y.x → x.Y+1.0
npm run bump major    # X.x.x → X+1.0.0
```

After bumping, build and release:

```bash
npm run build         # bakes new version into extension.mjs
npm run release       # commits build, tags vX.Y.Z, pushes → triggers GitHub Actions release
```

---

## Release flow

```
Edit code
  ↓
npm run bump [patch|minor|major]   ← updates package.json
  ↓
npm run build                      ← bakes VERSION into extension.mjs
  ↓
git add -A && git commit -m "..."  ← commit your changes
  ↓
npm run release                    ← tags + pushes → GitHub Actions creates the release
  ↓
GitHub Actions: builds, creates release, attaches extension.mjs
```

> **Rule of thumb:** if you're unsure between minor and patch, ask:
> *"Does this give users something they didn't have before?"*
> Yes → minor. No → patch.

> **Documentation rule:** updating README, VERSIONING.md, or any `.md` file is **not a version bump**.
> Commit and push the doc change directly — no `npm run bump`, no `npm run release`, no tag.
> CI is skipped automatically for docs-only pushes (see `paths-ignore` in `.github/workflows/ci.yml`).
