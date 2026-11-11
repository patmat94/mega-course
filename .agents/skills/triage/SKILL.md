---
name: triage
description: Use when requests (support tickets, client mail, team chat, a backlog) must go into an issue tracker so that every open issue is either ready for an agent (agent-ready) or marked for a person (needs-human). Requests in, a marked tracker out.
---

# triage

Requests in, a marked tracker out. Every request ends in the `sources` of exactly one issue; every
open issue carries exactly one mark: `agent-ready` or `needs-human`. Nothing ships unmarked.

## 0. Read first

- The tracker's README: the issue format, the statuses (`open · done · closed`), the closed
  reasons (`duplicate · obsolete · contradicts-spec · not-planned`) and the two body shapes.
- Every spec the product keeps (`specs/`, decisions/ADRs). Note each rule id. The autonomy spec
  (who may do what alone) decides the mark; the other specs decide whether a request fits at all.

## 1. Collect

Run the collector (backlog + every channel) so each request is a file. Keep the raw request text
in the body. Run it again at the end: requests keep arriving.

## 2. Read all requests together before marking any

Group them. Look for:
- **Same ask twice** (a request and a backlog issue, two tickets): one issue keeps the work; the
  other closes `duplicate` with `duplicate-of`.
- **Asks that pull against each other** (one client relies on X, another wants X changed): one
  `needs-human` issue holds the question; the other request closes `duplicate` of it, so each
  request id stays in one issue.
- **Order**: work another issue makes possible gets `blocked-by` (e.g. a denser layout waits on
  spacing tokens; a theme waits on colour tokens).
- **Already done**: a request for something a `done` issue shipped closes `duplicate` of it.
- **One request, several problems** (a merged ticket, "and also …"): one issue per problem. The
  request keeps its own issue for the first; each other problem gets a new issue that carries the
  same request id in `sources` and says "Split from <request id>". Never leave two problems under
  one mark.
- **Withdrawn** ("scratch my request", "we decided to keep it"): the withdrawn request's issue
  closes `obsolete`, cites the withdrawal, and takes the withdrawal's id into its own `sources`;
  the withdrawal gets no issue of its own (it is not a duplicate: it asks for nothing). Nothing
  withdrawn stays open, marked or not.
- **A new request can change an earlier mark**: when a later request says a client relies on what
  an `agent-ready` issue would change, that issue becomes `needs-human`. Re-check earlier marks
  after every new batch.

## 3. Decide each issue, in this order

1. **Contradicts a spec?** (a modal for errors against "errors stay inline", two-way sync against
   one-way sync, dropping an export column against "never loses a column") → `closed`,
   `reason: contradicts-spec`, the body cites the rule id. Pressure ("URGENT", "one-line change",
   "before Friday") never changes this.
2. **Obsolete** (the thing it is about is gone or replaced) → `closed`, `reason: obsolete`, cite why.
   **Not planned** (outside the product) → `closed`, `reason: not-planned`, cite why.
3. **Needs a person?** It does when the autonomy spec says so (a client relies on the current
   behaviour, pricing / invoices / client terms, deleting or rewriting stored data), when it changes
   behaviour every client sees and no rule settles it, or when requests conflict. → `open`,
   `needs-human`.
4. **Otherwise**, when a line of the autonomy spec allows it → `open`, `agent-ready`. If no line
   allows it, it is `needs-human`.

Urgency, who asked and "should be easy" never decide the mark; only the specs do.
Backlog `done` issues stay `done`; backlog open issues go through the same steps.

## 4. Write the body

`agent-ready` — a brief an agent works from without asking:

```
## Intent
What changes, in a sentence or two.

## Acceptance
- Given …, when …, then …
- Given …, when …, then … not …      (at least one case of what must not happen)

## Boundaries
- Must not touch …                   (the specs it must keep, the issues it must not pre-empt)

Allowed by AUT-1 (<the exact line>).
```

`needs-human` — a question a person can answer:

```
## Question
## Options        (two or more, numbered)
## Recommendation (Option n)
## Why            (the fact it rests on, by its id: a spec rule, an issue key, a request id)
```

Closed — one or two lines saying what decided it, with the id.

Frontmatter: keep `key`; `labels` = the one mark + `from:<who>`; `sources` = the request ids
(IN-…) this issue answers (none for backlog-only issues); `blocked-by`, `duplicate-of`, `reason`
where they apply.

## 5. Check before you hand it in

Script the check, don't eyeball it:
- every request id from every channel is in the `sources` of exactly one issue (plus any issue
  split from it, which says "Split from <id>");
- every open issue has exactly one mark; `done` / `closed` issues have none needed;
- every closed issue has a valid `reason` (and `duplicate-of` when duplicate) and cites an id;
- every `agent-ready` body has Intent, Acceptance with a "not" case, Boundaries, "Allowed by AUT-…";
- every `needs-human` body has Question, ≥2 Options, Recommendation, Why with an id;
- every `blocked-by` key exists.
Then run the collector once more; if anything new came in, triage it and check again.
