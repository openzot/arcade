# The arcade

This repository is a demonstration: a software factory that ships one small
browser game every shift, unattended. You are the factory. Each run of
`orders/new-game.yaml` is one shift; the workflow commits whatever you leave
in the working tree and publishes `site/` to GitHub Pages.

## Layout

```
site/
  index.html        the catalogue page (reads games.json; do not edit)
  games.json        the catalogue - one entry per game, append only
  games/<slug>/
    index.html      one game, one self-contained file
scripts/check.sh    validates the catalogue; must exit 0 before a shift ends
orders/new-game.yaml  the standing order you are running
```

## What is on the machine

No need to go looking: the shift installs the toolbox before you start.

- `node` v22 and `python3`. There is no `package.json` here and there must not
  be one - the games are vanilla and dependency-free.
- **Playwright with headless Chromium**, plus `google-chrome` and `chromium` on
  `PATH`. `require('playwright')` resolves from any directory. Use it to open
  the finished game, press its keys, click its buttons and watch for uncaught
  exceptions, console errors and external requests before you call it done.
- `prettier --check <file>` parses the HTML *and* the inline script and style -
  the quickest way to catch a stray brace or an unclosed tag.
- `htmlhint <file>` for HTML structure; `quick-lint-js <script.js>` for
  undeclared variables and typos in JavaScript (extract the inline script to
  `/tmp` first).

Scratch files - test scripts, screenshots, extracted scripts - go in `/tmp`.
The workflow commits whatever is left in the working tree.

## The catalogue entry

Append exactly one object to the array in `site/games.json`:

```json
{
  "slug": "tide-keeper",
  "name": "Tide Keeper",
  "genre": "puzzle",
  "mechanic": "drag sandbags to redirect rising water",
  "theme": "a lighthouse on a sinking atoll",
  "tagline": "Hold back the sea for one more night.",
  "controls": "mouse / touch",
  "created": "2026-08-22"
}
```

- `slug` is lowercase `a-z0-9-`, unique, and is the directory name.
- `genre`, `mechanic`, `theme` are what uniqueness is judged on: a new game must
  not repeat an existing combination, and should differ on at least two of the
  three from every recent entry.
- `created` is today's date in UTC (`date -u +%F`).

Keep the JSON valid - trailing commas break the site.

## Conventions

- Vanilla HTML/CSS/JS in one file; no network requests; art drawn in code or
  embedded as data URIs; sound via Web Audio if any.
- Title and controls visible on screen; restart without reload; a relative
  link back to the catalogue (`../../`).
- Keep to the 60 fps `requestAnimationFrame` loop; pause when the tab is hidden.
- Mobile-friendly where the mechanic allows: touch controls, viewport meta.
- Do not touch other games, the catalogue page, the scripts, the order or the
  workflow. Do not run git commands that change history or the remote.
