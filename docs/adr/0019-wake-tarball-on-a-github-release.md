# 0019 · wake also ships as a tarball on a GitHub Release

**Status:** accepted

## Context

ADR 0018 publishes `@patmat94/wake` to GitHub Packages. GitHub Packages' npm registry asks for a token even for a public package, so every consumer needs a classic personal access token with `read:packages`: on each PC, in CI, and in any hosted build. The consuming repo's Cloudflare Workers Builds (deploy on merge) kept failing with 401 on that token. mega-course is public, and a release asset of a public repo downloads with no token at all.

## Decision

1. `.github/workflows/wake-publish.yml` keeps publishing to GitHub Packages, then runs `npm pack` on the same build and attaches the tarball (`patmat94-wake-<version>.tgz`) to a GitHub Release named after the tag `wake-v<version>`. The workflow gets `contents: write` for that, with the built-in `GITHUB_TOKEN`; still nobody publishes from a PC.
2. Other repos install from the release URL, pinned by the tag in the URL and by the lockfile's integrity hash:
   `https://github.com/patmat94/mega-course/releases/download/wake-v<version>/patmat94-wake-<version>.tgz`
3. A release, like a package version, is never replaced: a fix is a new version and a new tag.
4. Points 1, 3, 5 and 6 of ADR 0018 stand. Its point 2 (install from GitHub Packages) becomes one of two ways; the release URL is the one that needs no token.

## Consequences

- No token on any PC, in CI or in a hosted build to install wake.
- The first release is `wake-v0.1.1` (same code as 0.1.0): a tag only triggers the workflow once, and 0.1.0 had no release.
- Bumping wake in a consuming repo means changing the URL in its `package.json`, not just a version number.

## Decided by

The human, 2026-11-18, in real-estate-research: "remove the token, go with the GitHub Release".
