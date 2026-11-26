# Full fixtures

Two invented students for Tutorwell Tasks: the same Maya Ortiz and Daniel Kim as Milepost's full fixtures, with the same person IDs, so a task can load both Apps for one student. Both use one university tutoring and writing centre in New York (`../centre.json`): six tutors across math and statistics tutoring and the writing centre, 46 skills, and a weekly timetable that gives 40 open slots in the two weeks from Mon 2027-03-01 to Sat 03-13. The clock for loading is Mon 2027-03-01 09:00 (−05:00), as for Milepost's fixtures.

| | Maya Ortiz (`maya/`) | Daniel Kim (`daniel/`) |
| --- | --- | --- |
| Profile (as in Milepost) | Evenings after a part-time job; statistics is her weakest course, which she postpones | Early mornings and weekends; factoring keeps slipping |
| At the centre | Evening statistics sessions with Mei (online); biology lab reports at the writing centre with Noor and Sam | 8:00 math sessions with Ana; Saturday statistics sessions with Raj |
| Term (12 appointments) | 7 completed with reports, 2 cancelled in time, 1 no-show (Mon 02-08, kept late at work), 1 cancelled by the centre (Sam's slot withdrawn), 1 ahead: Tue 03-02 18:00 with Sam, lab report 3 | 7 completed with reports, 1 cancelled in time, 1 late cancellation (Tue 01-26, overslept), 1 no-show (Thu 02-11), 1 cancelled by the centre (Kofi's slot withdrawn), 1 ahead: Wed 03-03 10:00 with Raj |
| Suspensions | none | 02-11 09:30 to 02-25 09:30: the no-show with January's late cancellation reached the limit of 2 in 30 days; no booking was made during it |
| Open follow-ups | a January reading (`fu-3`) | redo problems 6 and 8 of set 7 by Thu 03-04 (`fu-8`) and a reading (`fu-9`) from Ana's report of Thu 02-25, whose next focus is factoring ax² + bx + c (`alg-7-3`); an older reading (`fu-5`) |
| Accommodations | Reduced-distraction room (consents to share), extended time 1.5x (does not) | Extended time 1.5x (does not consent to share) |

The centre: Ana Ruiz (polynomials and factoring, 8 skills), Kofi Mensah (linear equations, graphs and the special products), Mei Chen (the first two statistics units), Raj Patel (all of introductory statistics), Sam Whitfield (claims, evidence, structure and style) and Noor Haddad (lab reports, evidence and citations). The 40 math skill IDs and titles are Milepost's (`alg-…`, `sta-…`); the 6 writing skills (`wr-…`) are Tutorwell's own. Settings: at most 2 appointments a week, cutoff 12 hours, 2 no-shows in 30 days suspend for 14 days.

Each folder is one load bundle: `seed.json`, `binding.json`, `dataset.json` and an empty asset `catalog.json`. Do not edit them by hand: change `../centre.json` or `../profiles/<id>.json` and run `node scripts/build-fixtures.cjs` in `apps/tutorwell` (`--check` reports drift). Besides the seed schema and `validateSeed`, the builder refuses a history the centre's rules would not have produced: a booking over the weekly cap or during a suspension, a session outside the tutor's skills or timetable, or appointment IDs out of booking order. Load with Infra's `env.load_seed`:

```json
{"expected_version": "<from env.snapshot>", "request_id": "load-maya", "virtual_now": "2027-03-01T09:00:00-05:00",
 "data": "<maya/seed.json>", "binding": "<maya/binding.json>", "bundle": {"dataset": "<maya/dataset.json>", "catalog": "<maya/catalog.json>", "blobs": {}}}
```
