---
key: SCHED-4468
title: "spacing: move hard-coded margins to the spacing scale"
status: open
labels: [from:product]
---

Some components still set their own margins and padding. Move every one to the 4 px scale in the tokens (DES-3). Nothing visible changes. Until this ships, a denser layout cannot come from the spacing scale.
