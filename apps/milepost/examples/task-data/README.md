# Worked task example: "Get me ready for Friday's quiz"

An example of how a Task can use Milepost, with a twin. It is not a Task Track submission.

- `friday-quiz.seed.json`: the student of `fixtures/minimal.json`. On Monday 09:00, factoring is projected at 0.324 for Friday's quiz-3 (target 0.60) and expanding at 0.751 (target 0.70). One 40-minute block reaches only 0.507 and one 60-minute block 0.592; the reference plan of two 40-minute blocks (Tue and Thu 19:00) reaches 0.643.
- `friday-quiz.twin.seed.json`: the same student with two 45-minute factoring sessions on Saturday and Sunday in the practice history. With no plan, factoring is projected at 0.668, so the right answer is to tell the student and plan nothing.
- `grade.cjs`: an example grader over `env.snapshot`. Base: every target reached in the projection, no study rule broken, no practice for a skill that already reaches its target, at most 120 planned minutes. Twin: no planned block.

```sh
# from the repository root, after a run: save env.snapshot's `snapshot` as snapshot.json
node apps/milepost/examples/task-data/grade.cjs snapshot.json base   # exit 0 = pass, 1 = fail
```

`tests/task-example.cjs` checks the reference run, a valid alternative, the no-action, over-planning, rule-breaking and unneeded-practice controls, and that no plan passes both the base and the twin. Load either seed with `env.load_seed` (with `virtual_now` `2027-03-01T09:00:00-05:00`); the package's `fixtures/binding.json` and `fixtures/policies.json` apply.
