"""Export portable evidence from the three Harbor control trials for this package."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

PACKAGE = Path(__file__).resolve().parents[1]
EVIDENCE = PACKAGE / "demo/blind-review-packet/evidence"
CASES = {"primary-reference": ("primary", "oracle", 100),
         "alternate-reference": ("alternate", "oracle", 100),
         "primary-nop": ("primary", "nop", 0)}


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("jobs", type=Path)
    parser.add_argument("--output", type=Path, default=EVIDENCE)
    args = parser.parse_args()
    runs = []
    for name, (history, agent, expected_score) in CASES.items():
        job = args.jobs / name
        matches = list(job.glob("*/result.json"))
        if len(matches) != 1:
            raise ValueError(f"Expected one trial for {name}, found {len(matches)}")
        trial = matches[0].parent
        result = json.loads(matches[0].read_text())
        lock = json.loads((trial / "lock.json").read_text())
        check = trial / "steps/after-meeting/verifier"
        score = json.loads((check / "score.json").read_text())
        raw = (check / "packet-evidence.json").read_bytes()
        trace = json.loads(raw)
        if (result["agent_info"]["name"] != agent or result["exception_info"]
                or not result["reward_valid"] or score["points"] != expected_score
                or score["full_pass"] != (expected_score == 100)
                or result["verifier_result"]["rewards"]["rubric_score"] != expected_score/100):
            raise ValueError(f"Unexpected control result for {name}; inspect the raw trial")
        out = args.output / "runs" / name
        out.mkdir(parents=True,exist_ok=True)
        with (out/"trace.json.gz").open("wb") as stream:
            with gzip.GzipFile(filename="",mode="wb",fileobj=stream,mtime=0) as archive:
                archive.write(raw)
        dump(out / "score.json", score)
        runs.append({"run_id": result["id"], "kind": "reference" if agent == "oracle" else "no-action control",
                     "case": name, "history": history, "agent": result["agent_info"], "hint": False,
                     "harbor_task_digest": lock["task"]["digest"], "initial_fixture_sha256": trace["identity"],
                     "started_at": result["started_at"], "finished_at": result["finished_at"],
                     "simulated_start": trace["initial"]["at"], "simulated_end": trace["final"]["at"],
                     "sessions": list(trace["checkpoints"]), "seed": "deterministic App snapshot",
                     "model_tokens": 0, "model_cost_usd": 0, "points": score["points"], "full_pass": score["full_pass"],
                     "trace": f"runs/{name}/trace.json.gz", "uncompressed_trace_sha256": digest(raw),
                     "score": f"runs/{name}/score.json",
                     "steps": [dict(name=s["step_name"], rewards=s["verifier_result"]["rewards"]) for s in result["step_results"]]})
    dump(args.output / "manifest.json",
         {"task": "blind-review-packet", "package_version": "0.1.0", "harbor": "0.27.0",
          "adapter": "packet-controller 0.1.0", "pale_core":"1.6.0", "node":"22.23.2",
          "network":"no-network", "cpu":1, "memory_mb":768, "phase_timeout_sec":900,
          "controls":runs, "grader_checks":"grader-validation.json", "analysis":"failure-analysis.md",
          "designated_model_runs":{"pilot":0,"unhinted":0,"hinted":0,"qualification":"pending"}})
    print("Recorded three Harbor control trials in", args.output)


if __name__ == "__main__":
    main()
