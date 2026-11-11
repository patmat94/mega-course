---
key: SCHED-4412
title: "colours: move hard-coded colours to design tokens"
status: open
labels: [agent-ready, from:product]
---

## Intent
Replace every raw hex, rgb or named colour in components with the matching `--color-*` token (DES-2). Nothing visible changes.

## Acceptance
- Given the components, when a lint scans them, then no raw hex, rgb or named colour is left.
- Given every page, when compared with screenshots taken before, then nothing visible changes.
- Given a colour with no matching token, when found, then it is not invented: the issue lists it for design instead.

## Boundaries
- Must not add new colour values to the palette.
- Must not change how anything looks.

Allowed by AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes).

## Request as filed
Components still carry raw hex values. Move every colour to the tokens in specs/design.md (DES-2). Nothing visible changes. Until this ships, a new colour scheme cannot be a token set: the raw values would not follow it.
