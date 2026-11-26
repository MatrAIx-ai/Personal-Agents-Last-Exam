# Recorded Forkyard evidence

`forkyard-evidence.json` is a synthetic export of Forkyard's rejected-pr seed. It was produced from Forkyard commit `e9fe739b0b6af11d3805756a4916c028cf41bb4e` by loading `apps/forkyard/examples/task-data/rejected-pr/seed.json` and calling `exportEvidence` in `apps/forkyard/evaluator/export.cjs` with an empty execution list.

The file is stored in this package so Postyard tests can join a link to pull request 2290 (`object_id` `tidewater/tidewater#2290`, `person_id` `person-ingrid`). Those tests stay inside `apps/postyard/`. Pull request 2318 is the proposal's example id. In that Forkyard seed it is the next counter, so the sample has no row for it.

Regenerate from a scratch checkout of that commit:

```sh
node -e 'const {exportEvidence}=require("./apps/forkyard/evaluator/export.cjs"); const seed=require("./apps/forkyard/examples/task-data/rejected-pr/seed.json"); const doc=exportEvidence({snapshot:{data:seed,epoch:1,revision:0,app_id:"forkyard",run_id:"forkyard-rejected-pr",account_id:seed.account_id,audit:[]}}); process.stdout.write(JSON.stringify(doc,null,2)+"\n");'
```
