#!/usr/bin/env python3
"""Check the image COPY lines cover every registry path the runner starts."""
import re
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
DOCKERFILE = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "Dockerfile"
DRIVER = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "local-driver" / "driver.cjs"


def registry_paths():
    text = DRIVER.read_text()
    start = text.index("function writeRegistry")
    body = text[start:text.index("\nfunction ", start + 10)]
    return re.findall(r"path: '([^']+)'", body)


def copy_destinations():
    rows = []
    for line in DOCKERFILE.read_text().splitlines():
        line = line.strip()
        if not line.startswith("COPY "):
            continue
        parts = line.split()
        rows.append(parts[-1])
    return rows


def resolve(dest):
    if dest.startswith("/"):
        return dest.rstrip("/")
    return ("/pale/" + dest.lstrip("./")).rstrip("/")


def covered(path, destinations):
    full = "/pale/" + path
    for dest in destinations:
        root = resolve(dest)
        if full == root or full.startswith(root + "/"):
            return True
    return False


def main():
    destinations = copy_destinations()
    missing = [path for path in registry_paths() if not covered(path, destinations)]
    web = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "apps" / "web" / "app.json"
    if missing or not web.exists():
        print({"layout": "fail", "missing": missing, "web": web.exists()})
        raise SystemExit(1)
    print({"layout": "pass", "paths": len(registry_paths())})


if __name__ == "__main__":
    main()
