#!/usr/bin/env python3
"""Create a separate BlinkenBadge upload key; store its password in Keychain."""

import argparse
import ctypes
import os
from pathlib import Path
import secrets
import subprocess
import sys

SERVICE = "com.martin.blinkenbadge.android-upload"
ACCOUNT = "upload"
KEYSTORE = Path.home() / ".config/blinkenbadge/signing/upload.p12"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--create", action="store_true", help="Create a new key without overwriting an existing key.")
    args = parser.parse_args()
    if not args.create:
        print(f"Keystore: {KEYSTORE} ({'present' if KEYSTORE.is_file() else 'missing'})")
        return
    if sys.platform != "darwin":
        parser.error("This helper stores credentials in macOS Keychain.")
    if KEYSTORE.exists():
        parser.error("The upload keystore already exists; it was not changed.")
    existing = subprocess.run(
        ["security", "find-generic-password", "-s", SERVICE, "-a", ACCOUNT],
        capture_output=True,
    )
    if existing.returncode == 0:
        parser.error("A Keychain password already exists; recover its keystore before creating another key.")

    java = Path(os.environ.get("JAVA_HOME", "/Applications/Android Studio.app/Contents/jbr/Contents/Home"))
    keytool = java / "bin/keytool"
    if not keytool.is_file():
        parser.error("Set JAVA_HOME to a JDK containing keytool.")
    KEYSTORE.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(KEYSTORE.parent, 0o700)
    password = secrets.token_urlsafe(48)
    env = os.environ.copy()
    env["BLINKENBADGE_NEW_UPLOAD_PASSWORD"] = password
    previous_mask = os.umask(0o077)
    try:
        subprocess.run(
            [str(keytool), "-genkeypair", "-keystore", str(KEYSTORE),
             "-storetype", "PKCS12", "-alias", ACCOUNT, "-keyalg", "RSA",
             "-keysize", "4096", "-validity", "10000",
             "-dname", "CN=Martin Bogomolni, OU=BlinkenBadge",
             "-storepass:env", "BLINKENBADGE_NEW_UPLOAD_PASSWORD",
             "-keypass:env", "BLINKENBADGE_NEW_UPLOAD_PASSWORD"],
            env=env, check=True, capture_output=True,
        )
        security = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
        add = security.SecKeychainAddGenericPassword
        add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_char_p,
                        ctypes.c_uint32, ctypes.c_char_p, ctypes.c_uint32,
                        ctypes.c_void_p, ctypes.c_void_p]
        add.restype = ctypes.c_int32
        secret = password.encode()
        status = add(None, len(SERVICE), SERVICE.encode(), len(ACCOUNT),
                     ACCOUNT.encode(), len(secret), secret, None)
        if status != 0:
            # This file was created by this invocation and has no saved password.
            KEYSTORE.unlink()
            raise RuntimeError(f"Keychain rejected password storage (status {status}); no key was retained.")
    finally:
        os.umask(previous_mask)
    print(f"Created {KEYSTORE}")
    print(f"Password stored in Keychain service {SERVICE}, account {ACCOUNT}.")
    print("Back up the keystore and its Keychain credential before uploading a bundle.")


if __name__ == "__main__":
    main()
