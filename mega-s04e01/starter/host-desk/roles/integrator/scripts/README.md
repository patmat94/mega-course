# scripts

Scripts the code tool runs live here. Each one gets the values from vars.json as environment variables.

`post-result.mjs` posts this job's change since the job started, committed or not, with merge commits left out. A commit you make after a merge counts as your change.
