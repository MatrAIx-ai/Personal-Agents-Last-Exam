# Full study workspace GUI validation

Use the public PALE Runtime 1.6.0 / Core 1.2.0 pinned in the proposal
(`61b637164e4abddf81536bb48935cdb688a69ff1`), not production accounts.
Run from this App directory with `PALE_RUNTIME_ROOT` set to its `runtime/`
directory.

```sh
node --input-type=module --check < gui/src/app.js
node tests/host-full.cjs
```

The second command exercises the real loopback Web Host and fixed Agent MCP
connection, with a separate Infra client for events. It does **not** drive DOM
interactions. It checks all mutation gates, authoritative read-back, events and
non-mutation cases. For a fresh browser session follow the launch instructions
in the App README; use sandbox/editor for the main run and scenario/observer
for the denial run. For direct reads use a separate Agent connection bound to
the same registry, run and state directory. Use a separate Infra connection
for event or reset calls; do not expose it in the browser.

| Workflow | Browser exercise | Authoritative evidence |
| --- | --- | --- |
| Cards | In Decks, Open Train station; edit prompt, discard, reopen. The old prompt remains. Edit again and Save card. Reopen, click Suspend card, check Queue, then Restore card from Decks. | Read C1 via `get_card` before and after; same ID, incremented version on saved edits and suspended flag toggles. Due visibility changes; history does not. |
| Plan | Edit plan; change target, Preview plan and then Discard. Repeat and Save previewed plan. Change input after another preview; old save button disappears. For stale path open a draft and have a second Agent confirm a plan before clicking Save. | `get_plan` version/plan unchanged on preview/discard; target, limits and projection match the committed browser save. Second writer wins stale case. |
| Session | In Queue, Reveal Train station; Close revealed card without rating. Reveal again, click Pause at this card, reload, confirm the persistent cursor and paused state; Resume session, reveal C1, choose Good exactly once. | `get_queue.session` has C1 and appropriate paused flag. Reload leaves paused cursor and no new ledger item. After Good, one new row, C1 due day 3 from day 0 and one fewer daily slot. |
| History | In History click Undo latest review, then Keep review. Reopen confirmation, click Confirm undo. | `get_history` same review ID marked undone, no duplicate effective review; original due day/stage and one slot restored. |
| Correction | Reveal C1, leave old form open. On separate Infra connection apply `study.correct_card` using current version/revision; click Good on old form. Refresh, then reveal corrected answer. | Stale write denied, no review added; `get_card` version/answer changed. Verify correction notice in Plan. |
| Target/capacity | From Infra apply `study.change_target` using current plan revision with target day already passed; Refresh Plan. | Notice includes plan ID; missing slots positive, previous daily/new limits and review history unchanged. |
| Observer | Launch a separate scenario-profile run. Confirm no card, plan, session, rating or undo mutation buttons. Try an unauthorized write with fixed HTTP Agent bridge. | Tool discovery excludes mutations and the bridge rejects direct unauthorized writes. Read-only reveal and preview may still be allowed by policy. |
| Navigation | Start reading a card/preview then change tabs; re-open Plan, refresh and navigate while a late read is in flight. Make a write with a temporarily interrupted response, then retry. | Old response must not replace the current view or toast. If the write was accepted before its reply was interrupted, exact retry returns the original result and adds no second effect. |

For explicit reset tests, compare seeded business state after two Infra resets,
excluding Core epoch/receipts/audit. Browser evidence should list the actual
browser/version, profile, pinned runtime SHA, synthetic run and the completed
rows. Do not claim unrun rows or independent replication.
