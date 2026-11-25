# QuestShelf (PALE Environment Track App)

Multimodal cross-platform game library, negative-feedback recommender, and friend co-op poll hub built for PALE Core `1.2.0` (`runtime 1.6.0`, `ui: "none"`, zero external dependencies, MIT License).

## Package Highlights

- **20 synthetic cross-platform games** (`fixtures/minimal.json`) + **2nd user shelf seed** (`fixtures/seed-casual.json`), all historical timestamps `>= 2026-01-01`.
- **20 verified synthetic PNG cover & HUD preview cards** (`assets/`, `109.0 KiB` total decoded bytes, SHA-256 cataloged in `contribution/assets.catalog.json`, strictly within the `64-asset / 1 MiB` budget).
- **Evaluation-only visual cue sheet** (`fixtures/visual-cues.eval.json`) recording intended camera perspective, horror cues, and handheld HUD readability — never exposed to Agent-facing tools.
- **14 MCP tools** (8 read-only, 6 versioned writes) + **3 Infra events** (`questshelf.game.update_patch`, `questshelf.friend.library_update`, `questshelf.poll.friend_vote`).
- **MCP Resources image delivery:** Agents list and inspect preview PNGs via `resources/list` and `resources/read` on `pale://<run>/questshelf/assets/<asset_id>`. `questshelf.game.get` returns both `asset_ids` and resolved `resource_uris`. `questshelf.asset.read` is also available for SHA-256 / descriptor verification via `ctx.assets.read`.

## Key Behavioral Guarantees

1. **Poll expiration visibility (`questshelf.poll.list`):** Once `ctx.virtual_now > poll.closes_at` without an explicit `questshelf.poll.close`, the poll remains `status: "open"` while `questshelf.poll.list` sets derived `voting_expired: true`. Both `questshelf.poll.vote` (`invalid_state`) and `questshelf.poll.friend_vote` (`invalid_event`) reject late votes atomically, while `questshelf.poll.close` remains callable to tally existing votes and seal `winner_game_ids`.
2. **Prewritten events targeting Agent-created polls:** At most one `open` poll per account is allowed at a time (`questshelf.poll.create` returns `conflict` otherwise; `questshelf.poll.update` edits the open poll). When `questshelf.poll.friend_vote` omits `poll_id`, QuestShelf deterministically matches the account's single `open` poll inviting `friend_id`, rejecting no-open-poll, closed/expired-poll, uninvited-friend, or non-candidate-game cases atomically as `invalid_event`.
3. **Structured-fields-only ranking (`questshelf.recommend.rank`):** Ranking uses only structured JSON fields (never image pixels or `visual-cues.eval.json`), preserving Example 1's multimodal trap on `game-lantern-hollow`.

## Local Setup & Verification

Requires Node.js 18+ (no `npm install` needed).

```bash
# Standalone App-only checks (inside apps/questshelf)
cd apps/questshelf
npm test
npm run example

# Full PALE public runtime verification (from repo root)
npm run app:verify -- --app apps/questshelf --output .artifacts/questshelf.json

# Direct MCP stdio launch (Infra / Agent)
node apps/questshelf/service.cjs --role infra --run demo
node apps/questshelf/service.cjs --role agent --run demo
```

## Workflow-to-Test Mapping

| Proposal workflow / acceptance check | Covered in |
| --- | --- |
| Example 1: Weekend handheld offline filter + `game-lantern-hollow` visual trap + MCP `resource_uris` | `tests/business.test.cjs` test 1 |
| Example 2: Cross-play PC–PS5 co-op match with `friend-alex` (exact 2 games) | `tests/business.test.cjs` test 2 |
| Example 3: Dropping `game-ashen-depths` (`tiny_ui_text`, `excessive_grind`) deterministic Top-3 shift | `tests/business.test.cjs` test 3 |
| Acceptance: Agent `poll.create`/`poll.update` + prewritten `friend_vote` omitting `poll_id` + rejected controls | `tests/business.test.cjs` test 4, `examples/run.cjs` |
| Infra `game.update_patch` & `friend.library_update` + `add_asset_id` URI/ref sync | `tests/business.test.cjs` tests 5 & 9 |
| `poll.list` past `closes_at` (`status: "open"`, `voting_expired: true`, late vote rejection) | `tests/business.test.cjs` test 7 |
| 2nd user history seed (`seed-casual.json`) & evaluation visual cues coverage | `tests/business.test.cjs` test 8 |
| Atomic rejection on unknown IDs + full Core MCP lifecycle/reset/idempotency | `tests/business.test.cjs` test 6, `npm run app:verify` |

## Scope & Limitations

- Synthetic fixtures only; no live store APIs, DRM downloads, payments, or external network access.
- `ui: "none"` in v1; polls remain self-contained (optional Mail 1.3.0 invitations deferred post-v1).
- Local asset bundle budget: at most 64 assets / 1 MiB decoded bytes.
