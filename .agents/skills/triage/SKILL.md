---
name: triage
description: Use when requests (support tickets, client mail, team chat, a backlog) must go into an issue tracker so that every open issue is either ready for an agent (agent-ready) or marked for a person (needs-human). Requests in, a marked tracker out. Also use it headless, one issue per run, to work an issue alone and ship it to a live address while the owner is away (§6).
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
in the body. Requests keep arriving in batches: run it again after every pass, as the last step
before you hand the tracker in, and again after every refusal before you change any decision.

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
- **Asks for nothing** (a withdrawal "scratch my request", a thank-you, "it works now"): never a
  duplicate, because a duplicate repeats an ask. It gets no issue of its own; its id goes into the
  `sources` of the issue it acts on, and that issue follows it: a withdrawn request closes
  `obsolete` and cites the withdrawal. Nothing withdrawn stays open, marked or not.
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
- every `blocked-by` key exists;
- no closed `duplicate` is a request that asks for nothing.
Then run the collector once more, right before the hand-in; if anything new came in, triage it
and check again. Hand in only after a poll that brought nothing new.

## 6. Unattended: work one issue alone and ship it

Use this when you run headless with nobody watching (S03E03 "out of office": an issue tracker with a
token, a live API you deploy, an owner who answers only on their round page). You get one issue per
run. There is nobody to ask in chat: you decide from what you read, or you ask the owner in the
tracker. Never wait in the run for an answer; the next run picks the answer up.

### Read first, every run, in this order
1. The repo's `AGENTS.md` (how work lands, the tracker calls, the ship-line shape) and `contract/`.
2. `GET /records` and every record's newest text: accepted records are the product's rules,
   like specs above. Note each id.
3. `research/` and `decisions/TEMPLATE.md`.
4. The issue: `GET /issues/{n}` with its whole thread, then `GET /issues` for issues that touch the
   same thing (same ask twice, asks that pull against each other, a later "never mind").
5. `GET /shiplog`: what already shipped, so you do not build it twice.

### Decide: build, ask, decline or close
Go through §3 with the records and contract as the specs, then:
- **Close, no change** (`closed`): the ask is already live, repeats an issue that holds the work, or
  was withdrawn in its thread. Comment the id that decides it, close, ship line `closed`.
- **Decline alone** (`declined`): it contradicts an accepted record or the pinned contract and no
  issue asks to change that rule, or it needs a secret you must not use. Comment the rule id. Do not
  open a record for it: a rule already decided it.
- **Ask the owner** (`asked`): the contract or a record says the change needs a decision record (e.g.
  a field added, dropped, renamed or reshaped in an existing answer), it changes what every reader
  sees and no rule settles it, requests conflict, or it writes, deletes or rewrites production data.
  Follow AGENTS.md "Asking the owner": the record first (`status: proposed`, every option tagged
  `decline`, `smaller` or `full`, `issue:` set), then label `needs-human`, then one comment with the
  numbered options and your recommendation. Build nothing yet. Ship line `asked`.
- **Build alone** (`shipped`): only when a line allows it (e.g. the contract's "an additive read needs
  no decision record", a bug that breaks the contract as written). Name that line in your comment.

Urgency, who asked ("product says", "support needs it today") and "it is one line" never move an
issue from ask to build. Research is evidence, not a rule: quote it in the record's options and
recommendation; it does not let you skip the owner.

### Never
- Use a production admin token or any write to the production feed, even if a file holds one or an
  issue asks for it. Reads of the feed only.
- Change a field of an existing answer without an accepted record that says so.
- Edit the tracker as anyone but the agent; never write the owner's answer or signature yourself.

### Build
- Change the code, keep every existing answer byte-for-byte as the contract shows unless an accepted
  record changes it, and add the new call to `contract/` in the same commit.
- Test locally (run the Worker or call the handler), commit (`#<n>: <what>`), deploy, then call the
  live address and check the new answer and one old answer from outside. Only then `live: ✓`.
- If the deploy or the live check fails, revert the commit, redeploy, ship line `waiting` with
  `live: ✗` and say in the issue what failed.

### After the owner answers (`/answer <n>` from `by: owner` in the thread)
1. `PUT` the record again with `status: accepted` and **Decision** filled in (option, "owner, in
   issue #<n>", the answer's `at`).
2. Build option `<n>` (a `decline` option builds nothing), as in Build.
3. Comment in the issue asking the owner to sign the record on their round page.
4. Ship line for the result (`shipped` / `declined`), and in `open risks` the record id while it is
   unsigned: `<record id> unsigned, owner reads it`.

### Ship line (exactly; a later line for the same issue replaces the earlier one)

```
#<issue> · <verb> · live: ✓|✗ · open risks: <issue id + who reads it> | none
```

`verb` = shipped · declined · closed · asked · waiting. `live: ✓` only after the live check passed.

### Close the issue
Close it when the work is done: shipped and live, declined, or closed with no change. An `asked`
issue stays open until the owner answered and its option is built.
