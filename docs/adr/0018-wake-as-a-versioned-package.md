# 0018 · lib/wake as a versioned package for other repos

**Status:** accepted

## Context

ADR 0009 point 1 says each Worker imports `lib/wake/` by relative path. That works only inside mega-course. Another of the human's repos needs the same wake path (its issue #11; #22 outbox and #33 inbox webhook wait on it), and that repo's own ADR 0003 chose to take it as a versioned npm package from GitHub Packages. Copying the folder is not an option: copies drift (ADR 0009, AGENTS.md § Skills).

## Decision

1. Inside mega-course nothing changes: Workers here still import `lib/wake/` by relative path, so a change is tested against them at once.
2. Other repos install it as `@patmat94/wake` from GitHub Packages (`https://npm.pkg.github.com`), pinned to an exact version. They never copy the source.
3. The package is built from `lib/wake/` only: `tsc` turns the `.ts` sources into `dist/*.js` plus `.d.ts`, and only `dist/` and `WAKE.md` ship. Reason: Node refuses to strip types from `.ts` files under `node_modules`, so a consumer's tests could not import raw sources.
4. Only the GitHub Actions workflow `.github/workflows/wake-publish.yml` publishes, with the repo's built-in `GITHUB_TOKEN` (`packages: write`). It runs on a tag `wake-v<version>` that must equal `version` in `lib/wake/package.json`, and runs the tests and the type check first. Nobody publishes from this PC, so no personal token can write packages.
5. Versions follow semver. A change to anything in WAKE.md § Exports, or to its behaviour, bumps at least the minor version while below 1.0.
6. Points 2–6 of ADR 0009 stand unchanged.

## Consequences

- Installing needs a read token even for a public package: a classic personal access token with `read:packages` in the user's `~/.npmrc` on each PC, never in a repo. CI in a consuming repo gets read access from the package's "Manage Actions access" setting, or a secret.
- Cloudflare needs no token: wrangler bundles the package into the Worker at build time.
- A consuming repo gets fixes only when it bumps its pinned version.

## Decided by

The human, 2026-11-17: "I want to publish package for other project", then "Yes, publish" to this file, the push to main and the tag wake-v0.1.0.
