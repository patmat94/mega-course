# Evidence report · <product> · <flow or change>

<!-- Fill every <...>. Delete these comments before you send it. -->

| | |
|---|---|
| Date | <YYYY-MM-DD HH:MM, with the time zone> |
| Live URL | <https://...> |
| Build | <sha> · <match or mismatch> · checked at <HH:MM> with build-id.mjs |
| Recording | <the link your human chose> · <length as mm:ss> |
| Recorded with | record-flow.mjs · <browser> · <viewport> · pointer pause <ms> ms |
| Trace | <kept on this machine, or the link your human chose> |
| Owner | <who decides> |

## What I checked

<!-- One line per flow: what a person does, and what they should see at the end. -->

1. **<flow>** · <the steps in plain words> · a person should see <the end state>

## Findings

<!-- One block per finding, in the order they happen in the recording. -->

### F1 · <what goes wrong for the person, in a few words>

- **What:** <what a person sees>
- **When:** <mm:ss> in the recording, until <mm:ss> if it lasts
- **Where:** on screen, <the element, row id or text>. In the code, <file:line>, <read or suspected>
- **Why:** <the cause. Write "suspected" until you have read that code>
- **Evidence:** <the timeline.json entry at mm:ss, the trace action, the screenshot file>
- **Seen by:** <the timeline, the agent in the video, your human in the video>

## What works

<!-- Flows that did what the plan says, each with its time in the recording. -->

- **<flow>** at <mm:ss>: <what a person saw>

## Not tested

<!-- What a reader could assume you checked and you did not: other browsers, screen sizes, ways in. -->

- <what you did not check>

## Options for <owner>

<!-- Only when a finding needs a decision that the plan does not make. Build none of these before the owner answers. -->

| Option | What the person gets | What it costs or risks | What changes in the plan |
|---|---|---|---|
| A · <name> | <...> | <...> | <...> |
| B · <name> | <...> | <...> | <...> |

**Question for <owner>:** <the one thing the owner must decide>

<!-- Optional: one line with the option you would pick, and why. The owner decides. -->

## Build check

```text
<the output of build-id.mjs, run after the last deploy>
```

## Evidence block

<!-- For tools that read the report. The same facts as above, nothing new. -->

```json
{
  "url": "<https://...>",
  "sha": "<build>",
  "videoLink": "<https://...>",
  "findings": [
    { "id": "F1", "at": "<mm:ss>", "where": "<file:line>", "seenBy": "<who>" }
  ]
}
```
