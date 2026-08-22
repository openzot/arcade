#!/usr/bin/env python3
"""Rebuild the files a zot run wrote, from its session log.

A session log is JSON Lines: one record per line, `kind` saying what it is. The
ones that matter here are messages carrying an `activity` - a tool call, with its
arguments as a JSON string. Replaying every write in order reconstructs what the
run left on disk, which is the only copy left when a run was torn down before it
could push.

The replay mirrors agent/tools.go's write handler exactly, including its second
form: with startLine, a write splices lines into the existing file rather than
replacing it, and treating that as a whole-file write would silently truncate a
game to its last patch.

Deliberately tolerant. A log may be truncated mid-line if the run was killed, and
half a game is worth more than a stack trace.
"""

import argparse
import json
import pathlib
import sys


def activities(path):
    """Yield (name, args) for every recorded tool call, in order."""
    with open(path, encoding="utf-8", errors="replace") as handle:
        for number, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue

            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                print(f"  ! line {number}: not JSON (truncated log?), skipped", file=sys.stderr)
                continue

            activity = (record.get("message") or {}).get("activity")
            if not isinstance(activity, dict) or not activity.get("name"):
                continue

            raw = activity.get("arguments") or "{}"

            try:
                args = json.loads(raw) if isinstance(raw, str) else raw
            except json.JSONDecodeError:
                continue

            if isinstance(args, dict):
                yield activity["name"], args


def as_int(args, key):
    """The argument as an int, or None. Models send numbers as strings often
    enough that refusing one would lose a file for a formatting nicety."""
    value = args.get(key)

    if isinstance(value, bool) or value is None:
        return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def apply_write(files, args):
    """Apply one write to the in-memory tree, as agent/tools.go would to disk."""
    path = args.get("path")
    content = args.get("content")

    if not path or not isinstance(content, str):
        return None

    start = as_int(args, "startLine")

    # no startLine: the whole file is replaced
    if start is None:
        files[path] = content
        return path

    # splice form: replace lines [startLine, endLine] with content
    lines = files.get(path, "").split("\n")

    start = max(1, min(start, len(lines) + 1))

    end = as_int(args, "endLine")

    if end is None or end < start:
        end = start - 1

    end = min(end, len(lines))

    files[path] = "\n".join(lines[: start - 1] + content.split("\n") + lines[end:])

    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("session", help="path to the .jsonl session log")
    parser.add_argument("--out", default="salvaged")
    parser.add_argument("--only", default="", help="only paths containing this substring")
    args = parser.parse_args()

    files, order, shells = {}, [], []

    for name, call in activities(args.session):
        if name == "shell":
            command = call.get("command")

            if command:
                shells.append(command)

            continue

        if name != "write":
            continue

        if args.only and args.only not in str(call.get("path", "")):
            continue

        path = apply_write(files, call)

        if path and path not in order:
            order.append(path)

    out = pathlib.Path(args.out)

    for path in order:
        # a path from a log is data, not a destination: keep it inside --out
        target = (out / path.lstrip("/")).resolve()

        if not str(target).startswith(str(out.resolve())):
            print(f"  ! refusing to write outside {out}: {path}", file=sys.stderr)
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(files[path], encoding="utf-8")
        print(f"  recovered {path} ({len(files[path])} bytes)")

    if shells:
        out.mkdir(parents=True, exist_ok=True)
        (out / "_shell-commands.txt").write_text("\n\n#---\n\n".join(shells), encoding="utf-8")
        print(f"  recorded {len(shells)} shell command(s) -> _shell-commands.txt")

    if not order:
        print("  nothing recovered", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
