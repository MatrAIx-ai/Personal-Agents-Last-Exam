# Family cycling: first runnable implementation

This package implements the approved proposal at `ea57049`: two sessions, the same 24 reading cards, and two histories differing only in the recipient of TY-184. It uses the real Mail App through separate Infra and Agent MCP stdio connections. It is an implementation preview, not final acceptance or official model validation.

## Run

Requires Node.js 18+ and a public PALE runtime checkout at commit `61b637164e4abddf81536bb48935cdb688a69ff1` (runtime 1.6.0, Mail 1.3.0). No npm packages, GPU, model API key, email credentials or real delivery are needed.

```sh
git clone https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam.git /tmp/pale-runtime
git -C /tmp/pale-runtime checkout 61b637164e4abddf81536bb48935cdb688a69ff1
node tasks/family-cycling/run.cjs /tmp/pale-runtime /tmp/cycling-checks.json
```

The PR branch may predate the public runtime files, hence the explicit separate checkout. Expected output: `PASS 53 real MCP checks; official validation pending`. A checked-in run is in `reference-checks.json`. The runner creates its own temporary state roots, uses only synthetic mail, and cleans them up. It never connects to a real mailbox.

## What is implemented

- CPU fixtures: 24 original short cards, six Thursday records and four timed Friday arrivals per branch. All historical timestamps are on/after 2025-01-01, with sessions on November 12/13, 2026.
- Real `env.load_seed`, `env.apply_event`, `env.advance_time`, `env.reset`; separate Agent discovery, search/read and draft create/update/read-back. No App backend is copied and no runtime state file is edited directly.
- Identical Thursday seed across B/C. The only differing Friday message identifies Tess or Nora as the helmet recipient. Neither branch identifiers nor relevance labels are included in agent-visible messages.
- Persistent draft scoring with the approved unrounded 70-point nDCG component, all-or-nothing 20-point coverage, and a separate 10-point reason-review input. Invalid/missing outputs fail. Forbidden attempted sends fail even if the environment denies them.
- Reference and accepted alternative controls, duplicate/no-op/unchanged-ranking controls, permission denial, and exact reset of data and logical clock.

The scripted reference deliberately uses author answers; it is a reproducibility test, not a model blind test. Its reason points are explicitly synthetic author-control reviews. For an ordinary answer with no independent reason review, `E3` and `full_pass` remain null when the outcome is unresolved; no automatic full credit is given for nonempty prose. `fixtures.json` and `grader.cjs` are **host-only**. The seed builder exports only messages, never relevance judgments or reference answers.

The negative send probe is performed after grading the clean reference and is retained separately in the trace. It must not be silently removed from a real agent rollout; the grader's forbidden-action control demonstrates the required failure.

## Remaining work / blockers

1. Connect the private grader and session scheduler to the maintainer's official Task-runner adapter. This script is a standalone real-MCP integration driver; it does not claim to implement a released official Task schema.
2. Obtain two independent relevance labelers and adjudication, plus auditable semantic reason judgments. Current labels are author-provisional.
3. Freeze the official model roster, access route, agent/memory configuration and budgets, then run the approved unhinted and separate fixed-hint validation batches. Local CPU reference controls are not substitutes.
4. Replay generic draft-format parsing through the final adapter: this first driver persists structured JSON `ranking` entries for deterministic tests. The approved proposal also permits unambiguous numbered lists/tables; the official adapter must normalize those before grading.
5. Review card summaries against their attribution sources before final data freeze. URLs are not runtime retrieval dependencies or licenses to redistribute full articles.

The separate ten-event memory/relevance/ranking calibration is documented in `exploratory-results.md`. It changes the task structure and remains supplementary research. It does not replace the approved two-session task or certify its difficulty.

## Provenance

All family records, addresses, conversations and transactions are synthetic. Addresses use `example.test`. `fixtures.json` preserves original contributor-authored short cards and their source URLs; no full articles, photos, PDFs or actual family data are included. Original code/synthetic text follow this repository's MIT license; third-party linked pages retain their own terms. Codex assisted implementation/testing; separate GPT/Claude experiments are disclosed in the evidence note. `provenance.json` records card hashes and pending source-review status.
