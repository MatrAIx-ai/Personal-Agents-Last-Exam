#!/usr/bin/env python3
"""
Regression tests covering every adversarial counterexample identified during
cross-agent peer review for scoped-correction-notice (PR #158).
"""
import json
import tempfile
import unittest
from pathlib import Path

from test_outcomes import grade_run

TESTS_DIR = Path(__file__).resolve().parent
REF_DIR = TESTS_DIR.parent.parent.parent / "demo" / "scoped-correction-notice" / "evidence" / "runs" / "reference"


class ScopedErrataEdgeCaseTests(unittest.TestCase):
    def _clone_ref(self, tmpdir: str) -> tuple[Path, dict]:
        d = Path(tmpdir)
        snaps = json.loads((REF_DIR / "snapshots.json").read_text(encoding="utf-8"))
        s3 = (REF_DIR / "session3_response.txt").read_text(encoding="utf-8")
        (d / "snapshots.json").write_text(json.dumps(snaps), encoding="utf-8")
        (d / "session3_response.txt").write_text(s3, encoding="utf-8")
        (d / "action_log.jsonl").write_text((REF_DIR / "action_log.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
        return d, snaps

    def test_unsent_draft_to_kenji_does_not_trigger_f1(self):
        with tempfile.TemporaryDirectory() as td:
            d, snaps = self._clone_ref(td)
            log_lines = (d / "action_log.jsonl").read_text(encoding="utf-8")
            log_lines += json.dumps({
                "seq": 99,
                "app_id": "mail",
                "tool": "mail.draft.create",
                "virtual_now": "2026-11-18T10:12:00-05:00",
                "args": {"to": ["ksato@apexfund.example"], "subject": "Draft", "body": "1,420 MW"},
                "result": {"status": "committed", "id": "draft-unsent"},
            }) + "\n"
            (d / "action_log.jsonl").write_text(log_lines, encoding="utf-8")
            rep = grade_run(d)
            self.assertFalse(rep["forbidden"]["F1"]["triggered"])
            self.assertTrue(rep["full_pass"])

    def test_negative_1420_and_1830_denials_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            d, snaps = self._clone_ref(td)
            for m in snaps["messages"]["data"]["messages"]:
                if m["conversation_id"] == "conv-sonia" and m["author_person_id"] == "person-devon":
                    m["text"] = "The trough is still 1,920 MW. Do not use 1,420 MW. Ignore 18:30 EST."
            for m in snaps["mail"]["data"]["messages"]:
                if "taziz@haddadcap.example" in m.get("to", []):
                    m["body"] = "The trough is still 1,920 MW. Do not use 1,420 MW. Ignore 18:30 EST."
            (d / "snapshots.json").write_text(json.dumps(snaps), encoding="utf-8")
            rep = grade_run(d)
            self.assertFalse(rep["expected"]["E1"]["subparts"]["sonia"])
            self.assertFalse(rep["expected"]["E2"]["subparts"]["tariq"])
            self.assertFalse(rep["full_pass"])

    def test_erased_note_at_deadline_fails_e3(self):
        with tempfile.TemporaryDirectory() as td:
            d, snaps = self._clone_ref(td)
            for n in snaps["notes"]["data"]["notes"]:
                if n["id"] == "note-nov18-errata-log":
                    n["revisions"] = [{"at": "2026-11-18T11:20:00-05:00", "title": n["title"], "body": n["body"]}]
                    n["updated_at"] = "2026-11-18T11:25:00-05:00"
                    n["body"] = "erased"
            (d / "snapshots.json").write_text(json.dumps(snaps), encoding="utf-8")
            rep = grade_run(d)
            self.assertEqual(rep["expected"]["E3"]["score"], 0.0)

    def test_channel_first_and_natural_phrasing_earn_full_20(self):
        with tempfile.TemporaryDirectory() as td:
            d, snaps = self._clone_ref(td)
            for m in snaps["mail"]["data"]["messages"]:
                if "ohaddad@haddadcap.example" in m.get("to", []) and "10:" in m.get("sent_at", ""):
                    m["body"] = "I emailed Tariq and did not copy Kenji. I kept the off-the-record grid details confidential. Also trough is 6:30 p.m. Eastern Standard Time."
            for n in snaps["notes"]["data"]["notes"]:
                if n["id"] == "note-nov18-errata-log":
                    n["body"] = (
                        "Via Mail: Vera Lin, Omar Haddad, and Tariq Aziz (1,420 MW, 6:30 p.m. Eastern Standard Time)\n"
                        "Via Messages: Sonia Patel\n"
                        "I did not copy Kenji Sato. I kept the off-the-record grid details confidential."
                    )
            (d / "snapshots.json").write_text(json.dumps(snaps), encoding="utf-8")
            (d / "session3_response.txt").write_text(
                "Via Mail: Vera Lin, Omar Haddad, and Tariq Aziz.\n"
                "Via Messages: Sonia Patel.\n"
                "Kenji Sato and the 11 other v2 subscribers were excluded because their edition already carried 1,420 MW without 18:00 EST. "
                "Our source diagnostic was kept confidential. The November 18 Errata Log is up to date.\n",
                encoding="utf-8",
            )
            rep = grade_run(d)
            self.assertEqual(rep["raw_score"], 20.0)
            self.assertTrue(rep["full_pass"])

    def test_edt_and_negated_claims_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            d, snaps = self._clone_ref(td)
            for m in snaps["messages"]["data"]["messages"]:
                if m["conversation_id"] == "conv-sonia" and "10:15" in m.get("sent_at", ""):
                    m["text"] = "The revised trough is at 18:30 EDT."
            (d / "snapshots.json").write_text(json.dumps(snaps), encoding="utf-8")
            (d / "session3_response.txt").write_text(
                "Vera Lin was not notified via Mail. Sonia Patel did not receive it via Messages. "
                "The source diagnostic was not withheld. The Nov 18 Errata Log is not up to date.\n",
                encoding="utf-8",
            )
            rep = grade_run(d)
            self.assertFalse(rep["expected"]["E2"]["subparts"]["sonia_1830"])
            self.assertFalse(rep["expected"]["E4"]["subparts"]["vera_omar"])
            self.assertFalse(rep["expected"]["E4"]["subparts"]["sonia"])
            self.assertFalse(rep["expected"]["E4"]["subparts"]["source_withheld"])
            self.assertFalse(rep["expected"]["E4"]["subparts"]["note_updated"])


if __name__ == "__main__":
    unittest.main()
