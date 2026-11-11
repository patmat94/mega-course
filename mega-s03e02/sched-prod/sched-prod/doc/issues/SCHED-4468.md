---
key: SCHED-4468
title: "spacing: move hard-coded margins to the spacing scale"
status: open
labels: [agent-ready, from:product]
---

## Intent
Replace every margin and padding set in a component with the matching step of the 4 px spacing scale in the tokens (DES-3). Nothing visible changes.

## Acceptance
- Given the components, when a lint scans them, then no margin or padding outside the spacing scale is left.
- Given every page, when compared with screenshots taken before, then nothing visible changes.
- Given a value with no matching step, when found, then it is listed for design, not given a new step.

## Boundaries
- Must not add steps to the spacing scale.
- Must not change how anything looks.

Allowed by AUT-1 (bringing code in line with a rule in specs/ when nothing visible changes).

## Request as filed
Some components still set their own margins and padding. Move every one to the 4 px scale in the tokens (DES-3). Nothing visible changes. Until this ships, a denser layout cannot come from the spacing scale.
