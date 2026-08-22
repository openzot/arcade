# Operating the arcade

How this repository is wired: setup, the workflows, the layout, and what to
turn when you want it to behave differently. The factory itself — what it
makes and why the output shape is fixed — is in [README.md](README.md).

The model doing the work is `stealth/ox-alpha` via
[OpenRouter](https://openrouter.ai), through
[openzot/actions](https://github.com/openzot/actions).

## Run your own

1. Create a repository from this one (fork, or push a copy) - it must be
   public for free GitHub Pages, and Actions must be enabled.
2. Add one repository secret: **`OPENROUTER_API_KEY`**.
3. Run the `shift` workflow once from the Actions tab (or wait for the next
   half hour). The first run enables GitHub Pages for the repository; if your
   token is not allowed to, enable it once by hand: *Settings → Pages →
   Source: GitHub Actions*.

That is the whole setup. The site appears at
`https://<owner>.github.io/<repo>/`.

## How a shift works

```
shift  cron */30 ──▶ checkout ──▶ zot orders/new-game.yaml ──▶ git commit + push ──▶ dispatch pages
                                    (openzot/actions/run)       always, to main

pages  push to site/ ──▶ scripts/check.sh ──▶ deploy site/
       (or dispatch)      catalogue valid?    only if valid
```

- **The order never changes; the catalogue does.** `site/games.json` is the
  factory's memory. The order tells zot to read it first, list ten candidate
  concepts spanning different genres, mechanics and themes, discard anything
  resembling an existing entry, and build the most different one. Uniqueness is
  checked on `genre + mechanic + theme` and on the name.
- **One shift, one commit.** Whatever zot leaves in the tree is committed -
  `shift: <Game> - <tagline>` when the order settled, `shift: work in progress`
  when it was cut short. A game only appears on the site once it is in
  `games.json`, which the order says to do last, so an unfinished game is
  invisible until a later shift finishes it.
- **Shifts do not overlap.** A concurrency group makes a due shift wait for the
  running one. A shift that hits the 50-minute step timeout is committed as is,
  and because session logs are kept in the Actions cache, the next shift
  *continues that conversation* rather than starting a new game.
- **Every game has the same shape.** A game is exactly `index.html` +
  `game.css` + `game.js`, nothing else in the directory, no inline `<style>` or
  `<script>`. Splitting the three makes each shift faster: zot rewrites the
  game loop without re-emitting the stylesheet, and each file goes to the
  linter that understands it.
- **Publishing is not the shift's job.** `pages.yaml` deploys `site/` whenever
  anything lands on `main` under it - a shift's commit, a hand edit, a subtree
  push. The shift only makes the game and commits it, then dispatches the
  deploy. Keeping the two apart is deliberate: a shift that is cancelled or
  runs out of clock used to leave the site stale even though `main` already had
  the new game on it.
- **Only a valid catalogue is published.** `scripts/check.sh` verifies the JSON,
  that every listed game exists as that three-file set with no external
  requests, and that no two entries are the same game in disguise. `pages.yaml`
  runs it before every deploy and stops there if it fails, so a broken
  catalogue is still committed (the history is honest) but the live site keeps
  serving the last good tree, and the order tells the next shift to repair it.

## Layout

| Path | |
| --- | --- |
| `orders/new-game.yaml` | the standing order |
| `AGENTS.md` | conventions zot reads before every shift |
| `site/index.html` | the catalogue page (renders `games.json`) |
| `site/games.json` | the catalogue - append only |
| `site/games/<slug>/index.html` | one game: structure |
| `site/games/<slug>/game.css` | one game: style |
| `site/games/<slug>/game.js` | one game: behaviour |
| `scripts/check.sh` | catalogue validation |
| `.github/workflows/shift.yaml` | the shift - makes a game, commits it |
| `.github/workflows/pages.yaml` | publishes `site/` to GitHub Pages |

## Tuning

- **Cadence**: the `cron` in the workflow. Each shift costs one zot run of up
  to `max-iterations` rounds against the model you configure.
- **Model**: `provider` / `model` in the workflow; any OpenAI-compatible
  provider zot supports works, with its key as the secret.
- **Ambition**: the order's acceptance criteria. Raise them and shifts get
  longer and the games bigger; the default is tuned to "fun for two minutes".
- **Output shape**: the acceptance criteria again, but the structural ones -
  the three-file split, the size ceiling, the no-network rule. Change these and
  you have changed what the factory makes; `scripts/check.sh` has to agree, or
  nothing publishes.

## Safety

zot runs with shell access in the checkout, on a GitHub-hosted runner, with
only the provider key in its environment (zot scrubs it from the agent's shell).
The job's `GITHUB_TOKEN` is scoped to this repository. The order forbids
touching the workflow, the scripts or existing games; `scripts/check.sh` and
the commit history are how you would notice if it did.
