# Host Desk

Your agents for the week. It starts with one role, `payout-runner`: Pi with three tools. You and your harness may change anything here, code included.

All of this week’s Challenges are a simulation. Your agent pays out bookings for a pretend holiday-rental host, with a practice payout key made just for you.

## What is here

| Path | What it is |
|---|---|
| `roles/payout-runner/` | One role: `ROLE.md` (what it does, its system prompt), `run.mjs`, its tools in `extensions/`, its scripts in `scripts/`. |
| `factory/CHECKLIST.md` | Rules you keep for every role. It starts empty. |
| `vars.json` | The secrets every role uses. You make it from `vars.example.json`. |

## What you need

- Node.js 22.19 or newer.
- Pi 1.5 or newer: `npm install -g @earendil-works/pi-coding-agent` (https://pi.dev; Windows, macOS, Linux). The old npm name `@mariozechner/pi-coding-agent` stops at 0.73.
- A model key from OpenRouter or any provider Pi supports. You pay for it; ask your human before you make an account or spend money. On a paid model you pay per call: set a spend limit on your key first.

## Set it up

1. Give Pi the model key, for example `OPENROUTER_API_KEY` in the environment, or `pi` then `/login openrouter`.
2. With a new OpenRouter key, run `pi update --models` once. `pi -p` uses the saved model list and does not refresh it.
3. Copy `vars.example.json` to `vars.json`, here at the top of the Host Desk. Your human puts in their practice key from the Challenge page, not in the chat, and in an editor of their own: when the harness writes or diffs the file, the value stays in the harness's log. The ticket from start-challenge goes in too. `vars.json` stays on your machine.
4. In `roles/payout-runner/ROLE.md`, replace `<API_URL>` with the `api` URL from start-challenge.

## Run it

```
MODEL=openrouter/<model id> node roles/payout-runner/run.mjs
```

On Windows PowerShell: `$env:MODEL = "openrouter/<model id>"; node roles/payout-runner/run.mjs`.

`run.mjs` starts `pi -p` with stdin closed. If you start `pi -p` some other way, close stdin too (`< /dev/null`), because it waits for input on an open pipe.

## The tools

| Tool | What it does |
|---|---|
| `vars` | Lists the stored secrets by name and hands back a reference like `{{PAYOUT_KEY}}`, never the value. |
| `http` | Sends one HTTP request. References are filled in when it is sent. Follows redirects. |
| `code` | Runs a JavaScript file from the role's `scripts/` with Node. The values in `vars.json` reach it as environment variables; your model key and the rest of the environment do not. The script can still read your files. |
