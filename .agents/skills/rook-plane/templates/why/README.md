# How to write a why-note

A why-note keeps the reason for one decision next to the code, in `why/<topic>.md` at the top of the project. Every role reads `why/*.md` at every start (`reads.json`), so a role that meets the decision knows it is on purpose before it judges or changes it.

One note per decision. Three parts, short:

```markdown
# Why the settings come from the API

**Decision:** every role reads `settings` from https://api.example.com/settings at its start; no role keeps a copy.

**Why:** the owner changes the settings without telling the roles. A copy is right on the day it is made, and wrong after the next change.

**So:** never paste a setting into a role's files. When one looks wrong, ask the owner; do not change it in the role.
```

- **Decision:** what was decided, in one sentence. Name each setting it covers in backticks (`` `model` ``, `` `API_TOKEN` ``): that is how `inspect.mjs` finds the why of a setting.
- **Why:** the reason, and what goes wrong without it.
- **So:** what a role does about it, and what it never does. No values in a note either: name the setting, not its number. Every role reads the notes at every start.

A setting's why can also sit right under it in `ROLE.md`, on a line that starts with `why:`. Use a note when the why is longer than a line, or when more than one role keeps the decision.

When a decision changes, change its note in the same change. A note that no longer holds is worse than none: delete it.
