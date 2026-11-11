---
key: SCHED-4412
title: "colours: move hard-coded colours to design tokens"
status: open
labels: [from:product]
---

Components still carry raw hex values. Move every colour to the tokens in specs/design.md (DES-2). Nothing visible changes. Until this ships, a new colour scheme cannot be a token set: the raw values would not follow it.
