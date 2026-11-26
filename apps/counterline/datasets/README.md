# Delivery dataset (2025-01-01 to 2026-12-31)

Fully synthetic evaluation data for the two fixture families, covering the window required by `docs/submission-evidence.md` (section 3). No website or real-person data is modeled, so there is no real source data to anchor; every record is labelled synthetic here and in `coverage.json`.

| Family | Provider | Cases | Commitments | Distinct dates | Months without a case |
| :--- | :--- | ---: | ---: | ---: | :--- |
| `card-issuer` | Larchmont Card Services | 59 | 22 | 125 | none |
| `internet-provider` | Kestrel Fiber | 53 | 20 | 114 | none |

## How it is made

`scripts/generate-dataset.cjs` runs a seeded agenda of customer and provider steps in time order through Counterline's own `handleTool` and `applyEvent`, so every record follows the App's rules (two-step acceptance, identity, offer groups, report limits, contests). Each executed call is logged with its virtual time in `<family>/actions.json`. Fee and refund cases end in every commitment state across the two years: reported in full or in parts, contested and reissued or upheld, revoked, a conditional credit whose condition was missed, a provider message saying "processed" with no report, and commitments still pending, partly reported or contested at the window's end. Ordinary questions (statements, payments, travel, routers, moving) fill about two cases a month.

Files per family: `base.json` (provider, customer record, help articles, no history), `actions.json` (the log), `seed.json` (the state at 2026-12-31), `binding.json`.

## Selecting history for a task

`node scripts/select-history.cjs <family> <as-of> [out.json]` replays the log up to the given time: only records that existed then are present, each in the state it had then, and help articles updated later are left out. A task loads that seed with `env.load_seed` and stages later records through its own events, so nothing after its first session appears as history. `--verify` checks that a replay to the window's end equals `seed.json` byte for byte.

## Coverage and loading

`coverage.json` and `coverage.md` count the delivered records by month and by date field (case `opened_at`, transcript turn `at`, offer `presented_at`, commitment `accepted_at`, report `at`, article `updated_at`), in the provider's declared time zone, with distinct dates, gaps and any records outside the window. `scripts/check-dataset.cjs` loads each family through the public runtime and reads it back through the Agent tools, both the full two years and an as-of selection at mid-2026.

```sh
npm run dataset          # regenerate and recount
npm run dataset:check    # fail on drift; verify the replay
node apps/counterline/scripts/check-dataset.cjs   # from the repository root: load and query through MCP
```
