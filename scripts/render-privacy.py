#!/usr/bin/env python3
"""Render the public privacy page from the notice bundled in mobile apps."""

import html
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
privacy = json.loads((root / "BlinkenBadge/src/mobile/privacy.json").read_text())
sections = "\n".join(
    f'<section><h2>{html.escape(s["title"])}</h2><p>{html.escape(s["text"])}</p></section>'
    for s in privacy["sections"]
)
page = f"""<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BlinkenBadge Privacy</title>
<style>
body {{ margin: 2rem auto; padding: 0 1rem; max-width: 44rem;
font: 1rem/1.6 system-ui, sans-serif; color: #17202a; background: #fff; }}
h1, h2 {{ line-height: 1.2; }} a {{ color: #174ea6; }}
</style>
<main>
<h1>BlinkenBadge Privacy</h1>
<p>Updated {html.escape(privacy["updated"])}.</p>
{sections}
<p>Contact Martin Bogomolni through the
<a href="https://github.com/martinbogo/BlinkenBadge/issues">BlinkenBadge repository on GitHub</a>.</p>
</main>
</html>
"""
(root / "docs/privacy.html").write_text(page)
