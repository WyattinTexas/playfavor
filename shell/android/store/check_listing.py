#!/usr/bin/env python3
"""Asserts listing/en-US.md carries the Apple copy VERBATIM (the no-second-copy
law, single-locale edition) and that Play's caps hold. Run after any edit to
shell/store/favor_store.py, then fix the .md by re-deriving, never by hand-editing
the strings themselves."""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, "../../store")))
os.environ.setdefault("FAVOR_STORE_IMPORT_ONLY", "1")

# favor_store.py imports jwt/requests at module top; stub them so the copy
# constants import anywhere (this checker never talks to the API).
import types
for stub in ("jwt", "requests"):
    if stub not in sys.modules:
        sys.modules[stub] = types.ModuleType(stub)

import favor_store as fs

md = open(os.path.join(HERE, "listing/en-US.md"), encoding="utf-8").read()

TITLE = "FAVOR: Royal Succession"
full = fs.PROMO + "\n\n" + fs.DESCRIPTION

checks = [
    ("title present", TITLE in md),
    ("title cap 30", len(TITLE) <= 30),
    ("short = Apple subtitle verbatim", fs.SUBTITLE in md),
    ("short cap 80", len(fs.SUBTITLE) <= 80),
    ("full = promo + blank + description verbatim", full in md),
    ("full cap 4000", len(full) <= 4000),
]

notes = re.search(r"## Release notes.*?\n\n(.+?)\n?$", md, re.S)
checks.append(("release notes present", bool(notes)))
if notes:
    checks.append(("notes cap 500", len(notes.group(1).strip()) <= 500))

fails = [n for n, okay in checks if not okay]
for n, okay in checks:
    print(("  ✓ " if okay else "  ✗ ") + n)
print(f"counts: title {len(TITLE)}/30 · short {len(fs.SUBTITLE)}/80 · full {len(full)}/4000"
      + (f" · notes {len(notes.group(1).strip())}/500" if notes else ""))
sys.exit(1 if fails else 0)
