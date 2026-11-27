#!/usr/bin/env python3
"""Rebuild the published E1b and Thursday cache entries from PALE_JUDGE_COMMAND.

The command receives the same payload the grader sends. Each written entry keeps
the extract, the raw response, and the prompt digest. An E1b response that would
change a stored point total is left in place and listed as held.
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TESTS = ROOT / "tasks" / "rejected-pr-no-retaliation" / "tests"
sys.path.insert(0, str(TESTS))
sys.path.insert(0, str(TESTS / "judge"))
import client
import test_outcomes as outcomes

CACHE_PATH = TESTS / "judge" / "fixture_cache.json"
LIST_PATH = ROOT / "tools" / "judge_cache_refresh_list.json"
PROMPT_DIR = TESTS / "judge"


def prompt_sha(item):
    name = client.prompt_file(item, {"after_decision": True})
    return hashlib.sha256((PROMPT_DIR / name).read_bytes()).hexdigest()


def run_paths(directory):
    base = Path(directory)
    paths = sorted(base.glob("*/run.json"))
    if not paths:
        paths = sorted(base.glob("*.json"))
    return paths


def ask(item, extract):
    command = os.environ.get("PALE_JUDGE_COMMAND") or ""
    if not command.strip():
        raise SystemExit("PALE_JUDGE_COMMAND is required")
    payload = {
        "version": client.VERSION,
        "item": item,
        "model": client.resolved_model(),
        "temperature": client.PIN.get("temperature", 0),
        "prompt": (PROMPT_DIR / client.prompt_file(item, extract)).read_text(),
        "extract": extract,
    }
    proc = subprocess.run(command, input=json.dumps(payload), text=True, shell=True, capture_output=True, check=False)
    if proc.returncode != 0:
        return None, "command failed"
    try:
        judgment = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None, "output is not JSON"
    if not client.live_valid(item, judgment, extract):
        return None, "output is invalid"
    return judgment, proc.stdout


def entry(item, extract, judgment, raw):
    key = client.cache_key(item, extract)
    return key, {
        "item": item,
        "judgment": judgment,
        "extract": extract,
        "raw_response": raw,
        "generation": {
            "model": client.resolved_model(),
            "temperature": client.PIN.get("temperature", 0),
            "prompt_sha256": prompt_sha(item),
            "extract_sha256": key,
            "role": "annotation",
            "source": "packaged reading",
            "current_pin": False,
        },
    }


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: refresh_judge_cache.py <runs-directory>")
    document = json.loads(CACHE_PATH.read_text())
    entries = document.setdefault("entries", {})
    rows = []
    held = []
    seen_e5 = set()
    for path in run_paths(sys.argv[1]):
        run = json.loads(path.read_text())
        label = run.get("label") or path.parent.name
        variant = run.get("variant")
        excluded = set(outcomes.RULES["excluded_on_merge_and_technical"]) if variant in ("merge", "technical") else set()
        target = outcomes.target_pull(((run.get("snapshots") or {}).get("forkyard") or {}).get("data") or {})
        if target and "E1b" not in excluded:
            messages = outcomes.option_window(run)
            if messages:
                extract = {"messages": messages}
                key = client.cache_key("e1b", extract)
                previous = (entries.get(key) or {}).get("judgment") or {}
                judgment, raw = ask("e1b", extract)
                if judgment is None:
                    held.append({"label": label, "item": "e1b", "key": key, "reason": raw})
                elif previous and previous.get("points") != judgment.get("points"):
                    held.append({
                        "label": label,
                        "item": "e1b",
                        "key": key,
                        "reason": "point total would change",
                        "stored_points": previous.get("points"),
                        "response_points": judgment.get("points"),
                    })
                else:
                    stored_key, body = entry("e1b", extract, judgment, raw)
                    entries[stored_key] = body
                    rows.append({"label": label, "item": "e1b", "key": stored_key, "points": judgment.get("points"), "action": "write"})
        passages = [text for text in outcomes.thursday_accounts(run) if (text or "").strip()]
        if passages:
            extract = outcomes.thursday_extract(run, target)
            judgment, raw = ask("e5_thursday", extract)
            key = client.cache_key("e5_thursday", extract)
            seen_e5.add(key)
            if judgment is None:
                held.append({"label": label, "item": "e5_thursday", "key": key, "reason": raw})
            else:
                stored_key, body = entry("e5_thursday", extract, judgment, raw)
                entries[stored_key] = body
                rows.append({
                    "label": label,
                    "item": "e5_thursday",
                    "key": stored_key,
                    "covers": judgment.get("covers"),
                    "pull_state": judgment.get("pull_state"),
                    "packet_changed": judgment.get("packet_changed"),
                    "action": "write",
                })
    stale = [key for key, body in list(entries.items()) if body.get("item") == "e5_thursday" and key not in seen_e5]
    for key in stale:
        entries.pop(key, None)
        rows.append({"item": "e5_thursday", "key": key, "action": "drop"})
    prompts = document.setdefault("generation", {}).setdefault("prompts", {})
    prompts["e1b"] = prompt_sha("e1b")
    prompts["e5_thursday"] = prompt_sha("e5_thursday")
    CACHE_PATH.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    report = {
        "prompts": {"e1b": prompts["e1b"], "e5_thursday": prompts["e5_thursday"]},
        "written": rows,
        "held": held,
    }
    LIST_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"written": len(rows), "held": len(held), "dropped_thursday": len(stale)}))
    return 0 if not held else 1


if __name__ == "__main__":
    raise SystemExit(main())
