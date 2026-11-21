# S04E05 · Make me another · what becomes true

## Outcome

The Host Desk's factory (`factory/make-a-role/`, from the course's factory zip) made a new role, `refund-runner`, from the owner's one line: "Make refund-runner: pay the refunds owed after the S04E04 night, following the host's refund policy." The role passed practice, then the course's run on cases the factory had not seen. Every refund it parked was decided by the human and finished once. Where the role fell short, the factory was fixed and the role made again, not the role patched by hand.

**Who it is for / how we'd know it helped:** the host and the human as owner. Each refund owed gets paid once, at the amount the live refund policy gives (0 refunds paid twice, 0 wrong amounts). Only the calls that are the owner's get parked, and none sits undecided. No secret leaves its host. The next role made from a line starts with the week's rules already in it, so its first practice needs no hand fix to the role. I set these limits; the human may change them.

## Scope

- Factory zip unpacked in `mega-s04e01/starter/host-desk/` (after the human's yes to the download).
- Host Desk vars: `TICKET` (start-challenge), `ATTEMPT` (manual), task tokens from practice/run.
- The course API at https://hq.mega.dev/challenges/make-me-another/api: manual, settings, practice, run.
- Fixes go into `factory/` (its checklist and make-a-role), then the role is made again.
- The role runs on the human's Anthropic key (Pi, from S04E01).

## Out of scope

- The day-5 zip: S04E01–S04E04 are solved here, so the desk already has those fixes.
- Hand edits to `roles/refund-runner/` that the factory would not make.

**Boundaries:** no download, install or spend without the human's yes; the human decides every parked refund; secrets bound to their hosts on every redirect hop (wire.mjs, S04E01); keys never in a commit or in log.txt.

**Fails if:** a refund is paid twice or at the wrong amount; a parked refund is left undecided or finished twice; the role was patched by hand instead of through the factory; a secret reaches a host it is not listed for.

## Acceptance

- [x] The manual was read before any send, and each body matches its shape and field types (numbers as JSON numbers). · evidence: log.txt:18, log.txt:20, log.txt:58
- [x] `refund-runner` was made by `factory/make-a-role/` from the owner's line, and any fix went into the factory, then the role was made again. · evidence: log.txt:21, log.txt:53, log.txt:67, mega-s04e01/starter/host-desk/factory/make-a-role
- [x] The role reads its facts (refund policy, settings) from their sources at start, not from values written into it (ADR 0017). · evidence: mega-s04e01/starter/host-desk/roles/refund-runner/reads.json, log.txt:57
- [x] One real post through the role's own script runner reached the course before the first run (ADR 0020). · evidence: log.txt:29
- [x] Practice passed (course reply says so). · evidence: log.txt:55
- [x] The course's run passed (course reply says so). · evidence: log.txt:57, log.txt:70
- [x] Every parked refund was decided by the human and finished once; read back from the course. · evidence: log.txt:70, log.txt:71
- [x] Each receipt was written to a file on arrival. · evidence: course.jsonl, mega-s04e01/starter/host-desk/state/run-refund-runner-2026-11-21T08-55-48-240Z.jsonl
- [x] Every outside action (download, install, spend) had the user's yes first. · evidence: log.txt:14
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`. · evidence: receipts.json
- [ ] claim-challenge returns solved (after claim)

## Notes

- Expected next lesson per the CLAUDE.md table: S04E05; it matches (2026-11-21).
- `next` says a refusal may end with a pointer: call check-lane with the need it names.
