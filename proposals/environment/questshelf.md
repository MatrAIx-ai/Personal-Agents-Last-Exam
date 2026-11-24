# QuestShelf multimodal game library and recommendation hub

**Proposed PR title** — `[Environment Proposal] [Games & play + Social & communities] QuestShelf multimodal game library and recommendation hub`

## 1. App and domains

- **Authors / GitHub handles (required):** @shangliy
- **Reference app or website / URL (required):** QuestShelf is an independently branded synthetic cross-platform game library, playtime tracker, and constraint-aware game recommender. [Backloggd](https://www.backloggd.com/) and [HowLongToBeat](https://howlongtobeat.com/) are public references for cross-platform shelves (played/playing/backlog/dropped), completion-time estimates, friend co-op lists, and negative-feedback filtering.
- **Primary domain (required):** Games & play
- **Secondary domains (optional):** Social & communities

## 2. What you plan to build

**✍️ Your answer (required):** QuestShelf lets a personal agent search a user's cross-platform game library (PC, console, handheld) and broader catalog, inspect both structured metadata (playtime estimates, platform ownership, cross-play support, offline mode, accessibility flags) and synthetic visual cover/HUD preview cards (`ctx.assets` PNGs showing camera perspective, visual darkness/horror cues, and handheld UI text readability), learn from explicit negative feedback (`dropped` reasons such as motion sickness, grind fatigue, or horror triggers, plus `muted_tags` and `not_interested` dismissals), and coordinate group game-night shortlists with friends.

### Three example requests

| User request | What the user and agent encounter | What a reviewer can check |
| --- | --- | --- |
| **Multi-constraint weekend recommendation.** “Pick a game from my backlog I can finish this weekend on my handheld during a flight — no first-person games and nothing scary.” | The user owns 14 backlog titles. The highest-rated handheld title is a 45-hour RPG (exceeds a 6–8 hour weekend budget). A 5-hour indie title has incomplete text tags, but its attached gameplay/HUD preview PNG (`ctx.assets`) clearly shows a dark first-person corridor with horror UI cues, matching the user's logged `dropped` reason (`first-person motion sickness` + `horror`). A 6-hour isometric puzzle-adventure works offline, has large handheld-readable HUD text in its preview image, and fits the user's preferences. | The agent filters by owned handheld + offline + `<= 8h` main story, inspects preview assets to catch the unlabeled first-person horror title, respects the user's dropped-history preferences, and recommends the fitting title without altering library status unless asked. |
| **Cross-play friend co-op matching.** “Find two games Alex and I both own that support cross-play for a 90-minute session tonight, and add them to our Friday poll.” | The user owns games on PC and Switch; Alex's shared profile lists only PS5 titles. Only two overlapping games support PC–PS5 cross-play with `<= 90 min` session length; one third candidate requires PS5–PS5 only and another is on the user's `not_interested` / `muted_tags` list. | The agent cross-checks platform ownership and cross-play matrices, excludes the muted and non-cross-play titles, and creates or updates the Friday game-night poll with exactly the two valid games. |
| **Negative feedback & shelf update.** “I'm dropping *Ashen Depths* — the tiny font on handheld gives me a headache and it's too grindy. Log that and refresh my top 3 recommendations.” | Logging a `dropped` entry with structured reasons (`tiny_ui_text`, `excessive_grind`) updates the user's negative-feedback profile. Subsequent calls to `recommend.rank` down-weight or filter out unplayed catalog titles sharing those triggers and replace them with readable, short-session matches. | Library shelf transitions cleanly from `playing` to `dropped` with timestamped reason codes; re-running `recommend.rank` deterministically removes grind-heavy / tiny-UI candidates and records updated state cleanly. |

**Related work.** Steam ([PR #11](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/11)) models a single-platform digital storefront (purchasing/refunds); Treefort ([PR #124](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/124)) models parental screen-time and purchase controls. Neither covers cross-platform personal game shelves, playtime budgets, negative-feedback/DNF preference tracking, visual HUD/accessibility previews, or friend co-op poll matching. QuestShelf runs completely independently in the underserved `Games & play` domain.

## 3. Potential app connections

- **Internal personal apps (required):** None required for v1. Task scenarios can supply external friend constraints or travel schedules via existing personal apps (`messages`, `calendar`, `notes`) called independently by the agent.
- **Other apps and websites (required):** None at runtime. All games, friend profiles, playtime statistics, and visual preview cards live in self-contained local synthetic fixtures.

### Integration details

- **Operations and access (required):** Agent-facing MCP tools expose: (1) `catalog.search` (filter by platform, owned/unowned, genre, tags, `max_hours`, `offline_ok`, `cross_play_platforms`, `coop_players`); (2) `game.get` (full metadata, playtime breakdown: main / main+extras / completionist, community tags, and `asset_ids` for cover + HUD preview PNGs); (3) `asset.read` (reads attached PNG cards via Core `ctx.assets.read`); (4) `shelf.list` / `shelf.upsert` (manage `backlog`, `playing`, `completed`, `dropped` entries with rating, hours logged, and structured drop reasons); (5) `preferences.get` / `preferences.update` (manage `muted_tags`, `not_interested` game IDs, preferred platforms, and accessibility constraints); (6) `recommend.rank` (deterministic constraint-aware recommender scoring eligible games from catalog/backlog using positive shelf history and negative drop/mute signals); (7) `friends.list` / `poll.create` / `poll.vote` / `poll.close` (inspect friend libraries/platforms and manage game-night polls). Privileged Infra management uses `env.setup`, `env.reset`, and `env.apply_event`.
- **State and lifecycle (required):** Catalog items, playtime stats, and preview PNGs live in the shared run fixture; shelves, drop reasons, muted tags, dismissals, and polls live in account-isolated state. Concurrent or stale writes are guarded by Core request IDs and state versions; voting twice by the same account updates rather than duplicates the vote; invalid shelf states, unknown game IDs, or voting on a closed poll reject atomically without mutating state. Reset restores baseline catalog, assets, shelves, preferences, polls, and virtual clock.
- **Events and notifications (required):** Infra applies three scripted events via `env.apply_event`: `game.update_patch` (updates metadata such as adding cross-play support, offline verification, or a new accessibility/HUD preview asset), `friend.library_update` (adds/removes a game on a friend's platform), and `poll.friend_vote` (records a friend's vote or unavailability on an open game-night poll). Replaying an identical `event_id` is idempotent; unknown game or poll IDs fail atomically. QuestShelf sends and receives no cross-app notifications in v1.

```json
{
  "event_id": "friend-alex-vote-01",
  "at": "2026-11-20T17:15:00-08:00",
  "operation": "poll.friend_vote",
  "payload": {
    "poll_id": "poll-friday-coop",
    "friend_id": "friend-alex",
    "selected_game_ids": ["game-orbit-relay"],
    "note": "Only have PS5 tonight and free for 90 mins max."
  }
}
```

- **Shared data and dependencies (required):** Node.js 18+ and public Core runtime (`runtime 1.5.0` with `ctx.assets`). Fixtures ship as UTF-8 JSON plus ~20–24 synthetic PNG cover & gameplay/HUD preview cards (~480 KiB total decoded bytes, strictly within `64-asset / 1 MiB`). The App runs standalone with only the shared Core runtime and zero external dependencies.

## 4. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| --- | --- | --- | ---: |
| Web / app construction | Implement MCP handlers (`catalog.*`, `game.get`, `asset.read`, `shelf.*`, `preferences.*`, `recommend.rank`, `friends.list`, `poll.*`), deterministic preference/constraint recommender, and lightweight local GUI view. | Verify multi-constraint search, negative-feedback re-ranking after `dropped` updates, cross-play friend intersection, poll lifecycle (create/vote/close), and read-only isolation. | 3–4 |
| Data and image collection | N/A — all games, studios, reviews, and visual preview cards are 100% fictional and synthetic. | Manifest certifies zero copyrighted game art or scraped store data. | 0 |
| Synthetic data and assets | Author 30–36 fictional cross-platform games across diverse genres/lengths, 3–4 friend profiles, 2 seeded user shelf histories, and 20–24 synthetic PNG cover & HUD/perspective preview cards (`<= 500 KiB` total) encoding visual cues (1st-person vs isometric camera, dark horror mood, HUD font size) testable by multimodal agents. | Validate JSON schema, SHA-256 asset manifest, `<= 64 assets / <= 1 MiB` budget, zero duplicate fixtures, and deterministic recommender outputs. | 2–3 |
| App integrations | All v1 workflows execute standalone inside QuestShelf on Core 1.5.0. | Run standalone verification with only QuestShelf and Core enabled. | 0 |
| Validation and reset | Write App-local business unit tests plus public-runtime verification exercising `env.apply_event` (`game.update_patch`, `friend.library_update`, `poll.friend_vote`), idempotent replay, closed-poll/unknown-ID rejections, `ctx.assets` reads, rollback, and full reset. | Publish exact runtime/App versions, CLI commands (`npm run app:verify`), and `.artifacts/` reports in the PR. | 1.5–2 |

- **Milestones, owners and dependencies (required):** Owner: @shangliy. Sequence: (1) schemas, shelf/preference/recommender engine & MCP handlers (days 1–4); (2) synthetic 30+ game catalog, friend profiles & PNG preview cards (days 5–7); (3) tests, event-injection checks & `app:verify` (days 8–10). Fits comfortably within the 14-calendar-day v1 deadline after `/approve-plan`. No blocking PR dependencies.
- **Resources and total effort (required):** 7–9 person-days total. Local Node.js 18+ and offline Python/PIL/Matplotlib asset synthesis; zero API or data acquisition costs; `< 1 MiB` total fixture size.
- **Scope boundary and open questions (required):** v1 covers cross-platform shelves, playtime budgets, negative-feedback/DNF preference tracking, multimodal cover/HUD preview cards, deterministic constraint-aware recommendations, and friend game-night polls. Out of scope: purchasing/payments, DRM downloads, live voice chat, and live store price scraping. Open question for reviewers: whether friend polls should stay self-contained in QuestShelf v1 or optionally publish invitations to Mail 1.3.0 in a later version.
- **License and external dependencies (required):** MIT License for all code, synthetic fixtures, and generated PNG assets. Backloggd and HowLongToBeat are design references only; zero external services or licensed media required.
