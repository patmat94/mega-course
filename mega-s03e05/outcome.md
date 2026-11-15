# Outcome

Two claims went in through claim-challenge. Batch 1 had 7 groups, the owner's pick "Option 1: hold" with the owner code, and the rule "check one replay or call against the event log before reading a success metric". Batch 2 had 2 groups: auto-close revert (agent) and bulk acknowledge expand (owner). Both bodies are in step1-draft.json and step2-draft.json.

Claim 1 took three tries. Try 1 cited no place inside each signal and had no group for the status page's release gate, which ran on ci-2159 with "diff: none". Try 2 still quoted the suggestions replays from frames taken seconds apart. Try 3 quoted the admin tab word for word from a 0.1 s frame scan and passed. Claim 2 passed first time, because the kept rule sent the harness to the replays, where it found the sched-desk tickets.

Against the "Who it is for" line: 0 uncited groups, and 1 owner decision with effort and a recommendation, within the limit of 3.

For the next lesson: replays hide 1.4 s tab flashes that frames a few seconds apart miss, so scan a canvas diff every 0.1 s in the built-in browser. Transcription runs only through tool-home, and the uploaded calls are still at public links there. The kept rule is now in AGENTS.md and docs/adr/0015. There is no decide skill yet.
