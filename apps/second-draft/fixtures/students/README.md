# Full fixtures

Two invented students for Second Draft Tasks. Each has two courses whose AI policies differ, two graded past essays with their comments, and one current essay of about 400 words in five paragraphs with comments from the instructor, a peer and the writing centre. The clock for loading is Mon 2027-03-08 09:00 in New York (−05:00); both current essays are due Fri 03-12 at 23:59. Essays, comments, rubrics and course threads are written by hand in `../profiles/<id>.json`, and the problems their graders keep raising recur across all three essays.

| | Priya Nair (`priya/`) | Marcus Bell (`marcus/`) |
| --- | --- | --- |
| Profile | First-year; drafts quickly and revises the night before | Second-year; strong ideas, claims without support |
| Courses and AI policies | English 110 (Dr. Weiss): `plan`, `reply`, `ask_instructor`. History 205 (Prof. Okoye): those and `suggest_language` | Philosophy 101 (Dr. Lindqvist): `plan`, `reply`, `ask_instructor`, `suggest_language`, `suggest_content`. Biology 220 (Prof. Mbeki): `plan`, `ask_instructor` |
| Her or his rules | `plan`, `reply`, `ask_instructor`, `suggest_language`: "Don't write or rewrite my sentences. I submit my own work." | all but `edit`, including `submit`: "Never change my draft directly. You can submit when I say a draft is final." |
| Graded past essays | `engl-e1` (a place that taught her something), `hist-e1` (sugar and the Atlantic economy) | `phil-e1` (is lying ever permitted?), `bio-r1` (leaf-litter field report) |
| Current essay | `engl-e2`, "Should our city make buses free?": 391 words, 9 open comments | `phil-e2`, "Do we owe anything to future generations?": 384 words, 8 open comments |
| Recurring problem | An opening that announces a topic instead of a claim (`thesis` or `argument` in every essay), and comma splices (`mechanics`) | Claims without examples, evidence or citations (`argument`, `evidence`, `interpretation`) |

Each folder is one load bundle: `seed.json`, `binding.json`, `dataset.json` and an empty asset `catalog.json`. Do not edit them by hand: change `../profiles/<id>.json` and run `node scripts/build-fixtures.cjs` in `apps/second-draft` (`--check` reports drift). Every seeded sentence is the student's; versions are numbered `v1`, `v2`, `v3` across the account in saving order, so each current essay is `v3`. Load with Infra's `env.load_seed`:

```json
{"expected_version": "<from env.snapshot>", "request_id": "load-priya", "virtual_now": "2027-03-08T09:00:00-05:00",
 "data": "<priya/seed.json>", "binding": "<priya/binding.json>", "bundle": {"dataset": "<priya/dataset.json>", "catalog": "<priya/catalog.json>", "blobs": {}}}
```
