---
change: Add a weekly digest email for every workspace
owner: lena-p
request: https://github.com/example-org/tasks/issues/41
date: 2026-10-26
status: accepted
chosen: 3
signed-by: lena-p · 2026-10-27 · https://github.com/example-org/tasks/issues/41#issuecomment-2001
---

# 0012 · Weekly digest email

## The change

Issue #41, from sam-sales: "Send every workspace a weekly digest email, on by default, so managers see progress without signing in." The owner of notifications is lena-p, named for `src/notifications/` in `CODEOWNERS`.

## Evidence

- `research/calls-2026-10.md:12` · compliment · A prospect said a weekly summary "would be really nice to have."
- `research/calls-2026-10.md:31-33` · claim · A customer said their managers "would read it every Monday."
- `support/exports-2026-10.csv:118` · behavior · One workspace exported its weekly task list by hand three times in six weeks.
- `analytics/email-2026-q3.md:9` · behavior · The monthly summary email we already send is opened by 6% of the people who get it.

Two lines are behavior: one workspace wants a weekly view enough to make it by hand, and few people open the summary email that exists. The rest is praise and a guess about managers.

## Options

| # | Option | What you build | Cost of being wrong | Undo |
|---|--------|----------------|---------------------|------|
| 1 | As asked | A weekly email to every member of every workspace, on by default. | Thousands of unwanted emails a week. Spam reports slow the delivery of sign-in and invite emails for everyone. | One-way in part: we can switch it off, but sent emails stay sent and spam reports stay on the sending domain. |
| 2 | Smaller | A "This week" panel on the workspace home page, for admins only, built from task data. No email. | About three days of work on a panel few people open. | Two-way: remove the panel. Nothing leaves the product. |
| 3 | Decline | Nothing now. Reply on #41 with a link to this record. | Managers who want a digest wait, and sales has one less thing to show. | Two-way: reopen at the threshold below. |

## Recommendation

Option 3, because the only behavior behind the request is one workspace exporting by hand (`support/exports-2026-10.csv:118`), people rarely open the summary email we already send (`analytics/email-2026-q3.md:9`), and option 1 can only partly be undone.

## Success metric

- Option 1: a quarter of digest emails opened in their first four weeks, from the email provider's report.
- Option 2: admins in 100 workspaces open the panel at least once a week by 2026-12-15, from product analytics.
- Option 3: none, nothing ships.

## Reopen threshold

Reopen if ten or more workspaces export their weekly task list by hand in one calendar month, counted with the same support report as `support/exports-2026-10.csv`.

## Owner's answer

- Asked: on #41, 2026-10-26, https://github.com/example-org/tasks/issues/41#issuecomment-1987
- Answer: "/answer 3. Agreed, not this quarter." From lena-p on #41, 2026-10-27, https://github.com/example-org/tasks/issues/41#issuecomment-2001

## What happened next

With its human's yes, the agent replied on #41 with a link to this record. It wrote no code for it, and left the issue open for lena-p to close.
