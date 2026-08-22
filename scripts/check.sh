#!/usr/bin/env bash
# Validate the arcade catalogue: site/games.json is well formed, every listed
# game exists as one self-contained file with no external requests, and no two
# entries are the same game in disguise. Exit 0 when the site is publishable.
set -euo pipefail
cd "$(dirname "$0")/.."

python3 - <<'PY'
import json, os, re, sys

problems = []
def bad(msg): problems.append(msg)

try:
    with open("site/games.json", encoding="utf-8") as f:
        games = json.load(f)
except Exception as e:
    print(f"check: site/games.json is not valid JSON: {e}")
    sys.exit(1)

if not isinstance(games, list):
    print("check: site/games.json must be a JSON array")
    sys.exit(1)

required = ["slug", "name", "genre", "mechanic", "theme", "tagline", "controls", "created"]
slugs, names, combos = {}, {}, {}
external = re.compile(
    r"""(?:src|href|action|poster|data)\s*=\s*["']\s*(?:https?:)?//|url\(\s*["']?\s*(?:https?:)?//|"""
    r"""\bfetch\(\s*["'`](?:https?:)?//|\bimport\(\s*["'`](?:https?:)?//|^\s*import\s.*from\s*["'`](?:https?:)?//|"""
    r"""new\s+(?:WebSocket|EventSource|XMLHttpRequest|Audio|Image|Worker)\s*\(\s*["'`](?:https?:)?//""",
    re.I | re.M,
)

for i, g in enumerate(games):
    where = f"entry {i}"
    if not isinstance(g, dict):
        bad(f"{where}: not an object"); continue
    for k in required:
        if not isinstance(g.get(k), str) or not g[k].strip():
            bad(f"{where}: missing or empty field '{k}'")
    slug = g.get("slug", "")
    where = f"entry {i} ({slug or '?'})"
    if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
        bad(f"{where}: slug must be lowercase a-z0-9 with single dashes")
    if slug in slugs:
        bad(f"{where}: duplicate slug (also entry {slugs[slug]})")
    slugs[slug] = i
    name = g.get("name", "").strip().lower()
    if name in names:
        bad(f"{where}: duplicate name (also entry {names[name]})")
    names[name] = i
    combo = tuple(g.get(k, "").strip().lower() for k in ("genre", "mechanic", "theme"))
    if combo in combos:
        bad(f"{where}: same genre+mechanic+theme as entry {combos[combo]}")
    combos[combo] = i
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", g.get("created", "")):
        bad(f"{where}: created must be YYYY-MM-DD")

    d = os.path.join("site", "games", slug)
    page = os.path.join(d, "index.html")
    if not os.path.isfile(page):
        bad(f"{where}: {page} does not exist"); continue
    extra = [n for n in os.listdir(d) if n != "index.html"]
    if extra:
        bad(f"{where}: extra files in {d}: {', '.join(sorted(extra))}")
    size = os.path.getsize(page)
    if size > 150 * 1024:
        bad(f"{where}: {page} is {size // 1024} KB; keep a game under ~100 KB")
    with open(page, encoding="utf-8", errors="replace") as f:
        html = f.read()
    if "<html" not in html.lower():
        bad(f"{where}: {page} does not look like an HTML document")
    m = external.search(html)
    if m:
        bad(f"{where}: external request in {page}: {m.group(0).strip()!r}")
    if "../../" not in html:
        bad(f"{where}: {page} has no relative link back to the catalogue (../../)")

# games on disk that the catalogue does not list are fine (a shift in
# progress), but say so
listed = set(slugs)
on_disk = {n for n in os.listdir("site/games") if os.path.isdir(os.path.join("site/games", n))} if os.path.isdir("site/games") else set()
for s in sorted(on_disk - listed):
    print(f"check: note: site/games/{s} is not in the catalogue yet")

if problems:
    for p in problems:
        print(f"check: {p}")
    print(f"check: {len(problems)} problem(s)")
    sys.exit(1)

print(f"check: ok - {len(games)} game(s) in the catalogue")
PY
