#!/usr/bin/env python3
"""Build BlinkenBadge beta artifacts with explicit store build numbers; never upload."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "BlinkenBadge"
SIGNING = (
    "BLINKENBADGE_ANDROID_KEYSTORE", "BLINKENBADGE_ANDROID_KEY_ALIAS",
    "BLINKENBADGE_ANDROID_KEYSTORE_PASSWORD", "BLINKENBADGE_ANDROID_KEY_PASSWORD",
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("platform", choices=("ios", "android"))
    parser.add_argument("--build-number", required=True, type=int)
    parser.add_argument("--unsigned", action="store_true", help="Produce validation artifacts without distribution signing.")
    args = parser.parse_args()
    if not 1 <= args.build_number <= 2_100_000_000:
        parser.error("Build number must be between 1 and 2100000000.")
    if args.platform == "ios" and args.build_number > 9999:
        parser.error("The single-component iOS build number must be at most 9999.")
    env = os.environ.copy()
    env.setdefault("CARGO_BUILD_JOBS", "4")
    rust = Path.home() / ".rustup/toolchains/stable-aarch64-apple-darwin/bin"
    if rust.is_dir():
        env["PATH"] = str(rust) + os.pathsep + env["PATH"]
    config = {"identifier": "com.martin.blinkenbadge", "productName": "BlinkenBadge"}
    cmd = ["npm", "run", "tauri", "--", args.platform, "build", "--ci"]
    if args.platform == "ios":
        config["bundle"] = {"iOS": {"bundleVersion": str(args.build_number)}}
        env.setdefault("APPLE_DEVELOPMENT_TEAM", "5QAGYV54MK")
        cmd += ["--target", "aarch64"]
        # Export separately with the store profile, without registering devices
        # or depending on Xcode's automatic signing/account session.
        cmd += ["--no-sign", "--archive-only"]
    else:
        config["bundle"] = {"android": {"versionCode": args.build_number}}
        sdk = Path(env.setdefault("ANDROID_HOME", str(Path.home() / "Library/Android/sdk")))
        env.setdefault("NDK_HOME", str(sdk / "ndk/28.2.13676358"))
        if sys.platform == "darwin":
            env.setdefault("JAVA_HOME", "/Applications/Android Studio.app/Contents/jbr/Contents/Home")
        if args.unsigned:
            for key in SIGNING:
                env.pop(key, None)
        elif not any(env.get(key) for key in SIGNING) and sys.platform == "darwin":
            key = Path.home() / ".config/blinkenbadge/signing/upload.p12"
            if key.is_file():
                password = subprocess.run(
                    ["security", "find-generic-password", "-s", "com.martin.blinkenbadge.android-upload",
                     "-a", "upload", "-w"], capture_output=True, text=True,
                )
                if password.returncode != 0:
                    parser.error("The upload password could not be read from Keychain.")
                env.update(dict(zip(SIGNING, (str(key), "upload", password.stdout.rstrip("\n"), password.stdout.rstrip("\n")))))
        if not args.unsigned and not all(env.get(key) for key in SIGNING):
            parser.error("Set all four BLINKENBADGE_ANDROID signing variables or run setup-android-signing.py --create.")
        cmd += ["--target", "aarch64", "armv7", "x86_64", "--aab"]
    cmd += ["--config", json.dumps(config)]
    print(f"Building {args.platform} com.martin.blinkenbadge, build {args.build_number}, signed={not args.unsigned}", flush=True)
    subprocess.run(cmd, cwd=APP, env=env, check=True)
    if args.platform == "ios" and not args.unsigned:
        version = json.loads((APP / "package.json").read_text())["version"]
        output = ROOT / "mobile-builds" / f"{version}-{args.build_number}" / "ios"
        subprocess.run([
            "xcodebuild", "-exportArchive", "-archivePath",
            str(APP / "src-tauri/gen/apple/build/blinkenbadge_iOS.xcarchive"),
            "-exportOptionsPlist", str(APP / "src-tauri/ExportOptions.beta.plist"),
            "-exportPath", str(output),
        ], env=env, check=True)
        ipa = output / "BlinkenBadge.ipa"
        with tempfile.TemporaryDirectory(prefix="blinkenbadge-ios-verify-") as temp:
            subprocess.run(["ditto", "-x", "-k", str(ipa), temp], check=True)
            app = Path(temp) / "Payload/BlinkenBadge.app"
            subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
            info = plistlib.loads((app / "Info.plist").read_bytes())
            entitlements = subprocess.run(["codesign", "-d", "--entitlements", ":-", str(app)], capture_output=True, check=True)
            rights = plistlib.loads(entitlements.stdout)
            if (info["CFBundleIdentifier"] != "com.martin.blinkenbadge"
                    or info["CFBundleVersion"] != str(args.build_number)
                    or rights.get("get-task-allow") is not False
                    or rights.get("beta-reports-active") is not True
                    or not (app / "PrivacyInfo.xcprivacy").is_file()):
                raise RuntimeError("Exported iOS artifact failed identity, entitlement, or privacy checks.")
            report = {"bundle": info["CFBundleIdentifier"], "version": info["CFBundleShortVersionString"],
                      "build": info["CFBundleVersion"], "minimum_ios": info["MinimumOSVersion"],
                      "signature_verified": True, "testflight_entitlement": True,
                      "debugger_allowed": False, "privacy_manifest_bundled": True,
                      "sha256": hashlib.sha256(ipa.read_bytes()).hexdigest()}
            (output.parent / "ios-validation.json").write_text(json.dumps(report, indent=2) + "\n")
        print(f"Signed iOS export: {output}")
    if args.platform == "android" and not args.unsigned:
        source = APP / "src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab"
        version = json.loads((APP / "package.json").read_text())["version"]
        output = ROOT / "mobile-builds" / f"{version}-{args.build_number}"
        output.mkdir(parents=True, exist_ok=True)
        bundle = output / f"BlinkenBadge-{version}-{args.build_number}.aab"
        # JAR stream readers require the manifest followed by signature files.
        # Preserve the signed entry bytes while normalizing ZIP entry order.
        with zipfile.ZipFile(source) as src, zipfile.ZipFile(bundle, "w") as dst:
            entries = sorted(src.infolist(), key=lambda info: (
                0 if info.filename == "META-INF/MANIFEST.MF" else
                1 if info.filename.startswith("META-INF/") and info.filename.endswith((".SF", ".RSA", ".DSA", ".EC")) else 2
            ))
            for entry in entries:
                dst.writestr(entry, src.read(entry.filename))
        verifier = Path(env["JAVA_HOME"]) / "bin/jarsigner" if env.get("JAVA_HOME") else Path("jarsigner")
        result = subprocess.run([str(verifier), "-verify", str(bundle)], capture_output=True, text=True)
        if result.returncode or "jar verified." not in result.stdout or "internal inconsistencies" in result.stdout:
            raise RuntimeError("Signed bundle verification failed; do not upload the output.")
        subprocess.run([sys.executable, str(ROOT / "scripts/check-android-bundle.py"), str(bundle)], check=True)
        print(f"Verified signed bundle: {bundle}")


if __name__ == "__main__":
    main()
