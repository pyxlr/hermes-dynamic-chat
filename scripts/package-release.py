"""Validate and package a Dynamic Chat release without network access."""

import argparse
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path


def validate_version(version):
    number = r"(?:0|[1-9][0-9]*)"
    identifier = rf"(?:{number}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
    pattern = rf"{number}\.{number}\.{number}(?:-{identifier}(?:\.{identifier})*)?"
    if not re.fullmatch(pattern, version):
        raise ValueError("Use a SemVer version without the leading v or build metadata.")
    return version


def release_files(root, version):
    validate_version(version)
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    manifest = (root / "hermes-dynamic-chat/plugin.yaml").read_text(encoding="utf-8")
    match = re.search(r'^version: "([^"]+)"$', manifest, re.MULTILINE)
    if package.get("version") != version or not match or match[1] != version:
        raise ValueError("Release version must match package.json and plugin.yaml.")
    files = {
        "plugin.js": (root / "hermes-dynamic-chat/plugin.js").read_bytes(),
        "plugin.yaml": manifest.encode("utf-8"),
        "LICENSE": (root / "LICENSE").read_bytes(),
        "README.md": (root / "README.md").read_bytes(),
    }
    expected = (root / "CHECKSUMS.sha256").read_text(encoding="utf-8").strip()
    actual = hashlib.sha256(files["plugin.js"]).hexdigest()
    if expected != f"{actual}  hermes-dynamic-chat/plugin.js":
        raise ValueError("Plugin does not match the repository checksum.")
    if files["LICENSE"].strip() not in files["plugin.js"]:
        raise ValueError("The bundled plugin must contain the upstream license.")
    return files


def checksums(files):
    return "".join(f"{hashlib.sha256(data).hexdigest()}  {name}\n" for name, data in sorted(files.items())).encode("utf-8")


def package_release(root, version, output):
    files = release_files(root, version)
    archive = f"hermes-dynamic-chat-{version}.zip"
    output.mkdir(parents=True, exist_ok=False)
    for name, data in files.items():
        (output / name).write_bytes(data)
    with zipfile.ZipFile(output / archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
        for name, data in sorted({**files, "CHECKSUMS.sha256": checksums(files)}.items()):
            info = zipfile.ZipInfo(f"hermes-dynamic-chat/{name}", date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            zipped.writestr(info, data)
    with zipfile.ZipFile(output / archive) as zipped:
        if zipped.testzip() is not None:
            raise ValueError("Release archive failed verification.")
    (output / "CHECKSUMS.sha256").write_bytes(checksums({**files, archive: (output / archive).read_bytes()}))
    metadata = {"version": version, "tag": f"v{version}", "archive": archive, "prerelease": "-" in version}
    (output / "release.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.check_only:
            release_files(args.root, args.version)
            print(json.dumps({"version": args.version, "tag": f"v{args.version}", "prerelease": "-" in args.version}))
        else:
            if args.output is None:
                parser.error("--output is required unless --check-only is used")
            print(json.dumps(package_release(args.root, args.version, args.output)))
    except (ValueError, OSError, KeyError) as error:
        print(f"Release packaging failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
