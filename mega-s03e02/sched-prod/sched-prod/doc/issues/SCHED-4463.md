---
key: SCHED-4463
title: "type: move hard-coded font sizes to the type scale"
status: open
labels: [agent-ready, from:product]
---

## Intent
Replace every font size set in a component with the matching step of the type scale in the tokens (DES-1). Nothing visible changes.

## Acceptance
- Given the components, when a lint scans them, then no font size outside the type scale is left.
- Given every page, when compared with screenshots taken before, then nothing visible changes.
- Given a size with no matching step, when found, then it is listed for design, not given a new step.

## Boundaries
- Must not add steps to the type scale.
- Must not change how anything looks.

Allowed by AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes).

## Request as filed
Some components still set their own font sizes. Move every size to the type scale in the tokens (DES-1). Nothing visible changes. Until this ships, a text-size setting cannot follow the type scale.
