# Rainshadow full-window evaluation dataset

An invented two-region world and one account's use of Rainshadow (Maya Chen, account `rainshadow-maya`) from **1 January 2025 to 31 December 2026**, for the Environment's delivered evaluation data. Everything is synthetic and fictional, and no number is observed weather. It is separate from `fixtures/minimal.json`, which stays the smoke-test fixture (its clock is 20 November 2026).

| File | What it is |
| --- | --- |
| `seed.json` | The App seed, as Infra passes it to `env.load_seed` (compact JSON, 1,319,281 bytes). |
| `clock.json` | The dataset clock, `2026-12-31T20:00:00-07:00` (Denver): pass it as `virtual_now` with the seed. |
| `dataset.json` | Provenance in the `pale.dataset.v1` contract: one synthetic source, the generators, the seed of the steady records and the resulting counts. |
| `coverage.json`, `coverage.md` | Date coverage by record family and month, with gaps, the forecast and announced times kept apart, and states at the clock. |

## Loading it

Infra loads it like any Task history: `env.load_seed` with `data` = `seed.json`, `virtual_now` = the clock above, and the account's binding (`fixtures/binding.json`, account `rainshadow-maya`).

- `node tests/dataset.integration.cjs --runtime DIR` does this on the public runtime and reads the data back through the Agent's MCP tools (every place's issuances month by month, a past air-quality outlook, every alert thread, the watches, notices and saved places, the newest observation), then makes one write and resets. The whole request is 1,319,495 bytes, inside Core's 2 MiB limit for one MCP message.
- `node examples/web.cjs --runtime DIR --dataset full-window` opens the web pages on it, at the dataset clock.

## What is in it

Three parts, replayed together in time order through the App's own handlers:

1. **The fixture's scripted history, unchanged** (`dev/history.cjs` and the three detailed days of `dev/build-fixture.cjs`, 1 January 2025 to 20 November 2026): Friday drives over Cinderhorn Pass watched for gusts, Saturday hikes at Wren Lake watched for rain and thunder, her mother's walks at Marrowby in smoke season, 46 alert threads through two winters and two summers, the places and preferences she changes with the seasons, and 18 to 20 November 2026 in full.
2. **Its continuation to the end of the year** (21 November to 31 December 2026): the Saturday hike and walk the fixture's last afternoon set watches for, a Thanksgiving storm on the pass and a walk with her mother, king tides, a drive moved from Friday to Saturday because of gusts, Christmas on the coast, quiet hours moved to 21:30 after late notices, and the New Year storm: a Winter Storm Warning in effect at the clock and a watch for a drive on New Year's Day, still open. The last day has both sources' issuances for the four places she follows and every place's air quality.
3. **The steady records a weather app keeps in between** (seeded): the Regional Air Board's weekly seven-day outlook for Marrowby (Mondays) and a fortnightly one for Tamsin Heights (Thursdays), with smoke weeks where the history's air-quality alerts have them; the forecast office's Quillmere issuance every other Monday; and three or four routine advisories a month (fog, cold, freeze, wind, heat, thunderstorms, coastal flooding, pass snow) through the seasons. The ones for her mother's bay shore and, in ski season, for the pass reach her as notices; as in the history, she acknowledges every flood alert for her mother's house within hours and no wind alert.

At the clock: 346 issuances, 50 observations, 140 alert threads with 164 messages, 3 saved places, 35 watches, 104 notices, 35 acknowledgements and 771 activity rows. The seed schema caps issuances at 400 and alerts at 200; the dataset leaves room under both for a Task's own records.

## Dates

Counting zone: America/Denver (the account's zone; the Pacific places' records are converted). A forecast counts on the date it was issued and an alert message on the date it was sent. From `coverage.md`:

- Records on **310** of the 730 dates, from 2025-01-01 to 2026-12-31, every month covered; the longest stretches without any record are six days. Air-quality issuances on 170 dates, alert messages on 141, weather issuances on 97, notices on 87, her own writes on 76.
- The hours and days a forecast covers, an alert's onset and end and a watch's window are what was forecast, announced or watched: they are excluded from every count (201 forecast rows, one alert and one watch window run past the clock).
- Observations are stored, but the App shows only the newest per place (`conditions.get`); there is no observation history tool, so the dataset adds no daily observations.

## Provenance and how it was made

`dev/dataset.cjs` merges the fixture's timeline (with its own event and request IDs), the continuation and the steady records (seeded generator, mulberry32, seed 20250103), and replays them through the in-memory harness: the seed rules run after every step, the scripted watch outcomes of the history are checked as they happen, and the state schema at the end. Forecast numbers come from the history's closed-form toy model with seeded weather systems; alert wording comes from the history's table.

There is no real source behind it: Rainshadow's regions, places, zones and sources are invented (the approved plan uses fictional places), so no real forecast, observation or alert was collected and there is no real-data anchor. No record is real or mixed; none is presented as an observed fact.

## Reproduce

```
node dev/dataset.cjs --check     # rebuild and compare with seed.json, clock.json, dataset.json
node dev/coverage.cjs --check    # recount and compare with coverage.json, coverage.md
node tests/dataset.integration.cjs --runtime DIR
```

`npm run check:dataset` runs the first two; `node dev/dataset.cjs && node dev/coverage.cjs` rewrites the files.

## Limits

- Synthetic realism is a judgment for review: the toy model's numbers, the advisory rate and wording, and the account's two years.
- The steady records are sampled (one outlook a week for one place, one a fortnight for another, one issuance a fortnight for Quillmere) to stay inside the seed caps and Core's message limit; a real service issues far more.
- The dataset clock is the end of the window. A Task that starts earlier should select the history before its first session and stage later records as scenario events.
