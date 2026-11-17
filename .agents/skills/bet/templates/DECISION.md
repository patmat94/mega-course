---
change: <the change, in one line>
owner: <handle of the person who decides>
request: <link to the issue, or "chat" and the date>
date: <YYYY-MM-DD, the day you wrote this record>
status: proposed
chosen:
signed-by:
---

<!--
Save in the records folder as NNNN-short-name.md, with the next free number.
status: proposed until the owner answers, then accepted. Superseded once a newer accepted record replaces it.
chosen: empty until the owner answers, then the number of the option they picked.
signed-by: empty until the owner answers, then: owner · YYYY-MM-DD · link to their answer, "chat", or "chat relayed" when your human passed it on.
Only the owner's own answer signs the record. You never sign it, and neither does a bot account.
Check it from the project folder: node <skill folder>/scripts/check-decision.mjs decisions/NNNN-short-name.md
-->

# <NNNN> · <short name>

## The change

<What is asked and who asked, in one or two sentences. Quote the key words of the request. Name the owner and where the project names them.>

## Evidence

<!--
One bullet per source: file:line, a tag, and what it shows in one sentence.
Tags: behavior (something people did), compliment (praise or interest), claim (what someone says they or others would do).
If no bullet is behavior, say so in one line under the list.
-->

- <file>:<line> · <behavior, compliment or claim> · <what it shows>

## Options

<!--
At least three. Keep Smaller and Decline.
Undo: "Two-way:" and how you would undo it, or "One-way:" and what stays after you undo it, such as data written, messages sent or a public promise.
-->

| # | Option | What you build | Cost of being wrong | Undo |
|---|--------|----------------|---------------------|------|
| 1 | As asked | <the request as written> | <who is hurt and how, if this is the wrong call> | <Two-way or One-way, and how> |
| 2 | Smaller | <the smallest version that still answers the request> | <who is hurt and how> | <Two-way or One-way, and how> |
| 3 | Decline | Nothing now. Reply on the request with a link to this record. | <what waiting costs, and who pays it> | Two-way: reopen at the threshold below. |

## Recommendation

Option <number>, because <one sentence that cites an evidence line or a cost above>.

## Success metric

<!-- Before anything ships: for each option that builds something, what you will look at, where, and the number by a date that means it works. -->

- Option 1: <what, where, the number and the date>
- Option 2: <what, where, the number and the date>
- Option 3: none, nothing ships.

## Reopen threshold

<The result that would reopen this decision, and where it will show.>

## Owner's answer

<!-- Fill in Asked when you ask. Replace "waiting" only with the owner's own words and their number in double quotes, then who wrote them, where, when and a link, on one line, as: "/answer 2. Their words." From owner on #41, YYYY-MM-DD, link -->

- Asked: <where and when you asked, with a link>
- Answer: waiting
