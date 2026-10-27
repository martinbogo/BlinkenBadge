"""Expire documented upstream maintenance exceptions instead of hiding them forever."""
from datetime import date, datetime, timezone
from pathlib import Path
import re

config = Path("BlinkenBadge/src-tauri/deny.toml").read_text()
match = re.search(r"^# Review deadline: (\d{4}-\d{2}-\d{2})$", config, re.MULTILINE)
if not match:
    raise SystemExit("Missing advisory exception review deadline.")
if datetime.now(timezone.utc).date() >= date.fromisoformat(match[1]):
    raise SystemExit("Advisory exceptions need review; update dependencies before extending them.")
print(f"Advisory exceptions require review before {match[1]}.")
