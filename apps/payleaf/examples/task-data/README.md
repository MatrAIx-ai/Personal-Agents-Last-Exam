# Task data

`seed.json`, `binding.json` and `policies.json` are input examples: a small history of one account, the people and accounts of the run, and the tools that the Agent may call. A task replaces all three through `env.load_seed`, with its own `virtual_now`. Loading is an Infra operation, so the Agent cannot do it. Edit the three files together, because the account and the owner in the seed must exist in the binding.

This seed is built for a clock of `2026-11-19T12:00:00-05:00`, so that the seven example events of the approved plan apply to it in time order. It holds 5 pay calendar entries (2 of them paid), 2 pay statements, 3 setting changes, 2 pay inquiries, 7 leave requests, 1 enrollment window with its election set, and 3 notifications. The open inquiry `inq-0006` and the pending vacation request `lv-0044` are the objects that the examples `ev-pl-420` and `ev-pl-430` name. The run of `ev-pl-401` writes the deposit `dep-0191` that `ev-pl-410` returns.

A seed may hold any part of the history, for example only the newest notifications, as long as it passes `validateSeed`. To check an edited seed, run `node dev/check-fixture.cjs examples/task-data/seed.json 2026-11-19T12:00:00-05:00` from the package folder.
