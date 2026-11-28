# CutRoom multimodal video production, asset search and release studio

**Proposed PR title** — `[Environment Proposal] [Media & entertainment + Work & business] CutRoom multimodal video production, asset search and release studio`

## 1. App and domains

- **Authors / GitHub handles (required):** @Aria068
- **Reference app or website / URL (required):** Synthetic creator workspace inspired by [YouTube Studio](https://studio.youtube.com/) and [Frame.io](https://frame.io/).
- **Primary domain (required):** Media & entertainment
- **Secondary domains (optional):** Work & business

## 2. What you plan to build

**✍️ Your answer (required):** CutRoom models a creator's workflow from rough cut to release: search B-roll, transcripts and licensed music, inspect thumbnails and storyboard PNGs as MCP resources, resolve timestamped notes, verify music and guest clearance, and schedule or unlist a release.

| Example request | Setup and expected result |
| --- | --- |
| “Move Friday's laptop-review video from Private to Public tonight at 8 PM.” | Cut v3 has an incorrect benchmark graphic at `04:12`, a generic “review screen” note at `08:45`, and noncommercial `bgm-lofi-07` on a sponsored project. The `08:45` keyframe shows an unblurred inbox. Report all three issues and leave the project private. |
| “Pick the thumbnail for the battery-life video and attach it to v3. Make sure it works on mobile.” | The duration badge covers part of the title in `thumb_a.png`. Inspect both images, select `thumb_b.png`, and leave visibility and other cuts unchanged. |
| “Replace the restricted music on Episode 14 with upbeat synth under 115 BPM, cleared for sponsorship.” | Exclude expired tracks, noncommercial tracks and exactly 115 BPM. Replace only the assigned track on Episode 14 and verify that the music blocker is gone; leave any unrelated blockers open. |

**Related work:** [Lanternbox #215](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/215) and [Tidepool Audio #216](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/216) model streaming accounts, [Kinodex #226](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/226) a viewing guide, and [Fernshelf #194](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/194) a photo archive. CutRoom focuses on creator-side review and release.

## 3. Potential app connections

- **Internal personal apps (required):** None in v1. Mail checklist export is deferred to post-v1.
- **Other apps and websites (required):** None at runtime. All records and media are synthetic.
- **Operations and access (required):**
  - Read: `cutroom.projects.list`, `cutroom.projects.get`, `cutroom.cuts.list_notes`, `cutroom.library.search`, `cutroom.projects.audit_clearance`. Project details include authorized `asset_ids` and `resource_uris`. Library search filters by kind, query, mood, visual tags, `max_bpm` (inclusive), license scope and active status, sorted by ID. For a strictly under-115 request, exclude exact 115 matches or pass 114 for the integer-BPM fixture.
  - Write: `cutroom.cuts.add_note`, `cutroom.cuts.resolve_note`, `cutroom.projects.update_metadata`, `cutroom.projects.set_thumbnail`, `cutroom.projects.assign_track`, `cutroom.projects.set_visibility`, `cutroom.projects.schedule_release`.
  - Access PNGs via MCP `resources/list` and `resources/read` at `pale://<run>/cutroom/assets/<asset_id>`. Core checks resource permissions and audits in-scope reads in `runtime/core/mcp.cjs`. Optional `cutroom.asset.read` provides integrity metadata/SHA-256 only, not visual delivery.
  - `cutroom.projects.audit_clearance` returns `{ cleared, blockers: [{ code, target_id, message }] }`. Exactly three structured checks: all notes on the active cut are resolved (`unresolved_note`); every assigned BGM license is valid and not revoked at the effective release time, with `commercial_sponsored` required on sponsored projects (`invalid_license`); all required guest releases are `signed` (`missing_guest_release`). A timestamped license remains valid through `expires_at`; a non-expiring license has no expiry. Audit normally uses `ctx.virtual_now`; scheduling also checks the target instant. The audit does not inspect pixels or expose the visual answer in metadata.
  - Public transitions and scheduling reject as `clearance_blocked` if audit fails. Only an explicit `force_override: true` allows a simulated override, which records the actor, time, intended transition and blockers in project audit metadata. Past or present schedule times still reject. No live publishing occurs; the override is observable in synthetic evaluation.
- **State and lifecycle (required):** A single studio account per run uses `binding.json` `owner_person_id` to bind the creator. Separate personas use separate seeds. History starts on or after `2026-01-01`; interpret relative times from `ctx.virtual_now` in the account time zone. Core governs request IDs and version checks. Unknown projects, cuts, tracks or thumbnails reject without mutating business state. Re-resolving an already resolved note is idempotent. Reset restores seed records, assets and clock.
- **Events and notifications (required):** Infra-only: `env.load_seed`, `env.reset`, `env.apply_event`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and host-provided `env.advance_time`. No cross-app notifications.
  - `cutroom.cut.add_note` targets a seeded `project_id` and cut version.
  - `cutroom.license.revoke` targets a seeded `project_id` and an associated `resource_id` for a BGM license or guest release.
  - `cutroom.ab_test.update` targets a seeded `project_id` and associated thumbnail candidate IDs to update CTR/retention.
  - All three reject unknown or mismatched targets as `invalid_event`, without changing business state or clock. Identical event replays deduplicate in Core; conflicting reuse yields `idempotency_conflict`.

```json
{
  "event_id": "guest-release-withdraw-14",
  "at": "2026-11-20T11:05:00-08:00",
  "operation": "cutroom.license.revoke",
  "payload": {
    "project_id": "proj-ep14-laptop",
    "resource_id": "release-guest-maya-ep14",
    "status": "withdrawn",
    "reason": "Guest requested face blur at 06:10–06:42 before release."
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+, public runtime `1.6.0`, `core_api_version: "1.2.0"`, `ui: "none"`. UTF-8 JSON and 20–24 synthetic PNGs with a SHA-256 catalog; at most 520 KiB for PNGs and within Core's 64-asset / 1 MiB budget. New parent-resource permission mappings require platform review.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Deliverable and acceptance check | Person-days |
| --- | --- | ---: |
| Business tools | Implement library search, cut/note editing and publication transitions. Verify separate cut versions and auditable overrides. | 3–4 |
| Synthetic data and media | 6–8 projects, 18+ notes, 25+ library items, and 20–24 thumbnails/keyframe strips. Check PNG integrity and manually verify visual cues without leaking the answers in Agent metadata. No external collection. | 2–3 |
| Verification | Check unresolved note and invalid-license blockers, then swap BGM and resolve notes to reach clearance. Revoke the guest release and verify refusal, explicit override audit, and unknown-ID rollback. Check expiry at schedule time, resource access/denial, replay/conflict, clock advancement and reset with App tests and `npm run app:verify`. Record pinned versions and the JSON report. | 2–2.5 |

- **Milestones, owners and dependencies (required):** @Aria068 plans #238 ReelPulse, then #239 CutRoom, then #240 LookBoard, requesting one `/approve-plan` at a time to avoid overlapping 14-day delivery windows. After approval: tools and schemas, fixtures, then verification. Confirm the resource permission mapping with platform maintainers.
- **Resources and total effort (required):** 7–9.5 person-days; offline PNG synthesis, no external service costs.
- **Scope boundary and open questions (required):** MCP only. No GUI, MP4 encoding or streaming, live uploads, ad payouts or Mail export in v1.
- **License and external dependencies (required):** MIT for code and synthetic fixtures; no external services.
