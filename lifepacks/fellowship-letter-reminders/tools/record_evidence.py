#!/usr/bin/env python3
"""Runs the author validation batch and writes demo/fellowship-letter-reminders/evidence/.

For each replay plan (reference, accepted alternative, hinted reference, grader-validation
fixtures) it runs the local stand-in runner against the real shipped Apps, grades the exported
run with tests/test_outcomes.py (offline heuristic judge) and stores run.json, grading.json,
reward.json and the runner log under runs/<run-id>/. It then writes the evidence manifest with
input/output SHA-256s. No model API is called; model rollouts are pending (see README).

    NODE=/path/to/node python3 tools/record_evidence.py
"""
import datetime
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
TASK = PKG / "tasks" / "fellowship-letter-reminders"
EVID = PKG / "demo" / "fellowship-letter-reminders" / "evidence"
NODE = os.environ.get("NODE") or shutil.which("node")
sys.path.insert(0, str(TASK / "tests"))
import test_outcomes  # noqa: E402
from judge import HeuristicJudge  # noqa: E402

BATCH = [
    ("author-reference", "reference", TASK / "solution/reference.plan.json", False, "Reference solution (solve.sh)"),
    ("author-reference-hinted", "reference_hinted", TASK / "solution/reference.plan.json", True, "Reference replay with hint injection (checks the hint path; not a model run)"),
    ("author-alternative-ask-first", "accepted_alternative", TASK / "solution/alternative-ask-first.plan.json", False, "Accepted alternative: ask Lindqvist first, materials after she agrees"),
]
for p in sorted((TASK / "tests/validation/plans").glob("*.plan.json")):
    n = p.name.replace(".plan.json", "")
    BATCH.append(("author-" + n, "grader_validation", p, False, json.loads(p.read_text())["description"]))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git_rev():
    try:
        return subprocess.run(["git", "rev-parse", "HEAD"], cwd=PKG, capture_output=True, text=True).stdout.strip() or None
    except OSError:
        return None


def history_coverage():
    """Recount Task history from the actual seed files (not from history.json) for the report."""
    ws, rows = TASK / "environment/workspace", []
    def add(src, rid, at):
        # Every seeded timestamp carries the America/New_York offset in force on its date, so the
        # local calendar date is the date part as written.
        local = datetime.datetime.fromisoformat(at)
        rows.append({"source": src, "id": rid, "at": at, "date": local.date().isoformat()})
    for m in json.loads((ws / "mail/seed.json").read_text())["messages"]:
        add("mail", m["id"], m["received_at"])
    for m in json.loads((ws / "messages/seed.json").read_text())["messages"]:
        add("messages", m["id"], m["sent_at"])
    for n in json.loads((ws / "notes/seed.json").read_text())["notes"]:
        for r in n["revisions"]:
            add("notes", n["id"] + "@" + r["at"], r["at"])
        add("notes", n["id"], n["updated_at"])
    for f in json.loads((ws / "files/seed.json").read_text())["files"]:
        for v in f["versions"]:
            add("files", f["id"] + "#v" + str(v["number"]), v["at"])
    first = datetime.datetime.fromisoformat("2026-11-24T09:10:00-05:00")
    late = [r for r in rows if datetime.datetime.fromisoformat(r["at"]) >= first]
    dates = sorted({r["date"] for r in rows})
    per = {s: len({r["date"] for r in rows if r["source"] == s}) for s in sorted({r["source"] for r in rows})}
    return {"timezone": "America/New_York (records carry -04:00 before 2026-11-01, -05:00 after; 2025-03-04 is -05:00)", "first_session_cutoff": first.isoformat(),
            "records": len(rows), "records_at_or_after_cutoff": late, "distinct_dates_global": len(dates), "distinct_dates_per_source": per,
            "earliest": dates[0], "latest": dates[-1], "dates": dates,
            "external_platform_records_before_2025": [r for r in rows if r["date"] < "2025-01-01"],
            "scope": "Focused task (5 Apps, application season Sep-Nov 2026 + one 2025-03-04 distractor). Well below the "
                     "recommended 300 dates by design: the personalization rests on four specific records, and filler "
                     "history would add no signal. Contacts have no dated events and are excluded.",
            "reproduce": "python3 tools/record_evidence.py (function history_coverage) over environment/workspace/*/seed.json"}


def main():
    if not NODE:
        sys.exit("Node.js 18+ required (set NODE=...)")
    runs_dir = EVID / "runs"
    if runs_dir.exists():
        shutil.rmtree(runs_dir)
    runs_dir.mkdir(parents=True)
    node_version = subprocess.run([NODE, "--version"], capture_output=True, text=True).stdout.strip()
    inputs = sorted([p for p in TASK.rglob("*") if p.is_file() and "__pycache__" not in p.parts])
    entries = []
    for run_id, kind, plan, hinted, desc in BATCH:
        d = runs_dir / run_id
        d.mkdir()
        cmd = [NODE, str(TASK / "environment/local-driver/run.cjs"), "--plan", str(plan), "--out", str(d / "run.json"), "--run-id", run_id]
        if hinted:
            cmd.append("--hinted")
        attempts = []
        for attempt in range(1, 4):  # infrastructure retries (e.g. MCP start-up timeouts on a loaded host)
            t0 = datetime.datetime.now(datetime.timezone.utc)
            p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
            t1 = datetime.datetime.now(datetime.timezone.utc)
            (d / "runner.log").write_text(p.stdout + p.stderr)
            if p.returncode == 0:
                attempts.append({"attempt": attempt, "status": "completed"})
                break
            log = d / ("runner.attempt%d.infra-error.log" % attempt)
            (d / "runner.log").rename(log)
            attempts.append({"attempt": attempt, "status": "infrastructure_error", "log": "runs/%s/%s" % (run_id, log.name),
                             "error": (p.stderr.strip().splitlines() or ["?"])[0][:200]})
        if p.returncode != 0:
            entries.append({"run_id": run_id, "run_type": kind, "status": "infrastructure_error", "attempts": attempts})
            continue
        run = json.loads((d / "run.json").read_text())
        g = test_outcomes.Grader(run, HeuristicJudge()).grade()
        (d / "grading.json").write_text(json.dumps(g, indent=1) + "\n")
        (d / "reward.json").write_text(json.dumps({"reward": g["normalized_score"], "full_pass": int(g["full_pass"]),
                                                    "rubric_points": g["rubric_points"], "forbidden_triggered": g["forbidden_triggered"]}) + "\n")
        entries.append({
            "task_id": "fellowship-letter-reminders", "run_id": run_id, "run_type": kind, "description": desc,
            "status": "completed", "attempts": attempts, "scored_batch": False,
            "agent": run["agent"], "model": None, "user_simulator": "scripted (context/user/script.json, fixed answers)",
            "grader": {"script": "tests/test_outcomes.py", "judge": g["judge"]}, "hinted": hinted, "seed": "deterministic (no randomness)",
            "budgets": "n/a (replay)", "execution_date": t0.date().isoformat(), "real_duration_s": round((t1 - t0).total_seconds(), 1),
            "sessions": len(run["sessions"]), "simulated_start": run["sessions"][0]["start"], "simulated_end": run["sessions"][-1]["start"],
            "tokens": None, "cost_usd": 0,
            "rubric_points": g["rubric_points"], "normalized_score": g["normalized_score"],
            "item_results": {k: (v["points"] if v["kind"] == "expected" else v["triggered"]) for k, v in g["items"].items()},
            "forbidden_triggered": g["forbidden_triggered"], "full_pass": g["full_pass"],
            "delivered_events": [e["id"] for e in run["events"] if e["status"] == "delivered"],
            "artifacts": {f: {"path": "runs/%s/%s" % (run_id, f), "sha256": sha(d / f)} for f in ("run.json", "grading.json", "reward.json", "runner.log")},
        })
        print(run_id, g["rubric_points"], g["forbidden_triggered"], g["full_pass"])
    manifest = {
        "schema": "flr.evidence-manifest.v1", "task_id": "fellowship-letter-reminders",
        "package_revision": git_rev(), "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "environment": {"node": node_version, "python": platform.python_version(), "os": platform.platform(),
                        "runtime": "PALE public runtime 1.6.0 (repository checkout)", "runner": "local stand-in driver 1.0.0"},
        "input_hashes": {str(p.relative_to(PKG)): sha(p) for p in inputs},
        "batches": {"author_validation": [e["run_id"] for e in entries],
                    "model_rollouts": "PENDING - no GPT/Claude/Gemini rollouts have been run (roster and LifePack harness not released; no paid API used)."},
        "runs": entries,
    }
    cov = history_coverage()
    (EVID / "history-coverage.json").write_text(json.dumps(cov, indent=1) + "\n")
    manifest["history_coverage"] = {"path": "history-coverage.json", "distinct_dates": cov["distinct_dates_global"], "records": cov["records"]}
    (EVID / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print("wrote", EVID / "manifest.json")


if __name__ == "__main__":
    main()
