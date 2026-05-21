#!/usr/bin/env python3
"""
check-locale-parity.py

Verifies every iOS .lproj/Localizable.strings file and every admin
messages/<lang>.json bundle has the same set of keys as the English
master. CI fails (exit 1) if any stub locale is missing keys —
the contract is "every key exists in every locale; stubs use
???key??? as their value".

Usage:
    python3 scripts/i18n/check-locale-parity.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS_RES = ROOT / "ios" / "OpenMatch" / "Resources"
ADMIN_MSGS = ROOT / "admin" / "messages"

STRINGS_KEY = re.compile(r'^\s*"([^"]+)"\s*=\s*"', re.M)


def ios_keys(path: Path) -> set[str]:
    text = path.read_text(encoding="utf-8")
    return set(STRINGS_KEY.findall(text))


def admin_keys(path: Path) -> set[str]:
    with path.open() as f:
        data = json.load(f)
    out: set[str] = set()

    def walk(obj, prefix: str):
        if isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{prefix}.{k}" if prefix else k)
        else:
            out.add(prefix)

    walk(data, "")
    return out


def check_ios() -> int:
    en = IOS_RES / "en.lproj" / "Localizable.strings"
    if not en.exists():
        print(f"[ios] master strings file missing: {en}")
        return 1
    master = ios_keys(en)
    errors = 0
    for d in sorted(IOS_RES.glob("*.lproj")):
        if d.name == "en.lproj":
            continue
        f = d / "Localizable.strings"
        if not f.exists():
            print(f"[ios] {d.name}: Localizable.strings missing")
            errors += 1
            continue
        local = ios_keys(f)
        missing = master - local
        extra = local - master
        if missing:
            print(f"[ios] {d.name}: missing {len(missing)} keys: {sorted(missing)[:5]}…")
            errors += 1
        if extra:
            print(f"[ios] {d.name}: {len(extra)} extra keys not in en: {sorted(extra)[:5]}…")
            errors += 1
    return errors


def check_admin() -> int:
    if not ADMIN_MSGS.exists():
        return 0  # admin messages are optional in the early scaffold
    en = ADMIN_MSGS / "en.json"
    if not en.exists():
        return 0
    master = admin_keys(en)
    errors = 0
    for f in sorted(ADMIN_MSGS.glob("*.json")):
        if f.name == "en.json":
            continue
        local = admin_keys(f)
        missing = master - local
        extra = local - master
        if missing:
            print(f"[admin] {f.name}: missing {len(missing)} keys")
            errors += 1
        if extra:
            print(f"[admin] {f.name}: {len(extra)} extra keys")
            errors += 1
    return errors


def main() -> int:
    errors = check_ios() + check_admin()
    if errors == 0:
        print("locale parity: OK")
        return 0
    print(f"locale parity: {errors} discrepancies")
    return 1


if __name__ == "__main__":
    sys.exit(main())
