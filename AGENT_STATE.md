# Agent State and Developer Reference

This document records repository state, architectural boundaries, hardware specifications, signing credentials, and workflow procedures for future agents.

## Repository Information

| Parameter | Value |
|---|---|
| Project Name | BlinkenBadge (formerly Badge Studio) |
| Canonical Path | `/Users/martin/Development/BlinkenBadge` |
| Compatibility Symlink | `/Users/martin/Development/badge_studio -> /Users/martin/Development/BlinkenBadge` |
| Remote Repository | `git@github.com:martinbogo/BlinkenBadge.git` |
| Default Branch | `main` |
| Current Version | `1.0.41` |

## Directory Layout

| Path | Purpose |
|---|---|
| `BlinkenBadge/` | Main application root (desktop Tauri v2 and web frontend) |
| `BlinkenBadge/src/` | React/TypeScript UI: editor canvas, timeline, preview, transport |
| `BlinkenBadge/src/platform/` | Platform abstraction layer (`types.ts`, `tauri.ts`, `web.ts`, `wire.ts`, `webfont.ts`) |
| `BlinkenBadge/src-tauri/` | Rust Tauri v2 core: hardware protocols, USB HID, Bluetooth LE, file operations |
| `fonts/` | Source pixel fonts (`*.face`), `build.py` (Rust compiler), `webfont.py` (`fonts.json` compiler), `derive.py` |
| `web/` | Web distribution assets and standalone prototype |
| `docs/` | Application preview screenshots (`editor.png`, `animation.png`) |
| `scripts/` | Code signing helper scripts (`setup-macos-signing.sh`) |
| `.github/workflows/` | CI/CD pipelines (`checks.yml`, `release.yml`) |

## Local Toolchain and Build Commands

Use Rustup toolchain binaries explicitly to avoid Homebrew DYLD library conflicts:

```bash
export PATH="/Users/martin/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
```

### Running Tests

1. Run frontend tests:
   ```bash
   cd BlinkenBadge
   npm test
   ```
2. Run backend Rust tests:
   ```bash
   cd BlinkenBadge/src-tauri
   cargo test
   ```

### Building Application Targets

1. Run desktop development app:
   ```bash
   cd BlinkenBadge
   npm run tauri dev
   ```
2. Build desktop installers:
   ```bash
   cd BlinkenBadge
   npm run tauri build
   ```
3. Build web client:
   ```bash
   cd BlinkenBadge
   npm run build:web
   ```

## Hardware and Protocol Specifications

| Parameter | Specification |
|---|---|
| Microcontroller | WCH CH582 (RISC-V with integrated BLE) |
| Display Matrix | 44 x 11 monochrome LED |
| Buffer Limit | 8192 bytes total device memory (8128 bytes payload maximum) |
| Message Capacity | 8 slots (up to 8 animation frames per slot, 64 frames maximum total) |
| USB VID:PID | `0x0416:0x5020` (vendor-defined HID, 64-byte input/output reports) |
| BLE Service | `0000fee0-0000-1000-8000-00805f9b34fb` |
| BLE Characteristic | `0000fee1-0000-1000-8000-00805f9b34fb` (16-byte write-with-response) |
| Frame Advance | 48 px (stock firmware) or 44 px (badgemagic firmware) |
| Brightness Values | Bits 7:4 of header byte 5: `0x00` (100%), `0x10` (75%), `0x20` (50%), `0x30` (25%) |

Note: Header byte 5 uses a 4-entry table index in bits 7:4. Values of `0x40` and higher index out of bounds and corrupt display RAM.

## Code Signing Infrastructure

### macOS (Developer ID)

Signing and notarization run only in the macOS build step after checks and `release` environment approval. All signing credentials are required for official builds:

| Secret | Value Description |
|---|---|
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Martin Bogomolni (859Q7F7Z7F)` |
| `APPLE_ID` | Apple ID email address |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | `859Q7F7Z7F` |

Helper script: `./scripts/setup-macos-signing.sh --check`.

### Windows (Azure Artifact Signing)

Signing runs in the `sign-windows` job on `ubuntu-24.04` via the `release` GitHub environment:

| Setting | Value |
|---|---|
| Environment | `release` (restricted to `v*` tags and `main`) |
| Variables | `vars.AZURE_CLIENT_ID`, `vars.AZURE_TENANT_ID`, `vars.AZURE_SUBSCRIPTION_ID` |
| Authentication | OpenID Connect (OIDC) Workload Identity Federation (no secrets stored) |
| Azure Application | `lilykvm-ci-signing` |
| Role | Certificate Profile Signer |
| Endpoint | `wus.codesigning.azure.net` |
| Account / Profile | `lilykvm/lilykvm-public` |
| Publisher Identity | `CN=Martin Bogomolni, O=Martin Bogomolni, L=Portland, ST=or, C=US` |
| Timestamp Authority | `http://timestamp.acs.microsoft.com` (RFC3161) |
| Tool | `jsign 7.5` (`java -jar jsign.jar --storetype TRUSTEDSIGNING ...`) |
| Verification | Windows `Get-AuthenticodeSignature` with valid trust, publisher, and timestamp checks |

## Release Procedure

To cut a new release:

1. Update the version string across all five manifests:
   - `BlinkenBadge/package.json`
   - `BlinkenBadge/package-lock.json`
   - `BlinkenBadge/src-tauri/Cargo.toml`
   - `BlinkenBadge/src-tauri/tauri.conf.json`
   - Run `cargo check` in `BlinkenBadge/src-tauri/` to update `Cargo.lock`.
2. Verify all versions match:
   ```bash
   node -p "require('./BlinkenBadge/package.json').version"
   grep -m1 '^version' BlinkenBadge/src-tauri/Cargo.toml
   node -p "require('./BlinkenBadge/src-tauri/tauri.conf.json').version"
   ```
3. Merge the version change through a pull request with passing `checks` and `codeql` jobs.
4. Tag the merged commit on `main`:
   ```bash
   git switch main
   git pull --ff-only
   git tag -a v<version> -m "BlinkenBadge <version>"
   git push origin v<version>
   ```
5. Monitor `.github/workflows/release.yml` and approve signing in the `release` environment:
   ```bash
   gh run list --workflow=release.yml --limit 1
   gh run watch
   ```
6. Publish draft release:
   ```bash
   gh release edit v<version> --notes-file <path_to_notes.md> --draft=false --latest
   ```

## Documentation and Writing Style Guide

All repository documentation and UI text must strictly follow these rules:

1. Terse and plain: No filler, narrative, storytelling, or marketing tone.
2. Actionable details: Exact values, units, part numbers, file names, limits, and versions.
3. American English: `color`, `center`, `behavior`, `recognize`, `authorization`.
4. Formatting constraints: Zero em-dashes (U+2014). Zero emojis.
5. UI text: 1 to 3 words in Title Case for buttons and headings. One short sentence for messages.
6. Factual statements: State numbers; avoid subjective judgments.
7. Instructions: Numbered imperative steps, one action per step.
8. Reference data: Tables with explicit column headers.
9. Leading with the point: Put the reason after the instruction, briefly, only when needed.
10. Verification: Only document verified behavior. Mark estimates as estimates.

## Repository Protections

1. Require pull requests and successful `checks` and `codeql` jobs for `main`.
2. Deny force pushes and deletion of `main`.
3. Restrict `v*` tag creation to administrators and deny tag changes or deletion.
4. Require maintainer approval before release signing; permit self-approval for this single-maintainer repository.
5. Keep Dependabot alerts, security updates, secret scanning, push protection, and private vulnerability reporting enabled.

Versioned ruleset definitions are in `.github/rulesets/`. The GTK maintenance exception in `BlinkenBadge/src-tauri/deny.toml` must be reviewed before January 27, 2027. Do not ignore vulnerability or unsoundness advisories.
