# Outcome

The Host Desk factory (`mega-s04e01/starter/host-desk/factory/`) made `refund-runner` from the owner's line. The fixes went into the factory, never into the role folder:

- `CHECKLIST.md` holds 12 house rules with their sources.
- The template has the parts every role shares: a host-bound http tool and `hosts.json`, `wire.mjs`, a start through rook-plane, and a generic `tasks.mjs`/`finish.mjs`.
- The job's own rule is `make-a-role/jobs/refund-runner.mjs`, with a test.

One claim, solved: "the role your factory made passed the course's run, and every parked refund was decided and finished once."

Practice took seven tries, all on one attempt. Each refusal was fixed in the factory:

1. Unknown refund fields made the rule flag every task.
2. An answer must carry a payout receipt.
3. The refund with a note was paid. The note asked to add a host to the key's list, which is the owner's call.
4. Reusing the first task's receipt was refused.
5. Paying 0 for a repeat was "wrong answer".
6. The note was paid again.
7. Passed, with the repeat and the noted refund flagged.

The run: 14 refunds were paid once each and 6 were parked. You decided all six (2 paid: 64 € and 354 €; 4 declined), and each was finished once. The payout key went only to pay-s04.mega.dev; a 307 to cdn-s04 was stopped at the hop. That meets the "Who it is for" line: 0 refunds paid twice, every amount accepted, every parked refund decided.

For the next lesson:

- The course names a wrong answer at once ("Task n: wrong answer"). A refusal at the end means a flag or a missing flag.
- A repeat (same refund id, same data) is flagged for the owner, never paid again.
- A made role takes `practice`, `run` or `finish`.
- The Host Desk factory changes are not committed in the Host Desk repo.
