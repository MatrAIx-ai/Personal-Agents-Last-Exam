# ReelPulse multimodal social media and creator community studio

**Proposed PR title** — `[Environment Proposal] [Social & communities + Media & entertainment] ReelPulse multimodal social media and creator community studio`

## 1. App and domains

- **Authors / GitHub handles (required):** @Aria068
- **Reference app or website / URL (required):** Synthetic creator workspace inspired by [Instagram](https://www.instagram.com/) and [TikTok](https://www.tiktok.com/). No live platform access.
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** Media & entertainment

## 2. What you plan to build

**✍️ Your answer (required):** ReelPulse manages carousel and short-video drafts, audience visibility, sponsorship checks, comments, and topic and posting-slot recommendations. The Agent opens slide and cover PNGs as MCP resources to check for potential visual privacy or disclosure issues.

| Example request | Setup and expected result |
| --- | --- |
| “Publish my weekend hike carousel publicly at 6 PM today.” | Slide 2 shows a street number and the face/badge of a friend who permits only `close_friends` sharing. Neither clue is supplied in post metadata. The Agent reads the PNG and leaves the post in `draft` unless the user authorizes a narrower audience. It cites Slide 2 and does not treat narrower visibility as fixing the street-number risk. |
| “Schedule my coffee-gear reel for Friday noon and pin the promo-code comment.” | A sponsorship requires `paid_partnership: true`, forbids `#competitorbrand`, and has an embargo extended to November 22 at noon Pacific. The Agent fixes the disclosure and tag, flags the unavailable Friday slot, and uses a permitted time only if authorized. It reports that pinning must wait if the promo-code comment does not yet exist. |
| “Hide spam on my last three posts and suggest two topic angles and time slots for next week.” | Hide only the identified spam. With the seeded rates below, tutorial slots on Tuesday and Thursday outrank high-view clickbait. Report the rates rather than only raw views. |

**Related work:** [Wirewalk #209](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/209) is a read-only feed, [Postyard #168](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/168) a text publisher, [Fernshelf #194](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/194) a private photo archive, and [Stoopside #26](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/26) an events app. ReelPulse combines visual preflight with audience controls and creator moderation.

## 3. Potential app connections

- **Internal personal apps (required):** None in v1. A task may independently use Messages or Mail as user context.
- **Other apps and websites (required):** None at runtime. All records and media are synthetic.
- **Operations and access (required):**
  - Read: `reelpulse.posts.list`, `reelpulse.posts.get`, `reelpulse.posts.search`, `reelpulse.comments.list`, `reelpulse.sponsors.list`, `reelpulse.sponsors.get`, `reelpulse.circles.get`, `reelpulse.analytics.summary`, `reelpulse.recommend.slots`. Search by status, visibility, tags, caption or date. `reelpulse.posts.get` includes revisions, `asset_ids` and `resource_uris` for authorized assets.
  - Write: `reelpulse.posts.create_draft`, `reelpulse.posts.update_draft`, `reelpulse.posts.schedule`, `reelpulse.posts.publish`, `reelpulse.posts.set_visibility`, `reelpulse.posts.unpublish`, `reelpulse.comments.hide`, `reelpulse.comments.reply`, `reelpulse.comments.pin`, `reelpulse.circles.update_member`. Draft state is distinct from the `close_friends`, `subscribers` and `public` audiences. Schedule, publish and visibility expansion enforce applicable sponsorship rules. Missing disclosure, forbidden tags or embargo violations yield `compliance_error` without a business-state change.
  - Read PNGs via MCP `resources/list` and `resources/read`, using `pale://<run>/reelpulse/assets/<asset_id>`. Core applies parent-resource permissions and audits in-scope reads in `runtime/core/mcp.cjs`. The MCP representation may use a binary `blob`; visual delivery does not rely on a JSON business tool. An optional `reelpulse.asset.read` would return integrity metadata/SHA-256 only, subject to the same permission checks.
  - `reelpulse.recommend.slots` accepts optional `format` (`carousel` or `reel`) and `limit` (default 3). Filter published posts to the requested format and exclude zero-view samples. For each `(topic_angle, day_slot)` bucket, compute the arithmetic mean of per-post rates, then `slot_score = round2(avg_save_rate * 0.55 + avg_completion_rate * 0.35 - avg_negative_feedback_rate * 0.60)`. Negative feedback is `(unfollows + not_interested) / views`; save and completion rates are saves/views and completions/views. Sort descending by rounded score, then ascending lexicographically by `slot_id`. Example input rates `(save, completion, negative)`: Tuesday `(0.03, 0.70, 0.004)` scores `0.26`, Thursday `(0.03, 0.60, 0.006)` scores `0.22`, clickbait `(0.01, 0.40, 0.04)` scores `0.12`. Neither ranking nor publication logic reads pixels; visual findings require the Agent to inspect the PNG.
- **State and lifecycle (required):** Each run has one creator account in `binding.json`; `owner_person_id` maps to a declared person. Use independent seeds for different personas. History starts on or after `2026-01-01`; resolve relative times against `ctx.virtual_now` in the account time zone. Posts keep revision and moderation history. Writes use Core request IDs and expected epoch/revision checks as applicable. Repeated hide/publish requests with the same intended outcome are idempotent; invalid IDs and schedules at or before the current virtual time reject atomically. Reset restores the loaded seed, assets and virtual clock.
- **Events and notifications (required):** Infra-only: `env.load_seed`, `env.reset`, `env.apply_event`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and host-provided `env.advance_time`. No cross-app notification channels.
  - `reelpulse.comment.create` and `reelpulse.engagement.snapshot` target the explicitly supplied `post_id`; only when omitted, target the latest published post at event time by `published_at` descending, breaking ties by `post_id` ascending. Unknown or unpublished explicit targets, or no published fallback, yield `invalid_event` with no business-state or clock change.
  - `reelpulse.sponsor.update` matches a seeded `sponsor_id` and may change disclosure, embargo, status or forbidden tags. Reject unknown IDs, mismatched post references and malformed timestamps atomically as `invalid_event`. Identical event replays deduplicate in Core; changed content under the same `event_id` yields `idempotency_conflict`.

```json
{
  "event_id": "sponsor-embargo-shift-01",
  "at": "2026-11-19T14:20:00-08:00",
  "operation": "reelpulse.sponsor.update",
  "payload": {
    "sponsor_id": "sp-roastcraft-q4",
    "post_id": "post-draft-grinder-reel",
    "earliest_publish_at": "2026-11-22T12:00:00-08:00"
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+, public runtime `1.6.0`, `core_api_version: "1.2.0"`, `ui: "none"`. UTF-8 JSON and 20–24 synthetic PNGs with a SHA-256 catalog; under 500 KiB for PNGs and within Core's 64-asset / 1 MiB budget. New parent-resource permission mappings require platform review.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Deliverable and acceptance check | Person-days |
| --- | --- | ---: |
| Business tools | State transitions and schemas, sponsorship checks, moderation and deterministic ranking. Check that reads leave business state unchanged. | 3–4 |
| Synthetic data and media | 18–22 posts/drafts, 45+ comments, 3–4 sponsorship briefs, engagement history and 20–24 PNGs. Keep visual cue answers outside the Agent-facing data. Verify hashes and inspect the PNGs. No external collection. | 2–3 |
| Verification | Publish a draft, then apply a prewritten comment event without `post_id` and confirm it hits that post. Test unpublished, unknown and no-match cases; check embargo/disclosure controls, ranking/ties, event replay/conflict, resource access/denial, clock advancement and reset with App tests and `npm run app:verify`. Record pinned versions and the JSON report. | 2–2.5 |

- **Milestones, owners and dependencies (required):** @Aria068 plans to request approval in this order: #238 ReelPulse, #239 CutRoom, #240 LookBoard. Request one `/approve-plan` at a time to avoid overlapping 14-day delivery windows. After approval: tools and schemas, then fixtures, then verification. Confirm the resource permission mapping with platform maintainers.
- **Resources and total effort (required):** 7–9.5 person-days; offline PNG synthesis, no external service costs.
- **Scope boundary and open questions (required):** MCP only; no GUI, live publishing, playback, transcoding, DMs, or ad billing. Visual inspection is an Agent action, not a server-side classifier.
- **License and external dependencies (required):** MIT for code and synthetic fixtures; no external services.
