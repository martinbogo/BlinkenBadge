# Security

Report vulnerabilities through [GitHub private vulnerability reporting](https://github.com/martinbogo/BlinkenBadge/security/advisories/new). Include the affected version, platform, reproduction steps, and impact. Do not post credentials or private files in public issues.

Security fixes target the latest release. The current development branch uses dependency audits, CodeQL, restricted desktop file commands, and content security policies. Hardware transport checks require a compatible badge; automated tests do not replace hardware verification.

The GTK `proc-macro-error` maintenance advisory is tracked in `BlinkenBadge/src-tauri/deny.toml`. Review the exception before January 27, 2027. Other vulnerability and unsoundness advisories fail CI.
