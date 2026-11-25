# Dayline

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Dayline is a fictional multi-outlet news reader for personal-agent tasks. An agent can open several publishers' accounts of the same event, see which editions the reader has already read or saved, and use bylines, credits, text and publication times to tell the reader what changed and who reported it.

- **Proposal:** [Environment proposal #213](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/213) (`proposals/environment/dayline.md`), plan approved at `7d2c59d544f86d1afaca4bd83e3dc5f409450547`. Per the approval, Dayline is a standalone package rather than an extension of Belltower (#172); its relationship to Wirewalk (#209) is unchanged (related, independent).
- **Domain:** News & information.
- **Interface:** Agent MCP and Infra MCP through the public runtime. MCP only: no GUI and no reviewer console.
- **Dependencies:** Node.js 18+ and the public runtime 1.6.0 (Core API 1.2.0) at reference revision `a4bce02`. No other Apps, packages, network access or credentials.

## Model

| Record | Owner | Notes |
| --- | --- | --- |
| `outlets` | public catalog | Six fictional publishers: a wire service, local, regional, state and national papers, and a Spanish-language regional daily. |
| `stories` | public catalog | Editor-assigned story groups. A group stays hidden from the Agent until at least one edition is filed under it, so a task can pre-declare a group for a later event without leaking it. |
| `editions` | public catalog | Outlet, section, geography, language, headline, byline, text, publisher-disclosed `credits` (links to earlier editions), publisher `published_at`, and `added_at` (when Dayline committed it). Editions are immutable. |
| `front_pages` | public catalog | Regional (`local`, `state`) and section (`national`, `world`, `sports`) pages in editorial order. |
| `reading_history` | private reader state | One entry per edition the reader has read. Only `dayline.history.mark_read` adds to it. |
| `reading_list` | private reader state | Saved editions. Saving twice leaves one entry. |

Each App instance holds one reader account (`account_id`, `owner_person_id`, bound through the task binding) and a copy of the run's public catalog. Two readers are two instances loaded with the same catalog. **Infra applies every `edition.publish` event to every reader instance in the run**, so the catalogs stay identical. `examples/mcp-walkthrough.cjs` shows this for two readers.

## Agent tools

| Tool | Effect | Purpose |
| --- | --- | --- |
| `dayline.outlets.list` | read | Publishers and desks with kind, language and geography |
| `dayline.front_pages.list` | read | Available front pages and entry counts |
| `dayline.front_page.get` | read | One front page in editorial order with read/saved flags |
| `dayline.search` | read | Case- and accent-insensitive search where each query word must match the start of a word, plus outlet, section, geography, language, story and time filters |
| `dayline.story.get` | read | All editions in a story group, oldest publication first |
| `dayline.edition.get` | read | Full text, credits and this reader's read/saved status |
| `dayline.history.list` | read | Private reading history, most recent first |
| `dayline.saved.list` | read | Private reading list, most recently saved first |
| `dayline.history.mark_read` | write | Explicitly record an edition as read |
| `dayline.saved.add` | write | Save an edition; returns `{edition_id, saved, changed}` and never the headline |
| `dayline.saved.remove` | write | Remove a saved edition |

- Reads never change the reading history.
- Writes require `expected_version` and `request_id`. Core rejects a stale version (`stale_version`), returns the original receipt for an identical retry (`duplicate: true`), and rejects a reused request ID with different arguments (`idempotency_conflict`).
- Several writes in one session share the virtual clock; lists then order them by write order, latest first.
- Results for invalid targets, all leaving state unchanged:
  - an unknown edition, story or front page returns `not_found`;
  - removing an edition that is not saved returns `not_found`;
  - saving or marking an already-saved or already-read edition succeeds with `changed: false`.
- The package `scenario` policy allows only reads. A task grants the write tools in its own policies (see `examples/task-data/policies.json`). Core's policy `constraints.ids` compares an `id` argument, and Dayline tools take `edition_id`, `story_id` or `front_page_id`. Restrict access with the `allow` list instead.

## Incoming event: `edition.publish`

Infra applies one event type. Its payload is a complete edition plus optional `front_page` and 1-based `position`, which must be supplied together. `examples/scenario.json` is the approved proposal's example verbatim. As a management call on the Infra connection, using the version returned by a fresh `env.snapshot` (the walkthrough's evidence report records the exact call it made):

```json
{
  "method": "tools/call",
  "params": {
    "name": "env.apply_event",
    "arguments": {
      "expected_version": {"epoch": 2, "revision": 0},
      "event": {
        "event_id": "rail-local-morning",
        "at": "2026-10-14T07:10:00-07:00",
        "operation": "edition.publish",
        "payload": {
          "edition_id": "rail-local-2", "story_id": "rail-funding", "outlet_id": "valley-daily",
          "section": "transport", "geography": "valley", "language": "en",
          "headline": "Eastbank will be the first station repaired", "byline": "Mara Bell",
          "text": "The board approved rail repairs Tuesday. In an interview with the Valley Daily, the project lead named Eastbank as the first station.",
          "credits": [{"edition_id": "rail-wire-1", "credit": "Wire service reporting on the vote"}],
          "published_at": "2026-10-14T07:05:00-07:00", "front_page": "local", "position": 1
        }
      }
    }
  }
}
```

- The edition becomes visible when the event commits. `added_at` is the event's `at`, even when the publisher's `published_at` is earlier. A `published_at` later than `at` is rejected.
- Inserting at `position` shifts later entries down and keeps their relative order. `position` may be at most one past the current end.
- The whole event fails with `invalid_event` and nothing changes for any of these:
  - an unknown story, outlet, credited source edition or front page;
  - an out-of-range position;
  - an already-published edition ID;
  - blank text or a repeated credit;
  - a credit to an edition published later.
- Core returns the original receipt for a replay of the same `event_id` and rejects the same ID with different content (`idempotency_conflict`).

## State and time

- Infra loads a run's catalog and the bound reader's history with `env.load_seed`, applies events with `env.apply_event`, advances the clock with `env.advance_time`, and restores the loaded baseline with `env.reset`. None of these are available on the Agent connection.
- Reset restores the loaded editions, front pages, history, bookmarks and clock of that instance only.
- `ctx.virtual_now` is the reader's "now". Agent reads and writes do not advance it; `read_at` and `saved_at` take its value.
- Load a seed at or after its latest record. Dayline does not compare seed dates with the clock, because a run may start before an App's sample fixture and Core validates package fixtures when it registers them. A private write on an edition dated after the clock fails with `invalid_state` and changes nothing.
- `fixtures/clock.json` sets the App-only example time (Wednesday, Oct. 14, 2026, 07:00 Pacific).

## Fixtures

All text is original and fictional (see `contribution/dataset.json`).

- `fixtures/minimal.json`: 25 editions (26 with the scenario event) in 9 story groups from 6 outlets, in English and Spanish, for reader Ana Torres (`dayline-ana`). Ana read the rail-vote wire dispatch last night and has one saved edition.
- `examples/scenario.json`: at 07:10 the Valley Daily publishes `rail-local-2`, which adds an interview naming Eastbank as the first station to be repaired, at position 1 of the `local` front page.
- `examples/task-data/`: reader Ben Ikeda (`dayline-ben`) at 07:20, after the event, having already read the expanded edition. It ships its own `dataset.json` with the matching record count. The walkthrough reproduces this seed exactly from the minimal catalog plus the event.

| Workflow | Data a task can use |
| --- | --- |
| Morning briefing | Story `rail-funding` holds a pre-vote preview (`rail-wire-0`), the original wire dispatch (`rail-wire-1`), two straight reprints under new headlines (`rail-local-1`, `rail-harbor-1`, identical text) and the locally expanded `rail-local-2`. After the event the Valley page reads `rail-local-2`, `library-1` (weekend library hours), then the reprint `rail-local-1`. `budget-courier-1` leads the state page; `election-standard-1` leads the world page. |
| Family travel | The national headline `strike-standard-1` names no airports. The Spanish regional report `strike-faro-1` confirms that the stoppage covers all of Friday, Oct. 16 at San Telmo and Bahía Honda, and that Puerto Claro talks continue. `strike-wire-1` republishes it in English with a translation credit. An older Monday report, `strike-faro-0`, threatened every airport. |
| Sports without spoilers | `gulls-recap-1` is the full recap and `gulls-wire-recap-1` the short wire brief; both headlines reveal the result, as does the local-angle `gulls-valley-1`. The preview `gulls-preview-1` and the schedule `gulls-schedule-1` are scoreboard-free. The next game is Friday, Oct. 16, 7:10 p.m. CDT at Lakeport. The task supplies the reader's time zone. |

Expected answers and spoiler checks for a real task belong in that task's evaluator, not in this package.

## Commands

From this directory:

```sh
npm test              # App-only business tests (no runtime needed)
npm run example       # App-only edition.publish walkthrough
npm run walkthrough   # Real MCP evidence report (JSON on stdout); needs the public runtime
```

From the repository root:

```sh
npm run app:verify -- --app apps/dayline --output .artifacts/dayline.json
```

`npm run walkthrough` finds the runtime the same way `service.cjs` does: by walking up to the checkout, or through `PALE_RUNTIME_ROOT`.

## Proposal checks and evidence

The walkthrough's report covers all of the following:
- a scripted reference agent's reply to each of the three requests, checked against what each reader saw;
- a trace of every call, joined to run, account, connection and request/event ID;
- the snapshot taken before reset;
- the exact `env.apply_event` call it made.

These replies are reference evidence for the data and tools, not model-agent trials. Only the morning briefing is assembled by code from tool output. The travel and sports replies use hand-written wording, with the outlet names, the saved edition ID and the converted game time filled in from tool results. The walkthrough checks each reply's facts against the editions the reader opened. The report's `reference_reply_sources` says which reply is which.

| Proposal quality check | Evidence |
| --- | --- |
| Open one story from two sections | Walkthrough: `valdora-strike` is reached from the `world` section (World front page) and the `transport` section (section search), then opened with `dayline.story.get` |
| Trace a credited edition | Walkthrough family-travel step (English wire → Spanish source); tests *one story group...*, *Spanish and English airport-strike editions...* |
| Save and remove a recap | Walkthrough sports step; test *saving twice leaves one bookmark...* |
| Private state across two account instances | Walkthrough: two instances, the same event applied to both, identical catalogs, separate history and bookmarks, reset isolation; test *two reader instances...* |
| Event injection, publication order, failure atomicity | Walkthrough and tests *edition.publish inserts...*, *an unknown story, outlet...*, *edition.publish rejects inconsistent timing...*; public verifier |
| Version conflicts, repeat saves, reset | Walkthrough (stale `expected_version`, identical and conflicting `request_id`, conflicting `event_id`, reset to the loaded data and clock); public verifier |
| Morning answers against what each account saw | Walkthrough: Ana's briefing leads with the station interview; Ben's with the library story; neither spends a slot on a reprint |
| Airport facts and sources | Walkthrough: the travel reply names the two confirmed airports, leaves Puerto Claro unresolved, cites El Faro del Litoral and promises nothing about the flight |
| Saved recap ID and user-visible sports response | Walkthrough: the save returns only the ID; the reply and link text carry the ID and the next game in the reader's time zone, and no result |
| Every credit and edition link valid | Seed validation in `src/model.cjs`; test *seed validation rejects...* |

## Package map

| Path | Contents |
| --- | --- |
| `app.json`, `package.json`, `service.cjs`, `plugin.cjs` | Manifest, commands, provided launcher, hook exports |
| `tools.json` | The 11 Agent tools with input/output schemas |
| `src/model.cjs` | Seed and edition consistency rules (`validateSeed`, shared `checkEdition`) |
| `src/catalog.cjs` | Lookups, agent-facing summaries and search |
| `src/operations.cjs` | Agent tool handlers |
| `src/events.cjs` | `edition.publish` handler |
| `src/domain-utils.cjs`, `src/diagnostics.cjs` | Shared helpers and the optional, ID-only diagnostics adapter |
| `schemas/` | Seed, event and state schemas plus the shared dataset/catalog contracts |
| `contribution/` | Contribution declaration, dataset provenance, empty asset catalog |
| `fixtures/` | Minimal seed (Ana), binding, policies, clock |
| `examples/` | App-only example, approved event, task-data for Ben, real-MCP walkthrough |
| `tests/` | Business tests, App-only harness, verifier cases, schema validator |
| `dev/` | Maintainer scripts that regenerate the schemas, `tools.json`, fixtures, task data and dataset counts (`npm run build:contracts`, `npm run build:fixtures`). Not run by tests or the verifier. |

## Limitations

- Text editions only: no images, video, audio or paywalls. No attachments or media: resources are not used.
- Story groups are assigned by the fixture or event author; there is no automatic clustering.
- No live ingestion or external links; every edition is a synthetic record inside the App.
- One reader account per App instance; the public catalog is copied into each instance, so Infra applies every event to every reader instance.
- Search matches the start of words; there is no ranking or stemming.
- MCP only: no GUI and no reviewer console.
