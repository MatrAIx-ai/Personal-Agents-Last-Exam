#!/usr/bin/env python3
"""Writes the package root manifest.json (LifePack v1.0 manifest contract): identity, task entry,
resolved dependencies and SHA-256 of every delivered file except manifest.json itself."""
import hashlib
import json
import subprocess
from pathlib import Path

PKG = Path(__file__).resolve().parents[1]
REPO = PKG.parents[1]


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main():
    files = {}
    for p in sorted(PKG.rglob("*")):
        if p.is_file() and p != PKG / "manifest.json" and "__pycache__" not in p.parts:
            files[str(p.relative_to(PKG))] = sha(p)
    base = subprocess.run(["git", "merge-base", "HEAD", "origin/main"], cwd=REPO, capture_output=True, text=True).stdout.strip() or None
    app = lambda rel: json.loads((REPO / rel / "app.json").read_text())["version"]
    manifest = {
        "format": "lifepack", "format_version": "1.0",
        "package_id": "fellowship-letter-reminders", "package_version": "1.0.0-rc1",
        "tasks": [{"id": "fellowship-letter-reminders", "path": "tasks/fellowship-letter-reminders/",
                   "proposal_url": "https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/185",
                   "primary_domain": "Learning & research", "secondary_domains": [],
                   "dependencies": ["pale-runtime", "app-mail", "app-messages", "app-notes", "app-files", "app-contacts",
                                    "flr-local-driver", "nodejs", "python"]}],
        "dependencies": [
            {"id": "pale-runtime", "kind": "runtime", "version": json.loads((REPO / "runtime/package.json").read_text())["version"],
             "revision": base, "source": "https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam (runtime/, apps.registry.json)"},
            {"id": "app-mail", "kind": "app", "version": app("examples/apps/mail"), "revision": base, "source": "examples/apps/mail"},
            {"id": "app-messages", "kind": "app", "version": app("apps/messages"), "revision": base, "source": "apps/messages"},
            {"id": "app-notes", "kind": "app", "version": app("apps/notes"), "revision": base, "source": "apps/notes"},
            {"id": "app-files", "kind": "app", "version": app("apps/files"), "revision": base, "source": "apps/files"},
            {"id": "app-contacts", "kind": "app", "version": app("apps/contacts"), "revision": base, "source": "apps/contacts"},
            {"id": "flr-local-driver", "kind": "runner (stand-in)", "version": "1.0.0", "revision": "this package",
             "source": "tasks/fellowship-letter-reminders/environment/local-driver/",
             "note": "Stand-in for the unreleased shared LifePack loader / global scheduler / user harness."},
            {"id": "nodejs", "kind": "interpreter", "version": "22.22.1 (tested; >=18 required)", "source": "https://nodejs.org"},
            {"id": "python", "kind": "interpreter", "version": "3.12 (tested; stdlib only)", "source": "https://www.python.org"},
            {"id": "harbor", "kind": "framework", "version": "PENDING (not pinned; container path untested)", "source": "https://docs.harborframework.com"},
        ],
        "files": files,
        "artifacts": [],
    }
    (PKG / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print("manifest.json:", len(files), "files")


if __name__ == "__main__":
    main()
