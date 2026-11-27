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
    if item == "e1b" and not outcomes.e1b_live_accepts(judgment, (extract or {}).get("messages")):
        return None, "offer check failed"
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


def expected_labels():
    official = json.loads((TESTS / "expected_outcomes.json").read_text())
    adversarial = json.loads((TESTS / "adversarial_outcomes.json").read_text())
    return set(official) | set(adversarial)


def directory_matches(directory, run):
    label = run.get("label")
    hinted = bool(run.get("hinted"))
    if directory == "reference-a-hinted":
        return label == "reference-a" and hinted
    if directory == "reference-a":
        return label == "reference-a" and not hinted
    return label == directory


def label_gap(found, expected):
    missing = sorted(set(expected) - set(found))
    extra = sorted(set(found) - set(expected))
    if missing:
        return "missing runs: " + ", ".join(missing[:8])
    if extra:
        return "unexpected runs: " + ", ".join(extra[:8])
    return ""


def inventory_problem(paths):
    expected = expected_labels()
    by_dir = {}
    for path in paths:
        by_dir.setdefault(path.parent.name, path)
    gap = label_gap(set(by_dir), expected)
    if gap:
        return gap
    fixtures = client.load_fixtures()
    mismatched = []
    for name in sorted(expected):
        run = json.loads(by_dir[name].read_text())
        if not directory_matches(name, run):
            mismatched.append(name)
            continue
        identity = "reference-a" if name == "reference-a-hinted" else name
        if identity in fixtures and outcomes.verified_fixture(run) != identity:
            mismatched.append(name)
    if mismatched:
        return "replay mismatch: " + ", ".join(mismatched[:8])
    return ""


def stage_pair(cache_text, list_text, cache_path, list_path, replace=os.replace):
    cache_path = Path(cache_path)
    list_path = Path(list_path)
    cache_tmp = cache_path.with_name(cache_path.name + ".tmp")
    list_tmp = list_path.with_name(list_path.name + ".tmp")
    cache_bak = cache_path.with_name(cache_path.name + ".bak")
    list_bak = list_path.with_name(list_path.name + ".bak")
    cache_tmp.write_text(cache_text)
    try:
        list_tmp.write_text(list_text)
    except Exception:
        cache_tmp.unlink(missing_ok=True)
        raise
    moved_cache = False
    moved_list = False
    try:
        replace(str(cache_path), str(cache_bak))
        moved_cache = True
        replace(str(cache_tmp), str(cache_path))
        replace(str(list_path), str(list_bak))
        moved_list = True
        replace(str(list_tmp), str(list_path))
    except Exception:
        if moved_cache and cache_bak.exists():
            os.replace(cache_bak, cache_path)
        if moved_list and list_bak.exists() and not list_path.exists():
            os.replace(list_bak, list_path)
        cache_tmp.unlink(missing_ok=True)
        list_tmp.unlink(missing_ok=True)
        raise
    cache_bak.unlink(missing_ok=True)
    list_bak.unlink(missing_ok=True)


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: refresh_judge_cache.py <runs-directory>")
    paths = run_paths(sys.argv[1])
    problem = inventory_problem(paths)
    if problem:
        print(json.dumps({"error": problem}))
        return 2
    if not (os.environ.get("PALE_JUDGE_COMMAND") or "").strip():
        raise SystemExit("PALE_JUDGE_COMMAND is required")
    document = json.loads(CACHE_PATH.read_text())
    staged = json.loads(json.dumps(document))
    entries = staged.setdefault("entries", {})
    rows = []
    held = []
    seen_e5 = set()
    written_keys = set()
    for path in paths:
        run = json.loads(path.read_text())
        label = path.parent.name
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
                    written_keys.add(stored_key)
                    rows.append({"label": label, "item": "e1b", "key": stored_key, "points": judgment.get("points"), "action": "write"})
        passages = [text for text in outcomes.thursday_accounts(run) if (text or "").strip()]
        if passages:
            extract = outcomes.thursday_extract(run, target)
            key = client.cache_key("e5_thursday", extract)
            seen_e5.add(key)
            judgment, raw = ask("e5_thursday", extract)
            if judgment is None:
                held.append({"label": label, "item": "e5_thursday", "key": key, "reason": raw})
            else:
                stored_key, body = entry("e5_thursday", extract, judgment, raw)
                entries[stored_key] = body
                written_keys.add(stored_key)
                verdicts = judgment.get("verdicts") or []
                rows.append({
                    "label": label,
                    "item": "e5_thursday",
                    "key": stored_key,
                    "consistent": all(row.get("consistent") is True for row in verdicts),
                    "status": any(row.get("status") is True for row in verdicts),
                    "packet": any(row.get("packet") is True for row in verdicts),
                    "next": any(row.get("next") is True for row in verdicts),
                    "verdicts": len(verdicts),
                    "action": "write",
                })
    current_e1b = prompt_sha("e1b")
    for key, body in entries.items():
        if body.get("item") != "e1b" or key in written_keys:
            continue
        generation = body.setdefault("generation", {})
        judgment = body.get("judgment") or {}
        if generation.get("prompt_sha256") != current_e1b and judgment.get("points") == 0:
            generation["source"] = "historical"
            rows.append({"item": "e1b", "key": key, "action": "historical"})
    stale = [key for key, body in list(entries.items()) if body.get("item") == "e5_thursday" and key not in seen_e5]
    for key in stale:
        entries.pop(key, None)
        rows.append({"item": "e5_thursday", "key": key, "action": "drop"})
    prompts = staged.setdefault("generation", {}).setdefault("prompts", {})
    prompts["e1b"] = current_e1b
    prompts["e5_thursday"] = prompt_sha("e5_thursday")
    report = {
        "prompts": {"e1b": prompts["e1b"], "e5_thursday": prompts["e5_thursday"]},
        "written": rows,
        "held": held,
    }
    stage_pair(
        json.dumps(staged, indent=2, ensure_ascii=False) + "\n",
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        CACHE_PATH,
        LIST_PATH,
    )
    print(json.dumps({"written": len(rows), "held": len(held), "dropped_thursday": len(stale)}))
    return 0 if not held else 1


if __name__ == "__main__":
    raise SystemExit(main())
