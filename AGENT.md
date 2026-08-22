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
