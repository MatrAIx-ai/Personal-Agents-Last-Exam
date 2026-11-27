## Track and stage

- [x] Environment Track
- [ ] Task Track
- [ ] Other change

**Stage (required):** Implementation

Use this body only after plan approval and adding the implementation to the same PR. Final validation submission still requires the official lifecycle command with the exact commit and a reachable evidence URL.

## Design

**Design file (required for Environment or Task):** proposals/environment/meeting-poll.md

## Summary and dependencies

**Summary (required):** Add Meeting Poll 1.0.0, a Doodle-inspired workplace scheduling environment on public Core API 1.2.0. The business GUI and MCP share one versioned state for invitations, replies, confirmation, reopening and cancellation. Participants cannot act as other people; replaced slots do not inherit votes; reopening invalidates the prior meeting; retries cannot duplicate notices.

**Dependencies / questions (optional):** Public runtime 1.6.0, Core API 1.2.0; no other Apps or runtime dependencies. A package-local registry leaves the upstream reference assembly unchanged. Playwright is only needed for browser validation. Maintainer workflow/provenance review and acceptance remain required.

## Progress and evidence

Update approval-related fields from actual maintainer records before submitting; do not infer approval from these local files.

- [x] Proposal ready for design review
- [ ] Plan approved by maintainer
- [x] Implementation complete
- [x] Validation evidence attached

**Evidence (required for final validation; optional for proposals):** docs/evidence/meeting-poll/README.md maps the frozen package to reports: 13 business tests, 38 public verifier checks, 38 untouched-base checks, 32 App-specific MCP checks, 24 real-browser checks, all 22 public reference stages, reference/no-op/wrong/partial controls, and four successful final model-agent smoke trials. The earlier model transport failures are retained. Browser automation and model trials are reported separately; neither constitutes human acceptance or Task Track difficulty qualification.
