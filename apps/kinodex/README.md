# Kinodex

Self-contained PALE App package, version 1.0.0, Core API 1.2.0. Kinodex is a fictional film and TV guide used by one person. An agent can answer "what should we watch, where, and is it OK for us" from that person's facts: the services they pay for, the region they live in, what they have already seen and how they usually rate. Kinodex sits above the streaming services and plays nothing.

- **Proposal:** [Environment proposal #226](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/226) (`proposals/environment/kinodex.md`). Plan approved by Chenngzz at `907cc505306baeca5250f4fadbf50cbed2024659`. The approval left three items for implementation; [Review items resolved](#review-items-resolved) explains each.
- **Domain:** Media & entertainment.
- **Interface:** Agent MCP and Infra MCP through the public runtime. The proposal promises MCP only: there is no GUI and no reviewer console.
- **Dependencies:** Node.js 18+ and the public runtime 1.6.0 (Core API 1.2.0) at reference revision `a4bce02`. No other Apps (`dependencies.required_apps` is empty), packages, network access or credentials. Messaging `publishes` and `receives` are empty.

## Model

One App instance holds the public catalog and one bound account. A second account is a second instance loaded with the same catalog. Infra applies every catalog event (`offer.publish`, `offer.end`, `title.update`) to every account instance in the run so that the catalogs stay identical. The walkthrough does this for two accounts.

| Record (seed key) | Owner | Notes |
| --- | --- | --- |
| `services` | catalog | Six invented services, each with its regions (`US`, `UK`, `CA`) and offer types. |
| `titles` | catalog | A film or series, with genres, synopsis, `editions` (each with `edition_id`, label and runtime), `releases` (date and certification per region) and, for series, `seasons`. Every title has at least one edition. |
| `episodes` | catalog | Season, number, name, synopsis, air date and runtime of a series episode. |
| `people`, `credits` | catalog | A credit links a person to a title with a role, character and billing order. |
| `guides` | catalog | One parental guide per title, as a list of versions. Each version has five categories (`violence`, `language`, `sexual_content`, `frightening`, `substances`). Each category has a severity (`none`, `mild`, `moderate` or `severe`), a spoiler-safe summary and items with a `spoiler` flag. Each version records its reason: `seed`, `published_update` or `correction_approved`. |
| `offers` | catalog | Links a title (optionally one edition) to a service and region. Type is `subscription`, `rent`, `buy` or `free_with_ads`. Rent and buy carry a price and currency. Each offer has `available_from` and an optional `available_until`. |
| `public_reviews` | catalog | Other people's reviews, with a half-star rating and a `contains_spoilers` flag. |
| `account` | account | Region, `time_zone` (IANA name, used for "today"), subscribed `service_ids`, and `settings_version` (App field). |
| `watchlist` | account | One ordered list of titles with `version` (App field, read as `watchlist_version`). |
| `diary` | account | Entries for a title, or for episodes of a series. Each has an optional edition, `watched_on` date, `rewatch`, `watched_with` (`person_id`s from the binding), an optional half-star rating and an optional review (`contains_spoilers`, visibility `private`, `friends` or `public`). |
| `lists` | account | Custom lists with name, description, visibility, ordered titles and `version` (App field, read as `list_version`). |
| `alerts` | account | Alert rules. Stored status is `active`, `triggered` or `deleted`; reads derive `expired` from the clock, and read a trigger or deletion dated after the clock as `active` (see [Clock cutoff](#clock-cutoff)). A triggered rule keeps its `trigger`. |
| `corrections` | account | Corrections the account submitted, with target, proposed and current value, evidence, status and every decision. |
| `notices` | account | In-app notices written by events. |
| `activity` | account | One row per committed write or applied event (see [State and time](#state-and-time)). |

The account and owner are bound through the run's `binding.json`. The acting person is always the binding's `owner_person_id`, never an argument. `watched_with` uses the binding's `person_id`s, so a task that also uses Contacts can give the same people the same IDs. Kinodex keeps no contact details.

## Agent tools

32 tools: 18 reads and 14 writes. Every write needs Core's `expected_version` (`{epoch, revision}`) and a `request_id`.

| Tool | Effect | Purpose |
| --- | --- | --- |
| `kinodex.titles.search` | read | Words in name, synopsis or genres (start-of-word, case- and accent-insensitive), plus kind, genre, year and on-watchlist filters |
| `kinodex.titles.get` | read | Title with editions, releases, seasons, episodes and the current guide. Accepts `hide_spoilers` and `as_of_person` |
| `kinodex.episodes.list` | read | A series' episodes, optionally one season. Accepts `hide_spoilers` and `as_of_person` |
| `kinodex.people.get` | read | A person and every credit they hold |
| `kinodex.credits.list` | read | A title's credits in billing order |
| `kinodex.guide.get` | read | Current guide version, or an earlier one with `version`; the version history; `hide_spoilers` |
| `kinodex.offers.search` | read | Offers by title, query, region, type and availability; `on_my_services`; per-title `my_subscriptions` |
| `kinodex.offers.for_title` | read | Every offer for one title across services and regions |
| `kinodex.services.list` | read | Services with regions, offer types and whether the account subscribes |
| `kinodex.account.get` | read | Region, services, `settings_version`, and the people in the diary's `watched_with` |
| `kinodex.watchlist.get` | read | Ordered watchlist and `watchlist_version` |
| `kinodex.diary.list` | read | Diary entries, most recently watched first |
| `kinodex.lists.list`, `kinodex.lists.get` | read | Custom lists with `list_version` |
| `kinodex.reviews.list` | read | Own diary reviews and public reviews; `hide_spoilers` withholds spoiler text |
| `kinodex.alerts.list` | read | Alert rules with the clock-derived status and any recorded trigger |
| `kinodex.corrections.list` | read | Corrections with every decision, note and decision time |
| `kinodex.notices.list` | read | Notices, newest first, optional `since` and `kind` |
| `kinodex.services.update` | write | `{patch: {region?, service_ids?}}`. Re-checks the rules that depend on the account in the same write |
| `kinodex.watchlist.save` | write | Replaces the whole ordered watchlist |
| `kinodex.diary.log` | write | Logs a viewing |
| `kinodex.diary.update`, `kinodex.diary.delete` | write | `{id, patch}` / `{id}`. Delete returns the rating and review it removed |
| `kinodex.lists.create`, `kinodex.lists.save`, `kinodex.lists.delete` | write | `lists.save` takes `{id, patch}`; `patch.title_ids` replaces the whole ordered set |
| `kinodex.alerts.create`, `kinodex.alerts.update`, `kinodex.alerts.delete` | write | Rules of kind `available_on_my_services`, `price_below` or `new_season` |
| `kinodex.corrections.submit`, `kinodex.corrections.amend`, `kinodex.corrections.withdraw` | write | The correction lifecycle |

### Where to watch

An offer's availability is derived from `ctx.virtual_now` at read time and is never stored:

| Availability | Rule |
| --- | --- |
| `upcoming` | now < `available_from` |
| `available` | started, and `available_until` is absent or more than 7 days away |
| `leaving_soon` | started, and `available_until` is at most 7 days away |
| `ended` | now ≥ `available_until` |

- `on_my_services: true` limits offers to the account's region and subscribed services, of any type. For example, a Brightreel rental appears for a Brightreel subscriber.
- `my_subscriptions` is derived only from subscription offers on subscribed services in the account's region:
  - Back-to-back windows count as one continuous window.
  - The title is `leaving_soon` only when that continuous coverage ends within 7 days.
  - So a Brightreel offer ending does not make a title leave while Northcast still carries it.
- Default search results exclude `ended` offers.

### Spoiler-safe reads

`hide_spoilers: true` keeps every guide category's severity and summary. It withholds:

- guide items flagged `spoiler` (`withheld_items` counts them);
- review text marked `contains_spoilers`;
- the synopses of episodes after the furthest episode the person has logged in that series. With nothing logged, every synopsis is withheld.

The person is the account owner by default; their boundary comes from the whole diary. `as_of_person` names a household member, such as Mira or Jules, who has no diary of their own. Their boundary comes from the owner's entries whose `watched_with` includes them. `as_of_person` must be the owner or someone in the diary's `watched_with` history (`not_found` otherwise). The boundary is recomputed on every read, so deleting a diary entry moves it back.

### Writes and errors

All errors leave data and every version unchanged. Core adds `invalid_arguments`, `permission_denied`, `stale_version` and `idempotency_conflict`. The App errors are:

| Code | When |
| --- | --- |
| `not_found` | Unknown title, episode, edition, credit, guide item, guide version, person, service, region, list, alert, correction or diary entry, including one dated after the clock ([Clock cutoff](#clock-cutoff)); an episode outside the named series; `as_of_person` outside the diary's history. Region arguments are plain strings so that an unknown region reaches the App |
| `invalid_date` | `watched_on` after today (in the account's time zone) or before the title's earliest release in any region (or the episode's air date); an `expires_at` that is not in the future; an impossible date |
| `invalid_rating` | A rating that is not a half-star step from 0.5 to 5 (3.3, 0, 5.5) |
| `invalid_threshold` | `price_below` without `offer_type` and a positive threshold; a threshold on another kind; a title with no rent or buy offer of that type (current or upcoming) in the account's region, for example subscription-only *Fieldglass* in the US |
| `already_true` | A new or updated offer rule already matches. The message names the matching offer (ID, service, type, region, price, end); no rule is stored or changed |
| `duplicate_alert` | An active rule of the same kind already exists for the title |
| `not_active` | Updating or deleting a triggered, expired or deleted rule; status and history are preserved (restricting delete is an addition, see below) |
| `already_submitted` | An open correction (`submitted` or `needs_info`) exists for the same title, field and target; amending a correction that is already `submitted` |
| `already_decided` | Withdrawing or amending an approved, declined or withdrawn correction. (A `needs_info` correction that already used its one amendment also returns it; only seeded history can produce that state, because a second `needs_info` decision is rejected.) After one amendment the correction is `submitted`, so a second amend returns `already_submitted` |
| `no_change` | A correction whose proposed value equals the target's current value; a write whose patch changes nothing (addition, see below) |
| `object_version_conflict` | `expected_watchlist_version`, `expected_list_version` or `expected_settings_version` differs from the App field (addition, see below) |
| `invalid_arguments` | App-level shape errors that the schema cannot express: a series entry without episodes; the owner in `watched_with`; a correction target that does not match its field; a certification label not used in that region; a blank evidence note; `new_season` on a film; `offers.search` with `on_my_services` and a `region` other than the account's; a whitespace-only list name |

### Task policies and constraints

The package `scenario` profile allows the 18 reads; `sandbox` allows all 32 tools. A task grants writes in its own policies (see `examples/task-data/policies.json`).

Updates of an existing object take `{id, patch}`: `diary.update`, `lists.save`, `alerts.update` and `corrections.amend`. Deletes and withdraw take `{id}` only: `diary.delete`, `lists.delete`, `alerts.delete` and `corrections.withdraw`. Core enforces `constraints.ids` against `id` and `constraints.fields` against the keys of `patch` directly, and Kinodex does not read `ctx.policy`. Core checks `fields` only when a call has a `patch`, so only `constraints.ids` applies to the deletes and to withdraw. `services.update` takes `patch` with no `id` because the account is a singleton, so `constraints.fields` applies to it. Do not set `constraints.ids` on the tools without an `id` argument (`services.update`, `watchlist.save`, the `create`/`log`/`submit` tools): Core would deny every call. The walkthrough loads a policy with `kinodex.diary.update: {fields: ["rating", "review"]}` and shows a `watched_on` patch returning `permission_denied`.

## Incoming events

Infra applies four event types. The runner controls their timing; Kinodex has no timers. During a handler, `ctx.virtual_now` equals the event's `at`. Core deduplicates `event_id`, rejects a reused ID with different content (`idempotency_conflict`), and rolls data and clock back on failure.

| Operation | Payload | Effect |
| --- | --- | --- |
| `offer.publish` | An offer (`offer_id`, `title_id`, `service_id`, `region`, `type`, `quality`, `available_from`, optional `edition_id`, `price`, `currency`, `available_until`) | Adds the offer or replaces the one with that ID, for example a new price or an earlier `available_until` |
| `offer.end` | `offer_id` | Sets `available_until` to the event time. The offer must have started and not ended |
| `title.update` | `title_id` plus any of `add_seasons`, `add_episodes`, `release_dates`, `guide_version` | Adds seasons or episodes, changes release dates or certifications, or publishes the next guide version. `guide_version` is a delta over the current version: per category `severity`, `summary`, `add_items` and `remove_items` |
| `correction.decision` | `correction_ref`, `decision` (`approved`, `declined` or `needs_info`), optional `note` | Decides the account's matching open correction; an approval changes the catalog |

After `offer.publish`, `offer.end` or `title.update` commits, Kinodex evaluates the active, unexpired rules for that title at the event time (rules created by then, in their state as of then). Each match becomes `triggered` once and gets one notice. Every decision writes one `correction_decided` notice, which names the new guide version when an approval adds one. Any new guide version for a title on the watchlist also writes a `guide_updated` notice, whether a `title.update` published it or an approved correction added it.

Failures change nothing, and Core returns `applied: false`, records a `deny` audit row with the reason and stores no receipt:

- **`target_not_found`**: the event's target does not exist (title, offer), or no single open correction matches `correction_ref`.
- **`invalid_event`**: any other inconsistency. Examples are an unknown service, a region or type the service lacks, a price on a subscription, a reversed window, an edition of another title, a guide version that is not the next number, a season that already exists, release dates that would put diary entries before the release, an approval dated before the title's current guide version, or a season or guide version that collides with a later one already in the seed (see [Clock cutoff](#clock-cutoff)). Handlers run the same checks as seed validation, with this code, so a bad event never surfaces as `invalid_seed` from Core's re-validation.

A failed event can be retried with the same `event_id`, the current version and an `at` at or after the current clock.

`examples/scenario.json` is the approved proposal's first example, verbatim. As a management call on the Infra connection it looks as follows. Use the version from a fresh read or `env.snapshot`; the walkthrough's report records the exact call it made.

```json
{
  "method": "tools/call",
  "params": {
    "name": "env.apply_event",
    "arguments": {
      "expected_version": {"epoch": 2, "revision": 6},
      "event": {
        "event_id": "lantern-hill-guide-v2",
        "at": "2026-12-04T18:00:00-08:00",
        "operation": "title.update",
        "payload": {
          "title_id": "tt-lantern-hill",
          "guide_version": {
            "version": 2, "reason": "correction_approved",
            "categories": {
              "violence": {"severity": "moderate"},
              "frightening": {
                "severity": "moderate",
                "summary": "Sustained child peril.",
                "add_items": [{"item_id": "gi-lh-barn", "text": "A long sequence in which a child is trapped in a burning barn.", "spoiler": true}]
              }
            }
          }
        }
      }
    }
  }
}
```

`examples/events/` holds the other events the walkthrough applies:

- `salt-year-runtime-decision.json`: the proposal's second example, verbatim.
- `copper-sky-northcast-ads.json` and `copper-sky-northcast-return.json`.
- `fieldglass-uk-return.json` and `ambervane-northcast-start.json`.
- `harbor-lights-season-3.json`.

## State and time

- **Versions.** Core's `{epoch, revision}` is the version of the whole instance. Every write, event and `env.advance_time` increments `revision`. The App versions are separate fields, described in [item 1](#1-versions).
- **Receipts and retries.** Each write returns `id` (the object it changed) and the new Core version. Repeating a committed `request_id` with identical arguments returns the stored receipt marked `duplicate`.
- **Clock-derived state.** `ctx.virtual_now` is the account's "now"; agent reads and writes do not move it. Offer availability, `leaving_soon`, `my_subscriptions` and alert expiry are stored as due times and derived when read or checked. Which records exist at all is derived the same way ([Clock cutoff](#clock-cutoff)). Time passing alone writes nothing: no activity row, no notice and no stored status.
- **Today.** `watched_on` is compared with the calendar date of the clock's instant in the account's `time_zone` (an IANA name in the seed: Dana `America/Los_Angeles`, Ines `Europe/London`). The same instant gives the same answer however Infra spells the clock: at `2026-12-02T03:00:00Z` it is still Dec 1 for Dana and already Dec 2 for Ines (test T06 *"today"…*). `time_zone` is not returned by any tool, so the approved tool contracts are unchanged; the task's user context gives the agent the person's time zone.
- **Alert evaluation.** Rules are evaluated only by an event that affects the rule's title, and by `kinodex.services.update` (see [item 2](#2-offers-that-start-by-the-clock-alone)).
- **Activity rows.** There is one row per committed write or applied event, and none for a duplicate replay, a rejected call, a read or a clock change. Each row records:
  - `seq` and virtual time `at`;
  - `actor` (`agent` or `event`) and `action` (tool or event operation);
  - `request_id` or `event_id`;
  - `object_type` and `object_id`;
  - `replaced` (the prior value, `null` for creations);
  - `effects` (triggered `alert_ids` and written `notice_ids`).

  An evaluator joins activity rows to Core receipts (`request:<request_id>`, `event:<event_id>`, each holding the version) and to the audit and the agent trace.
- **Reset.** `env.reset` (`reset_scope: app_instance`) restores the loaded catalog, account and clock of that instance only. Infra takes the snapshot before reset.
- **Seed dates.** Seed validation never compares dates with the clock. Core validates package fixtures at registration under the registry's initial time, and the package registers under a `2026-01-01T00:00:00Z` registry clock. A seed may therefore run past its load clock; the clock cutoff below decides what the tools show. A write that would put a diary date after "today" fails with `invalid_date`.
- **Example clock.** `fixtures/clock.json` sets the App-only example time: Tuesday Dec 1, 2026, 09:00 −08:00. Every fixture and task-data record is dated on or before it, so the cutoff hides nothing at that clock (test *Cutoff: at the fixture clock…*).

### Clock cutoff

Added after plan approval, together with the [evaluation dataset](#evaluation-dataset-2025-01-01-to-2026-12-31). Tools show only the records that exist at `ctx.virtual_now`. Nothing is stored for this: `visible` in `src/catalog.cjs` filters the stored data on every read and write, and later records appear when `env.advance_time` or an event moves the clock. A seed that runs past its clock can therefore load at any point in its window. Each date field in the seed has one of these classes:

| Field | Class | Before the clock reaches it |
| --- | --- | --- |
| `diary[].logged_at` | happened | The entry is `not_found` to `diary.update` and `diary.delete`, and absent from `diary.list`, own reviews, `account.get` counts, `as_of_person` and spoiler boundaries |
| `public_reviews[].posted_at` | happened | Absent from `reviews.list` |
| `lists[].created_at` | happened | `not_found`; absent from `lists.list` |
| `alerts[].created_at` | happened | `not_found`; absent from `alerts.list`; events and `services.update` do not evaluate it |
| `alerts[].trigger.at`; `updated_at` of a `deleted` rule | happened (transition) | The rule reads `active` with no trigger, and `updated_at` reads as `created_at` |
| `corrections[].submitted_at` | happened | `not_found`; absent from `corrections.list`; no `correction.decision` reaches it |
| `corrections[].decisions[].decided_at`, `amended_at`, `withdrawn_at` | happened (transition) | Hidden; `status` and `updated_at` come from the transitions dated by the clock |
| `notices[].at` | happened | Absent from `notices.list` |
| `titles[].seasons[].added_at` | happened | The season and its episodes are absent; `episodes.list` on it is `not_found`; `new_season` rules do not see it |
| `guides[].versions[].published_at`, version 2 and later | happened | `guide.get` on it is `not_found`; the current guide is the latest one published |
| `guides[].versions[0].published_at` | descriptive | Version 1 is the title's listing guide, dated 30 days before release; always shown |
| `titles[].year`, `titles[].releases[].date` | descriptive | Always shown, including releases still to come |
| `episodes[].air_date` | scheduled | Always shown for an episode of a visible season |
| `offers[].available_from`, `offers[].available_until` | scheduled | Always shown; availability is derived ([Where to watch](#where-to-watch)) |
| `alerts[].expires_at` | scheduled | Always shown; `expired` is derived |
| `account.updated_at`, `watchlist.updated_at`, `lists[].updated_at`, `diary[].updated_at`, and the settings, order, contents and versions they stamp; the `updated_at` and fields of a rule edited later (and still active); a correction's `proposed_value`, `evidence` and `current_value` after a later amendment; catalog values that an approved runtime, release-date, certification or credit correction changed | current state | Shown as stored: a seed holds only the current state of these objects, so there is no earlier state to show. A task that starts before one of these stamps supplies that object's earlier state in its own seed. In the shipped seeds and the evaluation dataset every stamp is on or before the fixture clock |
| `activity[].at` | run record | Written by the App during a run; no tool reads it |

- **Writes on hidden records** fail with `not_found` and change nothing. New IDs avoid every stored ID, hidden ones included.
- **The agent's write replaces a seeded future.** A write on a rule or correction whose seeded history continues after the clock (a later trigger, deletion or decision) stores the record as of the clock, applies the write and drops the later notices about it. A new rule replaces a seeded rule of the same kind and title created after the clock, and a new correction replaces a seeded one for the same title, field and target, with their notices. An event that fires a rule or decides a correction does the same (`adopt` and `dropLater` in `src/rules.cjs`).
- **Events** find their targets and evaluate rules among the records that exist at the event time. Their consistency checks use every stored record, so a season, episode ID or guide version that collides with a later one in the seed fails with `invalid_event` and changes nothing; publish later catalog changes as events instead.
- Tests: *Cutoff: …* in `tests/business.test.cjs` (Ines's task data at March 1, 2026; writes on hidden records; rules and corrections with a later seeded history; events before a rule exists; same-key replacement) and *Evaluation dataset: …* (four clocks).

## Review items resolved

The approval review asked for three items to be settled during implementation.

### 1. Versions

- **Core version.** `expected_version` on every write is Core's instance `{epoch, revision}`, checked by Core.
- **App versions.** The watchlist, list and account-settings versions are App fields that Kinodex keeps itself:

  | Field | Read in | Returned in the receipt of |
  | --- | --- | --- |
  | `watchlist.version` | `watchlist_version` (`kinodex.watchlist.get`) | `kinodex.watchlist.save` |
  | `lists[].version` | `list_version` (`kinodex.lists.list`, `kinodex.lists.get`) | `lists.create`, `lists.save` |
  | `account.settings_version` | `kinodex.account.get` | `kinodex.services.update` |

  Each increases by one per committed change of that object.
- **Optional per-object check.** It uses separate argument names: `expected_watchlist_version` (`watchlist.save`), `expected_list_version` (`lists.save`) and `expected_settings_version` (`services.update`). A mismatch returns `object_version_conflict`.
- **"Version 2".** The proposal's "the watchlist is saved once at version 2" and "returns version 2" mean `watchlist_version` 2. The seed starts at 1.
- **Second session.** On Monday, the Agent first reads `kinodex.watchlist.get`. Its result carries the new Core version, moved by the clock and the event, and `watchlist_version` still 2. The Agent writes with that fresh version. A write with session 1's Core version returns `stale_version` and stores nothing.
- **Both stale controls are shown.** A stale Core version returns `stale_version`, and a stale `expected_watchlist_version` returns `object_version_conflict`.

### 2. Offers that start by the clock alone

**Rule (W4):** In the first version, rules are evaluated only:

- when an Infra event (`offer.publish`, `offer.end` or `title.update`) changes the rule's title; and
- when `kinodex.services.update` changes the region or subscriptions.

An `upcoming` subscription offer whose start time passes by the clock alone does not fire an alert, writes no notice and changes no stored state. A task that wants the alert to fire delivers the offer with `offer.publish` at its start time. Re-publishing the same offer is enough.

**Why this reading:**

- It is the most conservative one. Stored state never disagrees with what an evaluator reads from the snapshot.
- Reads stay pure, so Core's read-only check holds.
- It follows the proposal's own statements: "Events that change an offer, title or season can trigger a rule" and "none for time passing alone".
- Example request 2 still works, because *Copper Sky* returns through an `offer.publish` event.
- The alternative would derive `triggered` in reads with no notice. It would then need a second, read-time notion of a trigger and a tie rule against `expires_at`.

**Definitions under this rule:**

- **Expired.** A rule reads as `expired` when the clock reaches `expires_at` and no trigger was recorded. This keeps the proposal's "without an earlier match": a match means a recorded trigger.
- **Evaluation uses the clock.** Whenever a rule is evaluated, the match uses the offers available at that moment. An affecting event, or a services update, therefore fires a rule whose offer has meanwhile started by the clock, and records that event or request as the cause.
- **`alerts.create` uses the clock too.** It returns `already_true` for an offer currently available by the clock, and never for an upcoming one.
- **Ties.** An event at exactly `expires_at` finds the rule expired and fires nothing.

**Acceptance example** (test *T08 item 2*, walkthrough checks 79 and 85–90):

1. On Dec 1, *Ambervane* has a Northcast US subscription offer starting Dec 3. Its `available_on_my_services` rule is created `active`, not `already_true`.
2. The clock advances to Dec 3 10:00. `kinodex.offers.for_title` now reports `my_subscriptions.status: available`, `kinodex.alerts.list` still reports `active`, and activity, notices and stored alert status are byte-identical to before.
3. The task applies `ambervane-northcast-start` (`offer.publish` of the same offer at 10:00). The rule becomes `triggered` with that `event_id` and exactly one notice.

**Task-author note:** to have an alert fire when a seeded offer starts, schedule an `offer.publish` for that offer at its `available_from`. Do not rely on `env.advance_time`, which never triggers a business handler.

### 3. Correction target

**The key.** A correction targets the title, a field category and one object. That key — `{title_id, field, target}` — identifies it:

| `field` | `target` | Current value (`no_change` compares against it; approval replaces it) |
| --- | --- | --- |
| `runtime` | `{edition_id}` | That edition's `runtime_minutes` |
| `release_date` | `{region}` | That region's release `date` |
| `certification` | `{region}` | That region's `certification` (labels must be valid for the region) |
| `credit` | `{credit_id}` | That credit's `role`, `character` and `billing_order`. The proposal is a partial object; every given key must equal the current one for `no_change` |
| `guide_item` | `{item_id}` | That item's `text` and `spoiler` in the current guide version. An approval publishes the next guide version with reason `correction_approved` |

**How the key is used:**

- The one-open-correction rule counts on this key. One title can therefore have open corrections for two different credits, or for two editions, at once.
- `kinodex.corrections.submit` stores `current_value` at submission, so the evaluator sees what was compared.
- `correction_ref` in `correction.decision` uses the same key: `{title_id, field, target}`.

**Short form.** The proposal's verbatim example omits `target`: `{"title_id": "tt-salt-year", "field": "runtime"}`. The short form is accepted only when exactly one open correction matches the title and field. If none matches, or two or more match, it fails with `target_not_found`, and the message asks for the target. Test *T12* opens two runtime corrections on *Salt Year*, shows the short form failing, and decides one by its full key. This keeps the approved example working without letting it hit the wrong correction. It is listed as an open question below.

**W5 example** (test *T10*, walkthrough checks 82–84 and 99–101):

1. 142 minutes proposed for the theatrical edition of *Salt Year* (`ed-salt-year-theatrical`, currently 118) is accepted as `submitted`.
2. The same 142 proposed for the extended edition (`ed-salt-year-extended`, already 142) returns `no_change`.
3. A second theatrical proposal returns `already_submitted`.
4. The verbatim `salt-year-runtime-decision` declines the correction; it keeps the decision, note and decision time.

Example request 3 follows the same rule: the 142-minute runtime is the extended edition's current value, so the Agent logs that edition and submits nothing.

### Answers the review gave

- **Spoiler boundary.** Spoiler-safe reads default to the bound person's own diary, and `as_of_person` remains. Mira and Jules have no diary; their furthest episode comes from Dana's entries whose `watched_with` includes them. The T02 example uses *Pocket Comets*: Dana watched episodes 1–4 with Jules and Mira and episode 5 with Jules only. Mira's boundary is episode 4, Dana's and Jules's is episode 5.
- **Certification corrections.** These are allowed with the required evidence note. A label must be one used in that region. Whether the Agent should submit one is for the task to grade.
- **License.** The fixtures are MIT.

## Fixtures

All text is original and fictional (see `contribution/dataset.json`). The catalog and both account histories are built by `dev/build-fixtures.cjs` from hand-written word lists and hand-authored named records, with the fixed generator seed `20261201`. The dataset's provenance records this: source `authored` (synthetic, by @byshail), generation `{method: "scripted", tool: "dev/build-fixtures.cjs", tool_version: "1.0.0", seed: 20261201}`. `expected_counts.records` counts titles (184), which is what `plugin.records` returns; the seed holds about 5,400 catalog records in all.

| Item | Count |
| --- | --- |
| Titles | 184: 160 films and 24 series, all with one or more editions; 40 have two editions |
| Episodes | 298 |
| People / credits | 900 / 2,427 |
| Certifications | US, UK and CA for every title |
| Guide versions | 244: every title has version 1; 60 titles have a later version, all dated in 2026 |
| Services / offers | 6 / 1,230 (US 465, UK 411, CA 354; 492 subscription, 498 rent, 196 buy, 44 free with ads) |
| Public reviews | 205 |
| Dana's account (`fixtures/minimal.json`) | US; Brightreel and Northcast; 14-title watchlist; 250 diary entries from 2025-01-03 to 2026-11-21; 3 lists; 5 alerts; 3 corrections (one pending); 4 notices |
| Ines's account (`examples/task-data/seed.json`) | UK; Northcast and Kettlewing; 10-title watchlist; 60 diary entries in whole stars |
| Seed size (UTF-8) | `fixtures/minimal.json` 1,247,667 bytes; `examples/task-data/seed.json` 1,186,276 bytes; 2,433,943 combined. Compact JSON is 1,219,059 and 1,158,697 bytes, under the runtime's 2 MiB MCP request line used by `env.load_seed` |

- **Dana's rating style.** Half stars, never 5, mean exactly 3.4 over 250 ratings: 1.5 ×5, 2 ×12, 2.5 ×24, 3 ×55, 3.5 ×67, 4 ×65, 4.5 ×22. Ines rates in whole stars, gives 5s and averages 3.82.
- **Time coverage.** The data covers 2026 onward. Offers start, end and change price throughout 2026, and some windows run into 2027. Every later guide version, alert and correction is dated in 2026. Generated offers never start or end between 2026-11-15 and 2026-12-31, so only the named titles change availability during the December scenario. The 2025–2026 evaluation coverage is in [Evaluation dataset](#evaluation-dataset-2025-01-01-to-2026-12-31).
- **Consistency.** No offer starts before the title's release in its region, and every title certified R, NC-17 or TV-MA in the US rates at least one guide category `moderate` or higher (test T13 *fixture checks…*).

| Request / workflow | Data a task can use |
| --- | --- |
| 1 Is it OK for Mira? | *Lantern Hill* (`tt-lantern-hill`), US PG. Guide version 1 rates violence and frightening `mild`; the scenario event publishes version 2. Brightreel US subscription until 2026-12-05 23:59 −08:00; Brightreel US rental $3.99. UK: Kettlewing subscription, no end. Not on either watchlist. |
| 2 Leaving this week | Dana's watchlist holds *Fieldglass* (Brightreel US until Wed Dec 2 23:59; Northcast US open-ended), *Copper Sky* (Brightreel US until Fri Dec 4 23:59; then only a rental on Brightreel, $4.99, no purchase offer; Northcast UK; Openfern US ads) and *Quiet Harbour* (Brightreel US until Sun Dec 6 23:59; Northcast UK; Plumvale US). Ines's *Fieldglass* is on Kettlewing UK until Dec 3 23:59 UTC. Events in `examples/events/` restore *Copper Sky* to Northcast US (Dec 10) and *Fieldglass* to Northcast UK. |
| 3 Log the trip | *Salt Year* (theatrical 118 min, extended 142 min), *The Wrenfield Clock* (Dana logged it on 2025-11-14) and *Pellmoor Junction* (2026). *Harbor Lights* (2 seasons × 6 episodes), not yet seen. Ines logged *Salt Year* in June 2025. The task supplies the trip dates (flight Nov 26, cabin Nov 27–28), the companion and the airline's runtime. |
| Spoilers | *Harbor Lights* has a spoiler guide item and spoiler-heavy late synopses. *Pocket Comets* is the Mira example. |
| Clock-only checks | *Ambervane*: Northcast US starts Dec 3 (item 2). *Marrow Bay*: Brightreel US until Dec 9 23:59, so `leaving_soon` from Dec 2. Alert `al-04` expires Dec 2 12:00. |
| Corrections | `co-03` is a pending credit correction on *Pellmoor Junction*. `co-01` (approved release date) and `co-02` (declined UK certification) are history. |

Expected answers for a real task belong in that task's evaluator, not in this package. Task authors can replace either account's history, or load history for other 2026 dates. The seed schema accepts any history, and `examples/task-data/README.md` describes the second account.

## Evaluation dataset, 2025-01-01 to 2026-12-31

`data/evaluation/` is the delivered evaluation data for the coverage window in [submission evidence, section 3](../../docs/submission-evidence.md#3-environment-dataset-coverage). It was added after the plan was approved, when that section was published, and the validation report records it as added scope. `fixtures/minimal.json` and `examples/task-data/` are unchanged.

- **`seed.json`** (version 1.0.0; 1,347,301 bytes, 1,318,218 as compact JSON, so one `env.load_seed` request carries it). It holds the fixture catalog and Dana's account with every fixture record, ID and date, plus dated records:
  - 16 guide versions: one a month from February to December 2025, three in December 2026, and two from Dana's approved guide corrections;
  - two seasons: Sallowstead General season 3 (added Nov. 8, episodes weekly from Nov. 13 to Dec. 18) and Inspector Junivergate season 3 (added Dec. 4, episodes Dec. 9 to Dec. 30);
  - 41 public reviews from Oct. 15 to Dec. 30, 2026;
  - Dana's account across both years: 17 more alert rules (12 fired by the offer or season that matched them, 2 expired, 2 deleted, 1 still waiting at the clock), 6 more corrections (declined, approved, withdrawn, and one that needed more information), 18 more notices and 3 more lists.
- **Texts.** The fixture draws its public and diary review texts and its generated episode synopses from short phrase lists (smoke data). The dataset rewrites them, one text per record, for that title, rating and date, and renames repeated episode names within a series. IDs, dates, ratings and spoiler flags are unchanged. The Lantern Hill barn review (`rv-lh-01`), Dana's Wrenfield Clock review and the named series' synopses stay verbatim.
- **Clock.** The dataset clock is the fixture clock, 09:00 −08:00 on Dec. 1, 2026. Dana's history ends there, and at that clock the December requests see what they see in the fixture (test *Evaluation dataset: …*). Catalog records continue through December (the last on Dec. 30) and appear as the run clock reaches them ([Clock cutoff](#clock-cutoff)), so they are never pre-session history. No offers were added, so availability in December is the fixture's.
- **Provenance.** Every record is synthetic. The approved design uses an invented catalog, services and people, so there is no real source to anchor in November 2026, and nothing was collected from real websites. New records reuse the fixture's titles, people, services and word lists; no new title, place, service or company names were coined.
- **Files.** `binding.json`, `policies.json` and `clock.json` sit beside the seed. `dataset.json` is a valid bundle dataset (its `expected_counts.records` is the 184 titles) and records the sources, transformations and the seed's sha256 under the `generated` source's `generation.parameters.outputs`.
- **Coverage**, counted in America/Los_Angeles on each record's own date field: 606 distinct dates from 2025-01-02 to 2026-12-30 in all 24 months (no record falls on the endpoints 2025-01-01 and 2026-12-31), 585 of them on or before the dataset clock, with no stretch longer than 3 days without a record. Without offer windows, air dates and release dates: 459 distinct dates, longest gap 6 days. Dana's own history (diary and account records) covers 286 distinct dates. There are 0 identical texts among 822 prose texts and no pair of different texts shares 80% or more of its word 5-grams (highest 0.765, two fixture title synopses).

```sh
node dev/build-dataset.cjs          # rebuild data/evaluation/ (byte-identical on rerun)
node dev/coverage-report.cjs        # coverage by source and month, provenance, gaps, exclusions, text checks
node dev/coverage-report.cjs --json
node examples/dataset-demo.cjs      # load it over real MCP and query it at three clocks
```

## Commands

From this directory:

```sh
npm test              # App-only business tests (no runtime needed)
npm run example       # App-only example: the approved title.update event and Lantern Hill's offers
npm run walkthrough   # Real MCP evidence report (JSON on stdout); needs the public runtime
npm run dataset:demo  # Real MCP load and query of the evaluation dataset (JSON on stdout)
npm run build:contracts && npm run build:fixtures   # maintainer generators; reproduce the committed files byte for byte
npm run build:dataset && npm run dataset:coverage   # rebuild the evaluation dataset; print its coverage report
```

From the repository root:

```sh
npm run app:verify -- --app apps/kinodex --output .artifacts/kinodex.json
node runtime/build-contracts.cjs --check
```

`npm run walkthrough` finds the runtime the same way `service.cjs` does: by walking up to the checkout, or through `PALE_RUNTIME_ROOT`. It takes about 6 s on Node 22 and 25 s on Node 18.

## Proposal checks and evidence

**Evidence sources:**

- **Tests** are in `tests/business.test.cjs`; their names carry the proposal's IDs T01–T13.
- **Walkthrough** checks are numbered in the order of the `checks` array in `npm run walkthrough`'s report.
- **What the report contains:**
  - a scripted reference agent's reply to each request for both accounts, checked against what that account saw;
  - a trace of every call, joined to run, account, connection and request or event ID;
  - the snapshot taken before reset;
  - the exact `env.apply_event` call it made.
- **Status of the replies.** They are reference evidence for the data and tools, not model-agent trials.

| Proposal row / check | Evidence |
| --- | --- |
| W1: guide version 2 by default and version 1 on request; mild → moderate; "sustained child peril" without the barn item; the barn item in an unfiltered read | T01 *Lantern Hill guide…*; walkthrough 32–36 |
| W1: *Harbor Lights* with `hide_spoilers` shows synopses up to the furthest logged episode and withholds spoiler items | T02 *Harbor Lights…*; walkthrough 74 |
| W1 control: unknown title returns `not_found` | T01 |
| W2: *Fieldglass* `available` after Brightreel ends (Northcast); *Copper Sky* `leaving_soon`, then a rental only | T03 *on my services…*; walkthrough 9–10 |
| W2: in separate runs, adding a subscribed service or switching region triggers an active return alert, with offer, `services.update` cause and request ID, zero notices, no second trigger on retry | T04 (both tests); walkthrough 105–118 |
| W2 controls: UK-only offer not returned for a US account; a stale account update preserves region, subscriptions, rule state and notices; an unknown service or region returns `not_found` | T03, T04; walkthrough 110–111, 119 |
| W3: `watchlist.save` with two titles moved up returns `watchlist_version` 2 | T05 *watchlist.save…*; walkthrough 12–13 |
| W3: `diary.log` records five entries with `watched_with` and a `rewatch` | T06 *logging the trip…*; walkthrough 16–24 |
| W3: deleting an entry returns the rating and review it removed | T07; walkthrough 75 |
| W3 controls: future `watched_on` returns `invalid_date`; 3.3 returns `invalid_rating`; stale watchlist version rejected | T06 *diary rules…*, T05; walkthrough 70–73 |
| W4: rule created after *Copper Sky* leaves while a rental exists; UK-only subscription and US ads (subscribed and unsubscribed services) leave it active; `offer.publish` to Northcast US fires it with the offer and one notice; the follow-up reply names *Copper Sky* and Northcast; a second matching event adds no notice | T08 *return alert for Copper Sky…*; walkthrough 41, 44–57 |
| W4: a new-season rule stays active until a title update adds a season | T08 *new_season and price_below rules* |
| W4 item 2: an upcoming offer that starts by the clock alone fires nothing until `offer.publish` | T08 *item 2…*; walkthrough 79, 85–90 |
| W4 controls: `already_true` (no rule stored), `duplicate_alert`, `invalid_threshold`, `not_active` on triggered or expired rules, an event at the expiry time writes no notice and leaves the rule expired | T08, T09; walkthrough 78, 80–81, 88, 91, 97–98 |
| W5: runtime correction for *Salt Year* declined by `correction.decision` naming `{title_id: tt-salt-year, field: runtime}`; keeps decision and note | T10; walkthrough 82, 99–100 |
| W5 item 3: 142 min for the theatrical edition accepted, for the extended edition `no_change` | T10; walkthrough 82–83 |
| W5: approved guide correction adds a guide version and a notice (and a `guide_updated` notice for a watchlist title); `needs_info` amended once returns to `submitted` | T11; walkthrough 92–96 |
| W5 controls: `already_submitted`; `already_decided` on withdraw; no open correction gives `target_not_found`, `applied: false`, a `deny` audit row and no change | T10–T12; walkthrough 84, 101–104 |
| T13: a repeated `request_id` has no second effect; changed input gives `idempotency_conflict` (request and event) | walkthrough 27, 30–31, 68–69, 108, 117; public verifier |
| T13: an Agent calling an Infra operation gets `permission_denied` | walkthrough 3–7; public verifier |
| T13: each of the four events is checked with its rejections | T13 *events…*, T08, T11, T12 |
| T13: reset restores the loaded seed and clock; one activity row per committed write or event | walkthrough 60–65, 112–113; T13 *one activity row…* |
| Example requests against both accounts | walkthrough 8–59 (Dana and Ines; different answers for requests 1–3) |
| Reset restores the baseline | walkthrough 62–65 |
| A Brightreel offer ending does not report a title as leaving when Northcast still carries it | T03; walkthrough 10 |
| An alert fires once | T04, T08; walkthrough 57, 108, 117 |
| A correction decision reaches a correction the Agent created during the run | T10; walkthrough 99–100 |
| Fixture checks: episodes in their series, credits to existing people and titles, ordered offer windows, diary after release, diary between 2025-01-01 and the clock, Dana's rating distribution, seed byte size | `validateSeed` (`src/model.cjs`); T13 *seed validation…*, T13 *fixture checks…* |
| `hide_spoilers` boundary moves back after a diary entry is deleted | T02; walkthrough 76 |
| The clock alone (an offer's end time, the seven-day window, an alert's `expires_at`, an offer's start) changes `offers.search` and `alerts.list` consistently with no activity row or notice | T03 *clock-only changes…*, T08 *item 2…*; walkthrough 85–87 |
| "Today" for `watched_on` follows the account's time zone, not the clock's spelling | T06 *"today" is the date of the clock instant…* |
| Records dated after the clock are `not_found` to reads and writes; events that collide with later seeded records fail with `invalid_event`, never `invalid_seed` (clock cutoff, added after approval) | T13 *writes and events on history dated after the clock…*, T13 *seed validation…*, *Cutoff: …* tests |
| Evaluation dataset loads at any clock in 2025–2026 and shows nothing dated later (added after approval) | *Evaluation dataset: …* test; `npm run dataset:demo` |

## Acceptance criteria

`CONTRIBUTING.md` lists five acceptance criteria for completed implementations. This table maps each one to what this package provides.

| Criterion | Evidence in this package | Status for v1 |
| --- | --- | --- |
| Meaningful difficulty | The right answer depends on the account: services, region, diary, rating style and household. The three example requests give different correct answers for Dana and Ines (walkthrough 8–59). Tools are discoverable through `tools/list`, and every failure returns a named error. | Data and tools in place; difficulty is measured on the tasks that use them |
| Reproducibility | Commands above; Node 18 and 22. The generator seed `20261201`, and both generators reproduce the committed files byte for byte. Event schedules are in `examples/events/` and the walkthrough timeline. Reset behavior: walkthrough 62–65 and 112–113. The package SHA-256 is in each verifier report. No external dependencies or network. | Met |
| Valid grading | Graders belong to tasks. The package gives them records to grade from: activity rows joined to Core receipts (walkthrough 60–61), and stored triggers, decisions and notices in the snapshot. The scripted reference agent's replies pass the walkthrough's checks, and every control shows that a wrong action leaves state unchanged. "Doing nothing fails" and partial outcomes are defined per task. | Deferred to tasks |
| Independent evidence | `app:verify` copies the package into a fresh temporary registry and runs the standalone business tests and example with only `PATH` and `LANG`. **Agent trials are deferred for v1:** no task uses Kinodex yet, and model rollouts with a failure analysis will be attached to those tasks or to this PR. The walkthrough's replies are scripted reference evidence, not model trials. | Agent trials deferred |
| Integrity and maintenance | `contribution/dataset.json` records provenance: authored by @byshail, synthetic, scripted generator and seed, MIT, no external data. Possible name collisions are listed under the open questions below. @byshail is the owner. | Met; human data review pending |

## Additions beyond the approved text

These are listed so they are not read as drift.

- **Per-object version checks.** The optional `expected_watchlist_version`, `expected_list_version` and `expected_settings_version` arguments and their error `object_version_conflict` ([item 1](#1-versions)).
- **`no_change` on no-op writes.** A write whose patch changes nothing returns `no_change` and writes no activity row: `services.update`, `watchlist.save`, `diary.update`, `lists.save`, `alerts.update`, `corrections.amend`. For `services.update` the order of `service_ids` does not matter. The proposal names `no_change` for corrections only.
- **`withdrawn` status.** A correction gets `withdrawn` status when `corrections.withdraw` succeeds. The proposal lists the tool but not the status.
- **Two more event codes.** `target_not_found` and `invalid_event` are event failure codes. The proposal names `target_not_found`; `invalid_event` is Core's standard code for other payload errors.
- **App-level `invalid_arguments`.** It covers the shape errors listed under [Writes and errors](#writes-and-errors).
- **One `needs_info` round.** `correction.decision` with `needs_info` on a correction that was already amended, or is already in `needs_info`, fails with `invalid_event`. This enforces "amended once".
- **`my_subscriptions`.** The derived per-title summary in offer searches, and the continuous-coverage rule behind it.
- **Episode air dates.** A diary entry's `watched_on` must also not precede the episode's air date.
- **Deleting rules.** `alerts.delete` is limited to active, unexpired rules, like updates. Deleting a triggered or expired rule returns `not_active`, so its status and trigger are kept. The proposal restricts only updates.
- **Correction `current_value`.** It is stored at submission.
- **`already_true` on updates.** `alerts.update` returns `already_true` when the updated rule would already match, and leaves the rule unchanged. The proposal states `already_true` only for creation. One consequence: the agent cannot extend the expiry of a rule whose offer has meanwhile started by the clock; it should tell the person instead (test T08 *item 2…*).
- **`already_submitted` on amend.** Amending a correction that is already `submitted` returns `already_submitted`. The proposal uses that code only for a second open correction.
- **`invalid_date` beyond `watched_on`.** It also covers an `expires_at` that is not in the future.
- **Clock cutoff and evaluation dataset.** Added after plan approval for the environment data rule (2025–2026 coverage); see [Clock cutoff](#clock-cutoff) and [Evaluation dataset](#evaluation-dataset-2025-01-01-to-2026-12-31). It replaced the earlier `invalid_date` for editing a diary entry logged after the clock, which is now `not_found`. Tool schemas and error codes are unchanged.
- **More App-level `invalid_arguments` cases.** `offers.search` with `on_my_services` and a different `region`, and whitespace-only list names.
- **Account `time_zone`.** A required seed field (IANA name) used only to compute "today". It is not returned by any tool.
- **`account.get` people.** It lists the people from the diary's `watched_with`, so the Agent can find valid `as_of_person` values.
- **Second account.** Ines Calloway (UK) is the task-data account the proposal calls "a second account with a different region and services".

## Open questions for @byshail

- **Short-form `correction_ref`.** Should the short form stay accepted when unambiguous, or should the full key be required? Requiring it would change the approved example's payload. The implementation accepts it only when exactly one open correction matches.
- **Possible real namesakes among the approved names.**
  - *Lantern Hill*: a 1990 Canadian TV film.
  - *Fieldglass*: SAP Fieldglass, a software product.
  - *Harbor Lights*: a 1963 film and a well-known song.
  - *Copper Sky*: a 1957 Western film.

  These names are kept as approved. The other invented names were checked against general knowledge only, because no web search was available:
  - services: Kettlewing, Plumvale, Tinlark Store, Openfern;
  - titles: *Ambervane*, *Marrow Bay*, *Pellmoor Junction*, *The Wrenfield Clock*, *Pocket Comets*;
  - the generated `{place} …` titles.

## Package map

| Path | Contents |
| --- | --- |
| `app.json`, `package.json`, `service.cjs`, `plugin.cjs` | Manifest, commands, provided launcher, hook exports |
| `tools.json` | The 32 Agent tools with input/output schemas |
| `src/model.cjs` | `validateSeed` and the shared checks (`checkOffer`, `checkRelease`, `checkEpisode`, `checkGuideVersion`, `checkDiaryEntry`) used with `invalid_seed`, `invalid_event` or the write errors |
| `src/catalog.cjs` | Lookups, the clock cutoff (`visible`), clock-derived availability and alert status, `my_subscriptions`, spoiler boundaries, agent-facing views |
| `src/rules.cjs` | Alert matching and triggering, correction targets and values, activity rows and notices, replacing a seeded future (`adopt`, `dropLater`) |
| `src/operations.cjs` | Agent tool handlers |
| `src/events.cjs` | The four event handlers |
| `src/domain-utils.cjs`, `src/diagnostics.cjs` | Shared helpers and the optional, ID-only diagnostics adapter |
| `schemas/` | Seed, event and state schemas plus the shared dataset/catalog contracts |
| `contribution/` | Contribution declaration, dataset provenance, empty asset catalog |
| `fixtures/` | Dana's seed, binding, policies, clock |
| `data/evaluation/` | The 2025–2026 evaluation dataset: seed, binding, policies, clock and its own `dataset.json` |
| `examples/` | App-only example, approved event (`scenario.json`), further events, task data for Ines, real-MCP walkthrough, real-MCP dataset demo |
| `tests/` | Business tests, App-only harness, verifier cases, schema validator |
| `dev/` | Maintainer generators for schemas and `tools.json` (`build-contracts.cjs`), for fixtures, events, task data and dataset counts (`build-fixtures.cjs`), and for the evaluation dataset (`build-dataset.cjs`) and its coverage report (`coverage-report.cjs`). Not run by the verifier; the business tests check the dataset's counts and hash. |

## Limitations

- MCP only: no GUI and no reviewer console.
- No posters, stills, trailers or other media; resources are not used.
- No playback, purchases or subscription management: a subscription is only a record of what the person pays for elsewhere. There are no showtimes, tickets, recommendations, following, comments or box-office data.
- One account per App instance. The catalog is copied into each instance, so Infra applies every catalog event to every account instance.
- Approved corrections change only the submitting instance's catalog. A title.update event can carry release-date, certification and guide-version changes to other account instances, but no event sets an edition runtime or a credit, so approved runtime and credit corrections cannot be propagated to other instances in v1.
- Rules are evaluated only by Infra events and `kinodex.services.update`. An upcoming offer that starts by the clock alone fires no alert until a task delivers it with `offer.publish`.
- `already_true` names the matching offer in the error message only, because Core's error result carries a message and no structured fields.
- Search matches the start of words; there is no ranking or stemming.
- The clock cutoff cannot show an earlier version of current-state objects (account settings, watchlist, list contents, diary edits, catalog values changed by approved corrections), because a seed holds only their current state. A task that starts before such a stamp supplies that state in its own seed.
- All titles, people, services, prices, reviews and guide text are synthetic; there is no live data.
