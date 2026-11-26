# Full fixtures

Two invented students for Milepost Tasks. Both take Algebra 1, Introductory Statistics and Biology (16 units, 60 skills) with the same six assessments; their records start on Mon 2027-02-01 and the clock for loading is Mon 2027-03-01 09:00 in New York (−05:00). Three assessments are already past and have results; the factoring quiz (Fri 03-12), the cells exam (Thu 03-11) and the probability exam (Mon 03-15, after the switch to daylight time) are ahead.

| | Maya Ortiz (`maya/`) | Daniel Kim (`daniel/`) |
| --- | --- | --- |
| Profile | Evenings after a part-time job; algebra is her strength, statistics her weakest course, which she postpones | Early mornings and long weekend sessions; biology is his strength, factoring keeps slipping and new algebra comes slowly |
| Study rules | Mon–Thu 18:30–22:00, Fri 18:30–21:00, Sat 10:00–14:00; rests on Sunday; 90 minutes a day; blocks of 25–50 minutes | Weekdays 06:30–08:00, Sat 09:00–17:00, Sun 09:00–12:00; no rest day; 150 minutes a day; blocks of 30–90 minutes |
| Learner parameters | defaults (learning rate 0.5, retention base 0.9) | learns more slowly and forgets faster (learning rate 0.4, retention base 0.88) |
| History | 21 platform sessions; last week's plan has 5 done blocks, 1 missed and 1 still ahead tonight | 18 platform sessions; last week's plan has 6 done blocks and 1 missed |

Each folder is one load bundle: `seed.json`, `binding.json`, `dataset.json` and an empty asset `catalog.json`. Do not edit them by hand: change `../catalog/courses.json` or `../profiles/<id>.json` and run `node scripts/build-fixtures.cjs` in `apps/milepost` (`--check` reports drift). Load with Infra's `env.load_seed`:

```json
{"expected_version": "<from env.snapshot>", "request_id": "load-maya", "virtual_now": "2027-03-01T09:00:00-05:00",
 "data": "<maya/seed.json>", "binding": "<maya/binding.json>", "bundle": {"dataset": "<maya/dataset.json>", "catalog": "<maya/catalog.json>", "blobs": {}}}
```
