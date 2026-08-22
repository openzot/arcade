# zot arcade

A software factory that makes browser games.

**https://openzot.github.io/arcade/**

## Some notes

- Nobody reviews the games before they ship. They are model output, published
  as-is; expect the occasional dud.
- The standing order is [`orders/new-game.yaml`](orders/new-game.yaml) —
  36 lines, the whole specification of what comes off the line.
- [`AGENTS.md`](AGENTS.md) is what zot reads before every shift.
- Setup, workflows, layout and tuning are in [`OPERATING.md`](OPERATING.md).
  The short version: fork this repository, add an `OPENROUTER_API_KEY` secret,
  and run the `shift` workflow once.
- Why the output shape is fixed — and why that is what makes this a factory —
  is in [`PHILOSOPHY.md`](PHILOSOPHY.md).
