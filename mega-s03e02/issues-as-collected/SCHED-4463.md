---
key: SCHED-4463
title: "type: move hard-coded font sizes to the type scale"
status: open
labels: [from:product]
---

Some components still set their own font sizes. Move every size to the type scale in the tokens (DES-1). Nothing visible changes. Until this ships, a text-size setting cannot follow the type scale.
