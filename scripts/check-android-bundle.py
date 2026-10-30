#!/usr/bin/env python3
"""Reject 64-bit ELF libraries that cannot load with Android 16 KB pages."""

import argparse
import json
from pathlib import Path
import struct
import zipfile


def check_library(name, data):
    if len(data) < 64 or data[:6] != b"\x7fELF\x02\x01":
        raise ValueError(f"{name}: expected a little-endian 64-bit ELF library")
    offset = struct.unpack_from("<Q", data, 32)[0]
    size, count = struct.unpack_from("<HH", data, 54)
    if size < 56 or not count or offset + size * count > len(data):
        raise ValueError(f"{name}: invalid ELF program headers")
    alignments = []
    for index in range(count):
        kind, _, file_offset, address, _, _, _, alignment = struct.unpack_from(
            "<IIQQQQQQ", data, offset + index * size
        )
        if kind != 1:
            continue
        if alignment < 16384 or alignment & (alignment - 1):
            raise ValueError(f"{name}: LOAD alignment {alignment} is not 16 KB compatible")
        if file_offset % 16384 != address % 16384:
            raise ValueError(f"{name}: LOAD offset and address differ modulo 16 KB")
        alignments.append(alignment)
    if not alignments:
        raise ValueError(f"{name}: no LOAD segments")
    return {"library": name, "load_alignments": alignments}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    args = parser.parse_args()
    try:
        with zipfile.ZipFile(args.bundle) as bundle:
            libraries = [name for name in bundle.namelist()
                         if name.endswith(".so") and any(f"/lib/{abi}/" in "/" + name
                             for abi in ("arm64-v8a", "x86_64"))]
            if not libraries:
                raise ValueError("No ARM64 or x86_64 libraries found")
            results = [check_library(name, bundle.read(name)) for name in libraries]
        print(json.dumps({"elf_16kb_compatible": True, "libraries": results}, indent=2))
    except (ValueError, OSError, zipfile.BadZipFile, struct.error) as error:
        parser.exit(1, f"Android bundle check failed: {error}\n")


if __name__ == "__main__":
    main()
