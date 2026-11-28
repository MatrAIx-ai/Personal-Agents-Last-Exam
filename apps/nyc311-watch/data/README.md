# Evaluation fixture v1.0.0

This package has 386 fictional-workspace records across 386 distinct New York
creation dates, with coverage from 2025-01-01 to 2026-12-31 across 24 months.
The fixture includes 368 normalized city records (16 created in November 2026),
and 18 explicitly synthetic gap cases (one at the end of November and all
17 sampled December dates). Neither the synthetic cases nor the synthetic
watch account is intended to represent a named or actual person.

Source: [NYC Open Data, 311 Service Requests, erm2-nwe9](https://data.cityofnewyork.us/d/erm2-nwe9).
See the [NYC Open Data terms](https://data.cityofnewyork.us/stories/s/Terms-of-Use/k9k7-3cje)
and [city FAQ on reuse](https://www.nyc.gov/opendata/get-started/FAQs).
The city advises that datasets can change and supplies these records for
informational purposes without warranty. Source records are not MIT; MIT
applies to original implementation and synthetic data only. No original
lookup key, address, coordinate, free text, contact or media is distributed.
The upstream key was used only to deduplicate and order the capture.

The recorded local cutoff is 2026-11-27 21:06:26 America/New_York.
Each month’s actual retrieval timestamp and row-level filters are listed in
[capture-v1.json](capture-v1.json), alongside the SHA-256 of the raw API
response and the normalized evaluation bytes. The query tool is
`python3 data/capture.py` from this App. It captures a new snapshot, not
an archived server state; run in a copy to preserve the pinned v1 files.
It selects Street Condition in the five named boroughs and samples up to
16 distinct dates across each available month. Offset-free API values are
interpreted in America/New_York; unresolved DST overlaps/gaps and malformed
creation dates are skipped. A malformed optional closure field is not
used to infer business state. Unmapped agency status is not promoted to
an observation. Real status is observed only at retrieval, not retrospectively
at creation or closure. Dec 2026 gaps are prospective synthetic data.

Verification without a live connection: `npm run test:core` in this App.
The script checks allowed fields, observed November provenance, date/month
counts and normalized SHA, then uses public Core `env.load_seed`,
Agent search/read, clock advance and reset. It keeps evaluation and smoke
runs separate. To reuse the fixture, load the evaluation JSON with this
directory’s dataset metadata, the empty contribution catalog and no blobs.
