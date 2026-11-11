#!/usr/bin/env bash
set -euo pipefail

primary_mirror=https://archive.ubuntu.com/ubuntu
fallback_mirror=https://mirror.math.princeton.edu/pub/ubuntu
packages=(
  libwebkit2gtk-4.1-dev build-essential curl wget file
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev
)
apt_env=(sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a)
network_options=(-o Acquire::Retries=1 -o Acquire::http::Timeout=12 -o Acquire::https::Timeout=12)

for mirror in "$primary_mirror" "$fallback_mirror"; do
  echo "Fetching Linux dependencies from $mirror"
  sudo python3 - "$mirror" "$fallback_mirror" <<'PYTHON'
from pathlib import Path
import re
import sys

mirror, fallback_mirror = sys.argv[1:]
archive_urls = re.compile(
    rf"(?:https?://(?:azure\.)?archive\.ubuntu\.com/ubuntu|{re.escape(fallback_mirror)})(?=[/\s]|$)"
)

# Hosted runners may use a mirror list, traditional sources, or deb822 sources.
sources = [Path("/etc/apt/sources.list"), Path("/etc/apt/apt-mirrors.txt")]
sources += list(Path("/etc/apt/sources.list.d").glob("*.list"))
sources += list(Path("/etc/apt/sources.list.d").glob("*.sources"))
for source in sources:
    if not source.is_file():
        continue
    text = source.read_text()
    updated = archive_urls.sub(mirror, text)
    if updated != text:
        source.write_text(updated)
PYTHON

  # Bound the network work on each mirror so both attempts fit in the CI step.
  # Fetch everything before installing so a timeout cannot interrupt dpkg.
  if "${apt_env[@]}" timeout --kill-after=5s 60s \
       apt-get "${network_options[@]}" update --error-on=any &&
     "${apt_env[@]}" timeout --kill-after=5s 100s \
       apt-get "${network_options[@]}" install -y --download-only "${packages[@]}"; then
    "${apt_env[@]}" apt-get install -y --no-download "${packages[@]}"
    exit 0
  fi

  echo "Could not fetch Linux dependencies from $mirror" >&2
done

echo "Both Ubuntu mirrors failed to supply the Linux dependencies." >&2
exit 1
