import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "skills/task/skills/task-proposal/scripts/check_task_proposal.py"
spec = importlib.util.spec_from_file_location("check_task_proposal", SCRIPT)
checker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(checker)


class TaskProposalCheckTests(unittest.TestCase):
    def setUp(self):
        self.template = (ROOT / "proposals/templates/task-proposal.md").read_text()
        self.example = (ROOT / "proposals/task/lena-spring-gathering.md").read_text()

    def errors(self, text):
        report, _ = checker.check(text, self.template)
        return [message for _, message in report.errors]

    def test_worked_example_passes(self):
        report, title = checker.check(self.example, self.template)
        self.assertEqual(report.errors, [])
        self.assertEqual(
            title,
            "[Task Proposal] [Food & dining + Social & communities] Arrange catering for Lena’s spring gathering",
        )

    def test_empty_template_fails(self):
        errors = self.errors(self.template)
        self.assertTrue(any("placeholder" in e for e in errors))
        self.assertTrue(any("Short task title" in e for e in errors))

    def test_older_format_reports_missing_sections(self):
        legacy = self.example.split("## 5. Rubric, hint and reference solution")[0]
        errors = self.errors(legacy)
        self.assertTrue(any("Rubric" in e for e in errors))
        self.assertTrue(any("Forbidden" in e for e in errors))

    def test_rubric_arithmetic(self):
        low_mark = self.example.replace("at least 16 of 20", "at least 10 of 20")
        self.assertTrue(any("still pass" in e for e in self.errors(low_mark)))
        wrong_total = self.example.replace("**✍️ Expected (required):** 20 points.", "**✍️ Expected (required):** 25 points.")
        self.assertTrue(any("add up to 20" in e for e in self.errors(wrong_total)))

    def test_rubric_items_need_evidence_and_reference_coverage(self):
        no_evidence = self.example.replace("*Evidence:* Cedar Table’s update (Apr 16). *Checked from:* messages", "*Checked from:* messages")
        self.assertTrue(any("E4 has no" in e for e in self.errors(no_evidence)))
        uncovered = self.example.replace("| E3, E4 |", "| E3 |")
        self.assertTrue(any("cites E4" in e for e in self.errors(uncovered)))

    def test_domains_insight_and_timestamps(self):
        bad_domain = self.example.replace("- **Primary domain (required):** Food & dining", "- **Primary domain (required):** Catering")
        self.assertTrue(any("primary domain" in e for e in self.errors(bad_domain)))
        long_insight = self.example.replace("- **Personalization insight (required):** ", "- **Personalization insight (required):** " + "x" * 240)
        self.assertTrue(any("limit is 240" in e for e in self.errors(long_insight)))
        no_offset = self.example.replace("`2026-04-08T09:05:00-04:00`", "`2026-04-08T09:05:00`", 1)
        self.assertTrue(any("no UTC offset" in e for e in self.errors(no_offset)))

    def test_hint_warnings(self):
        leaky = self.example.replace("re-read these records:", "switch to the $236 menu and re-read these records:")
        report, _ = checker.check(leaky, self.template)
        warnings = " ".join(message for _, message in report.warnings)
        self.assertIn("amount", warnings)
        self.assertIn("switch", warnings)


if __name__ == "__main__":
    unittest.main()
