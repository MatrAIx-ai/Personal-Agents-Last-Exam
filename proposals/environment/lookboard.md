# LookBoard multimodal visual discovery, moodboard search and compatibility recommender

**Proposed PR title** — `[Environment Proposal] [Shopping & groceries + Home & utilities] LookBoard multimodal visual discovery, moodboard search and compatibility recommender`

## 1. App and domains

- **Authors / GitHub handles (required):** @Aria068
- **Reference app or website / URL (required):** Synthetic visual catalog and moodboards inspired by [Pinterest](https://www.pinterest.com/) and [IKEA Kreativ](https://www.ikea.com/).
- **Primary domain (required):** Shopping & groceries
- **Secondary domains (optional):** Home & utilities

## 2. What you plan to build

**✍️ Your answer (required):** LookBoard searches a synthetic catalog using dimensions, care, material and price constraints. Agents inspect product and swatch PNGs as MCP resources before recommending or pinning items. Private and shared boards retain budgets, collaborator notes and item vetoes; a separate taste profile stores negative preferences.

| Example request | Setup and expected result |
| --- | --- |
| “Find a washable rug under $220 and two matching pillows for Living Room Refresh.” | The sofa swatch is warm sage. Reject the 240 cm wool rug; the board allows at most 185 cm and excludes wool. Another rug fits the structured constraints but its PNG is neon coral. Inspect the images, reject the clashing rug, and pin one compatible rug and two pillows. |
| “Finalize Guest Bedroom for weekend shopping and remove anything Sam vetoed.” | Sam vetoes the low platform bed and sets a $450 board cap. Remove it, use the budget summary to check the remaining pins, and swap a lamp for a saved alternative or flag the excess. Leave private boards untouched. |
| “Hide glossy chrome and faux leather and recommend three warm-wood desk organizers.” | Save both materials in `avoid_materials`, rerun recommendations, and verify the top three fit the depth constraint without changing existing pins. |

**Related work:** [FreshCart #37](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/37) covers grocery checkout, [PriceWatch #221](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/221) price monitoring, [Porchswap #186](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/186) local resale, and [Ribbonwell #225](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/225) gift wish lists. LookBoard combines visual comparison and physical fit with board budgets and collaborator preferences.

## 3. Potential app connections

- **Internal personal apps (required):** None in v1. Tasks may supply room measurements or partner preferences through Notes or Messages independently.
- **Other apps and websites (required):** None at runtime. Catalog, boards and assets are synthetic.
- **Operations and access (required):**
  - Reads: `lookboard.catalog.search`, `lookboard.item.get`, `lookboard.boards.list`, `lookboard.boards.get`, `lookboard.boards.budget_summary`, `lookboard.taste.get`, `lookboard.recommend.for_board`. Catalog filters include category, dimensions, price, materials, stock, care attributes, palette and query. `lookboard.item.get` returns item details, `asset_ids` and authorized `resource_uris`.
  - Writes: `lookboard.boards.create`, `lookboard.boards.update`, `lookboard.boards.pin_item`, `lookboard.boards.unpin_item`, `lookboard.taste.update`. Pinning on an unlocked board can exceed its budget; the tool reports `budget_exceeded`, `total_usd` and `remaining_usd` so the Agent can resolve it.
  - Read swatch and item PNGs via MCP `resources/list` and `resources/read` at `pale://<run>/lookboard/assets/<asset_id>`. Core checks parent-resource permissions and audits in-scope reads in `runtime/core/mcp.cjs`. Optional `lookboard.asset.read` is for integrity metadata and SHA-256 verification only.
  - `lookboard.recommend.for_board` takes `board_id`, optional `category` and `limit` (default 5). Require in-stock items that meet the board's applicable dimensions (including category-specific bounds), washability, pet-safety and remaining budget. Exclude pins, dismissals, vetoed items, excluded materials (board or taste), and hidden styles.
  - Score with `round2(style_match * 0.50 + palette_match * 0.30 + budget_fit * 0.20)`, descending, then ascending lexicographically by `item_id`. Tag matches are the fraction of target tags present on the item, or zero if no target tags are set. For a capped board, `budget_fit = max(0, 1 - price_usd / max(1, remaining_budget))`; for an uncapped board it is `1`. The tool never inspects pixels. The neon-coral fixture has generic structured tags, so discovering the clash requires reading the PNG.
- **State and lifecycle (required):** One account per run, bound via `owner_person_id` in `binding.json`; separate user personas use separate seeds. Collaborators are board records, not additional Agent accounts. Names are unique within the account after case-insensitive normalization. History starts on or after `2026-01-01`; interpret relative times against `ctx.virtual_now`. Core governs request IDs and version checks. Duplicate pins are idempotent; writes to locked boards and invalid IDs or dimensions reject atomically. Reset restores boards, taste, catalog, assets and clock.
- **Events and notifications (required):** Infra-only: `env.load_seed`, `env.reset`, `env.apply_event`, `env.snapshot`, `env.event_status`, `env.validate_bundle`, and host-provided `env.advance_time`. No cross-app notifications.
  - `lookboard.board.collaborator_note` takes exactly one of `board_id` or `board_name`. Name matching is case-insensitive within the account and includes Agent-created boards. Reject unknown, private or locked boards, an unauthorized collaborator, or an unknown veto item as `invalid_event`, with no business-state or clock change.
  - `lookboard.catalog.stock_update` updates stock, price or dimensions. Unknown items or invalid values reject as `invalid_event`. Core deduplicates identical events and returns `idempotency_conflict` for changed content under the same `event_id`.

```json
{
  "event_id": "collab-sam-veto-02",
  "at": "2026-11-19T18:10:00-08:00",
  "operation": "lookboard.board.collaborator_note",
  "payload": {
    "board_name": "Guest Bedroom",
    "author": "Sam",
    "action": "veto_item",
    "item_id": "item-low-platform-bed-03",
    "budget_cap_usd": 450
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+, public runtime `1.6.0`, `core_api_version: "1.2.0"`, `ui: "none"`. UTF-8 JSON and 20–24 synthetic PNGs with a SHA-256 catalog; up to 480 KiB for PNGs within the 64-asset / 1 MiB Core budget. New parent-resource permission mappings require platform review.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Deliverable and acceptance check | Person-days |
| --- | --- | ---: |
| Business tools | Implement search, pinning, budget reporting, tastes and deterministic ranking. Verify read-only operations preserve business state. | 3–4 |
| Synthetic data and media | 32–36 catalog items, 3–4 seeded boards and 20–24 swatch/product PNGs. Check hashes, visual cues and that the Agent cannot read evaluator answers. No external collection. | 2–3 |
| Verification | Create a shared board and apply a prewritten event by differently cased `board_name`; verify veto and budget, plus locked/unknown board and unknown item controls. Compare top three before and after the taste edit; check pins, ranking tie-breaks, resource access/denial, event replay/conflict, virtual time and reset via App tests and `npm run app:verify`. Record pinned versions and the JSON report. | 2–2.5 |

- **Milestones, owners and dependencies (required):** @Aria068 plans to request plan approval for #238 ReelPulse first, then #239 CutRoom, then #240 LookBoard, one `/approve-plan` at a time to avoid overlapping 14-day delivery windows. LookBoard stays Draft until its turn. After approval: tools and schemas, then fixtures, then verification. Confirm the resource permission mapping with platform maintainers.
- **Resources and total effort (required):** 7–9.5 person-days; offline PNG synthesis, no external service costs.
- **Scope boundary and open questions (required):** MCP only. No GUI, checkout, delivery tracking, live catalog scraping or AR.
- **License and external dependencies (required):** MIT for code and synthetic fixtures; no external services.
