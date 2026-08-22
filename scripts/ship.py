#!/usr/bin/env python3
"""Ship the shift's session to the Hugging Face dataset.

A shift leaves two things behind: the game, which the workflow commits, and the
conversation that made it, which zot wrote to a session log. The game is the
product; the conversation is the more interesting record - how a model designs,
writes, playtests and fixes a game from a standing order - and this is what
turns it into a dataset row.

    zot sessions export   ->  trajectory (chat-shaped conversation + outcome)
    + arcade metadata     ->  which game, which commit, did the catalogue pass
    -> uploaded           ->  trajectories/<session-id>/ in the dataset repo

Run after the commit step, with:

    HF_TOKEN      write token for the dataset repo        (required; skip if empty)
    HF_DATASET    dataset repo id, default openzot/arcade
    SESSION_DIR   where zot wrote the session logs          (the action's output)
    OUTCOME       the zot step's outcome: settled / failed / error / ''
    CHECK         scripts/check.sh step outcome: success / failure / ''
    COMMITTED     whether the shift landed on main: true / false
    SCRUB         a secret that must not appear in the upload (the provider key)

Every shift ships, finished or not: a shift cut short is continued by the next
one, whose trajectory carries the whole chain, so the dataset has both the
partial and the complete record. `complete` on the row tells them apart.
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATASET_DEFAULT = "openzot/arcade"
GAME_FILES = ("index.html", "game.css", "game.js")


def say(msg):
    print(f"ship: {msg}", flush=True)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def export(session_dir, out):
    """Render the last session as a trajectory, screenshots beside it."""
    cmd = ["zot", "sessions", "export", "last", "--session-dir", session_dir, "--out", str(out), "--snapshots"]
    subprocess.run(cmd, check=True)
    files = sorted(out.glob("*.jsonl"))
    if len(files) != 1:
        raise SystemExit(f"ship: expected one trajectory in {out}, found {len(files)}")
    return files[0]


def game_for(trajectory, outcome, committed):
    """The catalogue entry this shift produced, if it produced one.

    The order appends to games.json last, so a settled, committed shift's game
    is the final entry. Anything else is a shift that did not finish a game -
    the row still ships, with no game on it.
    """
    if outcome != "settled" or committed != "true":
        return None, {}
    try:
        games = json.loads((ROOT / "site/games.json").read_text(encoding="utf-8"))
    except Exception:
        return None, {}
    if not games:
        return None, {}
    game = games[-1]
    files = {}
    for name in GAME_FILES:
        path = ROOT / "site/games" / game.get("slug", "") / name
        if path.is_file():
            files[name] = path.read_text(encoding="utf-8", errors="replace")
    return game, files


def scrub_check(paths, secret):
    """Refuse to ship anything that carries the provider key.

    zot scrubs it from the agent's shell, so this should never trip - which is
    exactly why it is checked rather than assumed."""
    if not secret or len(secret) < 8:
        return
    for path in paths:
        if path.is_file() and secret.encode() in path.read_bytes():
            raise SystemExit(f"ship: refusing to upload - {path.name} contains the provider key")


def main():
    token = os.environ.get("HF_TOKEN", "")
    if not token:
        say("no HF_TOKEN; not shipping the session")
        return 0

    session_dir = os.environ.get("SESSION_DIR", "")
    if not session_dir or not Path(session_dir).is_dir():
        say(f"no session directory at {session_dir!r}; nothing to ship")
        return 0

    repo_id = os.environ.get("HF_DATASET") or DATASET_DEFAULT
    outcome = os.environ.get("OUTCOME", "")
    check = os.environ.get("CHECK", "")
    committed = os.environ.get("COMMITTED", "false")

    from huggingface_hub import HfApi

    api = HfApi(token=token)

    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "export"
        out.mkdir()
        path = export(session_dir, out)
        trajectory = json.loads(path.read_text(encoding="utf-8"))
        session_id = trajectory["id"]
        target = f"trajectories/{session_id}"

        # the cache restores earlier sessions too, so `last` can be a session a
        # previous shift already shipped - when zot never ran this time, say
        if api.file_exists(repo_id, f"{target}/{session_id}.jsonl", repo_type="dataset"):
            say(f"{session_id} is already in {repo_id}; nothing new to ship")
            return 0

        game, files = game_for(trajectory, outcome, committed)

        server = os.environ.get("GITHUB_SERVER_URL", "https://github.com")
        repository = os.environ.get("GITHUB_REPOSITORY", "")
        run_id = os.environ.get("GITHUB_RUN_ID", "")

        trajectory["arcade"] = {
            "repository": repository,
            "run": f"{server}/{repository}/actions/runs/{run_id}" if run_id else "",
            "commit": git("rev-parse", "HEAD") if committed == "true" else "",
            "outcome": outcome,
            "catalogue_check": check,
            "committed": committed == "true",
            "game": game,
            "files": files,
        }

        path.write_text(json.dumps(trajectory, ensure_ascii=False) + "\n", encoding="utf-8")

        scrub_check(list(out.rglob("*")), os.environ.get("SCRUB", ""))

        api.create_repo(repo_id, repo_type="dataset", exist_ok=True)

        label = game["name"] if game else f"work in progress ({outcome or 'no outcome'})"
        api.upload_folder(
            folder_path=str(out),
            path_in_repo=target,
            repo_id=repo_id,
            repo_type="dataset",
            commit_message=f"shift {session_id}: {label}",
        )

        say(f"shipped {session_id} ({len(trajectory['messages'])} messages, "
            f"{len(trajectory.get('images') or [])} images) to {repo_id}/{target}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
