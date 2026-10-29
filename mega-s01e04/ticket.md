# S01E04 · before i looked · what becomes true

## Outcome

A new public repo, made from the course template MEGA-DOT-DEV/rig-handover on the user's GitHub account, holds the team's plan turned into issues, and the plan is built there. The reviewer gets a public https link to an HTML copy of the page, first with the lane marker, later uploaded again without it. The course accepts a claim with `{repo, preview}`.

## Scope

- New public repo from template `MEGA-DOT-DEV/rig-handover` (user's account or an org they own).
- `plan.md`, notes and the handed-over skill inside that repo; the skill must run in this harness.
- GitHub issues in that repo, one per plan section the user approves.
- Build of the small service per the plan (agents may do the work).
- `.env` with `LANE_MARKER`; HTML copy of the page on the user's public web host.
- `claim-challenge` with the same answer each time.

## Out of scope

- Changing any repo the user already has (other than one made earlier for this Challenge).
- Putting real data on the public page: only the template's sample data and the marker.
- Committing `log.txt` or `receipts.json` to the repo.

## Acceptance

- [x] Repo is public, created from the template, user said yes first.
- [x] Issue split approved by the user; user decided what every issue must carry.
- [x] Every plan issue body opens with `Source: plan.md § <n>`.
- [x] Every plan issue has label `plan:morning-digest`.
- [x] `.env` has `LANE_MARKER` = laneMarker from receipts.json; `.env` not pushed.
- [x] Public preview is https, loads, and shows the marker (first upload).
- [x] Preview holds only template sample data plus the marker.
- [x] Re-upload without the marker had the user's yes first (when the course asks for it).
- [x] Claim answer: `repo` = owner/name, `preview` = https link; same every call.
- [x] #7 stays open until the reviewer has looked (AGENTS.md rule 5: closed only when Done when holds; leave open and say what it waits on).
- [x] #8 closed only after the re-upload without the marker is checked on the live link.
- [x] Every outside action (repo, issue, push, page upload) had the user's yes first.
- [x] Tickets and tokens are masked in `log.txt`; the raw ones are only in `receipts.json`.

## Notes

- "The reviewer gets to things when they get to them" (list-challenges description): expect delayed or staged reviewer feedback; re-call start-challenge when the course says things changed.
- Open: which web host the user will use for the preview.
- Open: gh CLI was blocked in earlier lessons (memory); fallback is browser + git.
- Claim 2 refused (2026-10-29): "you closed #7 before the reviewer looked". Closing on "link sent" was too early; the review is part of #7. Reopened #7 with a waits-on note.
