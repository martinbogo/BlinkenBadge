#!/usr/bin/env bash
set -euo pipefail

# The Azure archive mirror has stalled individual package downloads on hosted runners.
# Use Ubuntu's official HTTPS archive; APT signature verification remains enabled.
sudo python3 - <<'PYTHON'
from pathlib import Path
sources = [Path("/etc/apt/sources.list")]
sources += list(Path("/etc/apt/sources.list.d").glob("*.list"))
sources += list(Path("/etc/apt/sources.list.d").glob("*.sources"))
for source in sources:
    if not source.is_file():
        continue
    text = source.read_text()
    updated = text.replace("http://azure.archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com/ubuntu")
    updated = updated.replace("https://azure.archive.ubuntu.com/ubuntu", "https://archive.ubuntu.com/ubuntu")
    if updated != text:
        source.write_text(updated)
PYTHON

# Keep mirror failures bounded, including downloads during package installation.
network_options=(-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30)
sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
  apt-get "${network_options[@]}" update
sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
  apt-get "${network_options[@]}" install -y \
    libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libudev-dev
