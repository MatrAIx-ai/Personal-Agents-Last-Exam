"""Plan, run and audit the frozen three-model validation batch for PR #175."""
import argparse
import fcntl
import hashlib
import json
import os
import shutil
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from tempfile import NamedTemporaryFile

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "tasks/blind-review-packet"
FAMILIES = ("GPT", "Claude", "Gemini")
OPTIONS = {"temperature", "reasoning_effort", "seed"}


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def save(path, data):
    with NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")
    os.replace(f.name, path)


def freeze(roster):
    if set(roster) != {"roster_url", "models", "max_turns", "max_output_tokens"}:
        raise ValueError("The batch file accepts only roster_url, models and the two budgets")
    models = roster["models"]
    if set(models) != set(FAMILIES) or not roster["roster_url"].startswith("https://"):
        raise ValueError("Supply the dated roster URL and all three designated model IDs")
    if any(not isinstance(roster[k], int) or roster[k] <= 0 for k in ("max_turns", "max_output_tokens")):
        raise ValueError("Use a positive turn and output-token budget")
    ids = set()
    for cfg in models.values():
        if set(cfg) - {"id", "options"} or not cfg["id"] or "/" not in cfg["id"] or set(cfg.get("options", {})) - OPTIONS:
            raise ValueError("Expected a provider/model ID and optional seed, temperature or reasoning_effort")
        ids.add(cfg["id"])
    if len(ids) != len(FAMILIES):
        raise ValueError("Each model family requires its own designated model")
    files = [*sorted(p for p in SOURCE.rglob("*") if p.is_file()), HERE / "packet_agent.py", HERE / "prepare.cjs", Path(__file__).resolve()]
    return {p.relative_to(HERE.parent).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def schedule():
    for family in FAMILIES:
        for variant in ("primary", "alternate"):
            yield {"id": f"pilot-{family.lower()}-{variant}", "family": family, "variant": variant, "phase": "pilot"}
        for n in range(1, 6):
            yield {"id": f"validation-{family.lower()}-{n}", "family": family, "variant": "primary", "phase": "validation"}
        yield {"id": f"validation-{family.lower()}-hinted", "family": family, "variant": "hinted", "phase": "validation"}


def outcome(job, expected_model=None):
    matches = sorted(job.glob("*/result.json"))
    if len(matches) != 1:
        return {"status": "pending" if not matches else "needs_review", "job": job.name}
    result = read(matches[0])
    if expected_model:
        agent = (result.get("config") or {}).get("agent") or {}
        steps = result.get("step_results") or []
        trial = matches[0].parent
        verifier_dir = trial / "steps/after-meeting/verifier"
        if (agent.get("model_name") != expected_model or (result.get("agent_info") or {}).get("name") != "blind-packet-chat"
                or [s.get("step_name") for s in steps] != ["morning", "after-meeting"]
                or not (verifier_dir / "packet-evidence.json").is_file()
                or not all((trial / "steps" / s["step_name"] / "agent/packet-provider.jsonl").is_file() for s in steps)):
            return {"status": "needs_review", "job": job.name, "reason": "model identity or trial evidence mismatch"}
    value = (result.get("verifier_result") or {}).get("rewards") or {}
    failed_step = any(s.get("exception_info") for s in result.get("step_results") or [])
    if result.get("exception_info") or failed_step or result.get("reward_valid") is False or not {"rubric_score","full_pass"} <= value.keys():
        return {"status": "infrastructure_or_review", "job": job.name, "trial": result.get("trial_name")}
    score, passed = value["rubric_score"], value["full_pass"]
    if not 0 <= score <= 1 or passed not in (0, 1):
        raise ValueError("Invalid reward in " + str(matches[0]))
    return {"status": "scored", "job": job.name, "trial": result["trial_name"], "score": score, "full_pass": bool(passed)}


def summarize(plan, folder, models=None):
    rows = [{**s, **outcome(folder / "jobs" / s["id"], models[s["family"]]["id"] if models else None)} for s in plan]
    by_model = {}
    for family in FAMILIES:
        selected = [r for r in rows if r["family"] == family and r["phase"] == "validation"]
        if len(selected) != 6 or any(r["status"] != "scored" for r in selected):
            by_model[family] = {"status": "incomplete", "scored": sum(r["status"] == "scored" for r in selected)}
            continue
        cold = [r for r in selected if r["variant"] == "primary"]
        hinted, = [r for r in selected if r["variant"] == "hinted"]
        mean = sum(Decimal(str(r["score"])) for r in cold) / len(cold)
        passes = sum(r["full_pass"] for r in cold)
        by_model[family] = {"status": "qualifies" if passes == 0 and mean < Decimal("0.5") and hinted["score"] == 1 and hinted["full_pass"] else "thresholds_missed",
                            "unhinted_runs": len(cold), "unhinted_passes": passes, "unhinted_mean": float(mean),
                            "hinted_score": hinted["score"], "hinted_full_pass": hinted["full_pass"]}
    return {"runs": rows, "models": by_model}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["plan", "pilot", "validation", "report"])
    parser.add_argument("roster", type=Path)
    parser.add_argument("batch", type=Path, help="Dedicated directory outside the delivery package")
    args = parser.parse_args()
    folder = args.batch.resolve()
    if folder == HERE.parent or HERE.parent in folder.parents:
        parser.error("Place batch output outside the package")
    folder.mkdir(parents=True, exist_ok=True)
    with (folder / ".batch.lock").open("a") as guard:
        try:
            fcntl.flock(guard, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error("Another process is using this batch")
        run(args, folder, parser)


def run(args, folder, parser):
    roster = read(args.roster)
    lock = {"roster": roster, "files": freeze(roster), "harbor": "0.27.0", "litellm": "1.111.0", "jobs": list(schedule())}
    manifest = folder / "batch.json"
    if manifest.exists() and read(manifest) != lock:
        parser.error("Task or roster differs from the frozen batch; use a new directory for a revised design")
    save(manifest, lock)
    if args.action == "plan":
        print("Prepared 6 pilot and 18 validation jobs in", manifest)
        return
    if args.action == "report":
        report = summarize(lock["jobs"], folder, roster["models"])
        save(folder / "report.json", report)
        print(json.dumps(report["models"], indent=2))
        return
    from importlib.metadata import version
    for name in ("harbor", "litellm"):
        if version(name) != lock[name]:
            parser.error(f"Install {name}=={lock[name]} in the evaluation environment")
    harbor = shutil.which("harbor", path=str(Path(sys.executable).parent)) or shutil.which("harbor")
    if not harbor:
        parser.error("Harbor CLI missing")
    env = {**os.environ, "PYTHONPATH": str(HERE) + os.pathsep + os.environ.get("PYTHONPATH",""),
           "PYTHONDONTWRITEBYTECODE": "1"}
    for row in lock["jobs"]:
        if row["phase"] != args.action:
            continue
        cfg = roster["models"][row["family"]]
        job = folder / "jobs" / row["id"]
        if job.exists():
            if outcome(job, cfg["id"])["status"] != "scored":
                parser.error(f"Inspect and preserve the existing incomplete run: {job}")
            continue
        variant = row["variant"]
        task = folder / "prepared" / variant / "blind-review-packet"
        if not task.exists():
            flags = [] if variant == "primary" else ["--" + variant]
            subprocess.run(["node", str(HERE/"prepare.cjs"), str(task), *flags], check=True)
            save(task.parent / "inputs.json", task_hashes(task))
        if task_hashes(task) != read(task.parent / "inputs.json"):
            parser.error(f"Prepared task inputs changed: {task}")
        options = dict(cfg.get("options", {}))
        if "seed" in options:
            replicate = f"{options['seed']}:{row['id']}"
            options["seed"] = int(hashlib.sha256(replicate.encode()).hexdigest()[:7], 16)
        job_config = {"job_name": row["id"], "jobs_dir": str(folder/"jobs"), "n_attempts": 1,
                      "tasks": [{"path": str(task)}], "environment": {"type": "docker"},
                      "agents": [{"import_path": "packet_agent:PacketAgent", "model_name": cfg["id"],
                                  "kwargs": {"completion_options": options,
                                             "max_turns": roster["max_turns"], "max_output_tokens": roster["max_output_tokens"]}}]}
        config_path = folder / (row["id"]+".json")
        save(config_path, job_config)
        subprocess.run([harbor, "run", "--config", str(config_path)], check=True, env=env)
        if outcome(job, cfg["id"])["status"] != "scored":
            parser.error(f"Inspect the run before continuing: {job}")
    save(folder / "report.json", summarize(lock["jobs"], folder, roster["models"]))


def task_hashes(task):
    return {p.relative_to(task).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(task.rglob("*")) if p.is_file()}


if __name__ == "__main__":
    main()
