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


def copy_entries(text):
    entries = []
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("COPY "):
            continue
        parts = line.split()[1:]
        entries.append((parts[:-1], parts[-1]))
    return entries


def resolve(dest):
    if dest.startswith("/"):
        return dest.rstrip("/") or "/"
    cleaned = dest[2:] if dest.startswith("./") else dest
    return ("/pale/" + cleaned).rstrip("/")


def covers(full, sources, dest):
    root = resolve(dest)
    if dest in (".", "./"):
        for source in sources:
            name = source.rstrip("/").split("/")[-1]
            placed = "/pale/" + name
            if source.endswith("/"):
                if full == placed or full.startswith(placed + "/"):
                    return True
            elif full == placed:
                return True
        return False
    return full == root or full.startswith(root + "/")


def missing_paths(entries):
    missing = []
    for path in registry_paths():
        full = "/pale/" + path
        if not any(covers(full, sources, dest) for sources, dest in entries):
            missing.append(path)
    return missing


def main():
    text = DOCKERFILE.read_text()
    entries = copy_entries(text)
    missing = missing_paths(entries)
    web = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "environment" / "apps" / "web" / "app.json"
    without_web = [item for item in entries if not any("environment/apps/web" in source for source in item[0])]
    web_gap = missing_paths(without_web)
    web_path = next(path for path in registry_paths() if path.endswith("/apps/web"))
    if web_path not in web_gap:
        print({"layout": "fail", "reason": "a missing web copy still looked covered", "web_gap": web_gap})
        raise SystemExit(1)
    if missing or not web.exists():
        print({"layout": "fail", "missing": missing, "web": web.exists()})
        raise SystemExit(1)
    print({"layout": "pass", "paths": len(registry_paths())})


if __name__ == "__main__":
    main()
