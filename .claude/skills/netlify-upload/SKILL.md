---
name: netlify-upload
description: Use when a MEGA Challenge needs a page or folder on a public HTTPS link, or needs a page uploaded again over the same link (a preview, a cleaned copy). Puts it on the user's Netlify with the signed-in Netlify CLI instead of asking the user to drag folders.
---

# netlify-upload

The Netlify CLI (`netlify`, installed globally with npm) is signed in to the user's Netlify account on this machine (set up 2026-10-29, S01E04). It uploads a folder to a site and gives back a public HTTPS link.

## Before every upload

A public upload is an outside action, so ask the user first, every time. Say what goes up, why, the link, who can see it (anyone with the link), and how to undo it (republish an older deploy on the site's Deploys page, or delete the site). The course's rule is the same as ours: no upload without a yes.

The page must be safe to be public. Check it for markers, tokens and real data before you ask.

## Steps

1. Put the files in a folder of their own, outside any repo, with the page as `index.html`.
2. Check the CLI is signed in: `netlify status` shows the user. If it isn't, run `netlify login` in the background and ask the user to click **Authorize** in their browser.
3. New site or same site:
   - **New site:** `netlify sites:create --name <name>`, or the first deploy without `--site`, which asks for one. Record the site id and the link in the lesson's `receipts.json`.
   - **Same site** (uploading over a link): get the id with `netlify api listSites` (fields `name`, `id`, `ssl_url`).
4. Deploy to production. A deploy without `--prod` only gets a draft link:

   ```powershell
   netlify deploy --prod --no-build --dir "<folder>" --site <site id> --message "<what and why>" --json
   ```

5. Check the live link the way the other side opens it, with a fresh request (`?v=<random>` against caches): status 200, HTML, byte-identical to the local `index.html`. Look for whatever must be on the page, or must not be (a marker).
6. Every deploy also gets its own permanent link, `https://<deploy id>--<site>.netlify.app`. On S01E04's site, older deploys' links returned 401 (not public). When a page must lose something, check the older deploys' links too: `netlify api listSiteDeploys --data '{"site_id":"<id>"}'`, then fetch each `deploy_ssl_url`.

## Sites so far

| Lesson | Site | Link |
|---|---|---|
| S01E04 | incredible-sherbet-1ca2e8 (`d85e5716-e621-4972-826c-e4c1a861296c`) | https://incredible-sherbet-1ca2e8.netlify.app |

## Undo

- An older version: on Netlify, Site → Deploys → pick the deploy → **Publish deploy**.
- The whole site: Site configuration → **Delete this site**. Ask the user first, because it is permanent.
- The CLI's access: `netlify logout`, or revoke it in Netlify under User settings → Applications.
