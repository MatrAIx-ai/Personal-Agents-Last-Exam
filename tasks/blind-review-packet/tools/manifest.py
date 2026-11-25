"""Write or verify the package catalog and its SHA-256 file index."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TASK = "tasks/blind-review-packet"
REV = "7a05aa958c824143ab9eee1aa21c2dfacd8be31a"
UPSTREAM = "https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam"
IMAGE = "sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9"


def catalog():
    files = {}
    for p in sorted(ROOT.rglob("*")):
        rel = p.relative_to(ROOT).as_posix()
        if rel == "manifest.json" or "__pycache__" in p.parts or p.suffix == ".pyc":
            continue
        if p.is_symlink():
            raise ValueError("Package includes a symlink: " + rel)
        if p.is_file():
            files[rel] = hashlib.sha256(p.read_bytes()).hexdigest()
    deps = [
        {"id":"harbor", "kind":"harness", "version":"0.27.0", "source":"https://pypi.org/project/harbor/0.27.0/"},
        {"id":"litellm", "kind":"model-client", "version":"1.111.0", "source":"https://pypi.org/project/litellm/1.111.0/"},
        {"id":"node", "kind":"container-image", "version":"22.23.2", "source":"docker.io/library/node@"+IMAGE},
        {"id":"core", "kind":"runtime", "version":"1.6.0", "revision":REV, "source":UPSTREAM+"/tree/"+REV+"/runtime"},
        {"id":"mail", "kind":"app", "version":"1.3.0", "revision":REV, "source":UPSTREAM+"/tree/"+REV+"/examples/apps/mail"},
        {"id":"notes", "kind":"app", "version":"1.0.0", "revision":REV, "source":UPSTREAM+"/tree/"+REV+"/apps/notes"},
        {"id":"packet-controller", "kind":"session-adapter", "version":"0.1.0", "source":TASK+"/environment/adapter"},
        {"id":"packet-chat", "kind":"agent-adapter", "version":"0.1.0", "source":"tools/packet_agent.py"},
    ]
    return {"format":"lifepack", "format_version":"1.0", "package_id":"blind-review-packet",
            "package_version":"0.1.0", "tasks":[{"id":"blind-review-packet", "path":TASK,
            "proposal_url":UPSTREAM+"/pull/175", "primary_domain":"Learning & research", "secondary_domains":[],
            "dependencies":[d["id"] for d in deps]}], "dependencies":deps, "files":files}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    value = catalog()
    target = ROOT / "manifest.json"
    if args.write:
        target.write_text(json.dumps(value,indent=2,ensure_ascii=False)+"\n", encoding="utf-8")
    elif json.loads(target.read_text()) != value:
        raise SystemExit("Package catalog or delivered file hashes do not match")
    print(f"{len(value['files'])} package file hashes verified")
