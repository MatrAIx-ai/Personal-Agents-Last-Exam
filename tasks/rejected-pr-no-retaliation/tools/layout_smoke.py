#!/usr/bin/env python3
"""Check the image COPY lines cover every registry path the runner starts, and the pinned judge."""
import json
import os
import re
import shutil
import subprocess
import tempfile
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


def judge_copied(entries):
    wanted = "/task/tests/judge/client.py"
    for sources, dest in entries:
        root = dest.rstrip("/") or "/"
        if root == "/task/tests/judge" or wanted.startswith(root + "/"):
            if any(source.rstrip("/").endswith("tests/judge") or source.rstrip("/").endswith("judge") for source in sources):
                return True
        if wanted == root:
            return True
    return False


def copy_layout_reference():
    task = PACKAGE / "tasks" / "rejected-pr-no-retaliation"
    plan = task / "solution" / "plans" / "reference-a.json"
    repo = PACKAGE.parents[1]
    with tempfile.TemporaryDirectory(prefix="rpr-layout-") as tmp:
        root = Path(tmp) / "task"
        env = root / "environment"
        driver_src = task / "environment" / "local-driver"
        driver = env / "local-driver"
        driver.mkdir(parents=True)
        for item in driver_src.iterdir():
            if item.suffix in {".cjs", ".md"} or item.name.endswith(".cjs"):
                shutil.copy2(item, driver / item.name)
        os.symlink(task / "environment" / "workspace", env / "workspace")
        shutil.copytree(task / "context", root / "context")
        shutil.copy2(task / "instruction.md", root / "instruction.md")
        shutil.copytree(task / "tests" / "judge", root / "tests" / "judge")
        out = Path(tmp) / "reference-a.json"
        env_vars = os.environ.copy()
        env_vars["PALE_REPO_ROOT"] = str(repo)
        env_vars.pop("PALE_JUDGE_COMMAND", None)
        env_vars.pop("PALE_JUDGE_RECORD", None)
        proc = subprocess.run(
            ["node", str(driver / "run.cjs"), "--plan", str(plan), "--out", str(out), "--run-id", "rpr-layout-reference"],
            cwd=str(repo),
            env=env_vars,
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0 or not out.exists():
            return "reference plan " + (proc.stderr or proc.stdout or "failed")[-400:]
        grade = subprocess.run(
            ["python3", str(task / "tests" / "test_outcomes.py"), "--grade", str(out)],
            capture_output=True,
            text=True,
            check=False,
        )
        if grade.returncode != 0:
            return "reference grade " + (grade.stdout or grade.stderr)[-300:]
        score = json.loads(grade.stdout)
        if score.get("points") != 20 or score.get("full_pass") is not True or score.get("judge_error"):
            return "reference score " + grade.stdout.strip()
    return ""


def main():
    text = DOCKERFILE.read_text()
    entries = copy_entries(text)
    if not judge_copied(entries):
        print({"layout": "fail", "reason": "the image omits tests/judge/client.py"})
        raise SystemExit(1)
    judge_file = PACKAGE / "tasks" / "rejected-pr-no-retaliation" / "tests" / "judge" / "client.py"
    if not judge_file.exists():
        print({"layout": "fail", "reason": "client.py is missing from the package"})
        raise SystemExit(1)
    layout_problem = copy_layout_reference()
    if layout_problem:
        print({"layout": "fail", "reason": layout_problem})
        raise SystemExit(1)
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
