# Delivery dataset (2025-01-01 to 2026-12-31)

Fully synthetic evaluation data for the two fixture families, covering the window required by `docs/submission-evidence.md` (section 3). No website or real-person data is modeled, so there is no real source data to anchor; every record is labelled synthetic here and in `coverage.json`.

| Family | Provider | Cases | Commitments | Distinct dates | Months without a case |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `card-issuer` | Larchmont Card Services | 59 | 22 | 129 | none |
| `internet-provider` | Kestrel Fiber | 53 | 20 | 114 | none |

## How it is made

`scripts/generate-dataset.cjs` runs a seeded agenda of customer and provider steps in time order through Counterline's own `handleTool` and `applyEvent`, so every record follows the App's rules (two-step acceptance, identity, offer groups, report limits, contests). Each executed call is logged with its virtual time in `<family>/actions.json`. Fee and refund cases end in every commitment state across the two years: reported in full or in parts, contested and reissued or upheld, revoked, a conditional credit whose condition was missed, a provider message saying "processed" with no report, and commitments still pending, partly reported or contested at the window's end. Ordinary questions (statements, payments, travel, routers, moving) fill about two cases a month. Help articles keep their revisions, each with its date, a note and the text it had; several are revised during the window (a new posting time for credits, a new late-fee amount, a lower outage threshold).

Files per family: `base.json` (provider, customer record, help articles, no history), `actions.json` (the log), `seed.json` (the state at 2026-12-31), `binding.json`.

## Selecting history for a task

`node scripts/select-history.cjs <family> <as-of> [out.json]` replays the log up to the given time: only records that existed then are present, each in the state it had then; a help article shows the revision in force then, and one first published later is left out. This default rebuild includes everything dated at the time itself; `--verify` uses it to check that a replay to the window's end equals `seed.json` byte for byte.

**For a task, use the strict cut:** `node scripts/select-history.cjs --before <family> <first-session start> [out.json]` keeps only actions and article revisions dated strictly before the first session, so nothing dated at that same instant is preloaded as history. Several actions can share one timestamp (59 timestamps in card-issuer and 53 in internet-provider carry more than one action; for example `cs-0029` is opened and closed at `2026-01-03T16:45:00-05:00`). The task loads that seed with `env.load_seed` and stages later records through its own events. T31 is the boundary regression test: two actions and an article revision at the cut instant are in the inclusive rebuild and not in the strict one.

## Coverage and loading

`coverage.json` and `coverage.md` count the delivered records by month and by date field (case `opened_at`, transcript turn `at`, offer `presented_at`, commitment `accepted_at`, report `at`, article revision `at`; `updated_at` is the latest revision), in the provider's declared time zone, with distinct dates, gaps and any records outside the window. `scripts/check-dataset.cjs` loads each family through the public runtime and reads it back through the Agent tools, both the full two years and an as-of selection at mid-2026.

```sh
npm run dataset          # regenerate and recount
npm run dataset:check    # fail on drift; verify the replay
node apps/counterline/scripts/check-dataset.cjs   # from the repository root: load and query through MCP
```
