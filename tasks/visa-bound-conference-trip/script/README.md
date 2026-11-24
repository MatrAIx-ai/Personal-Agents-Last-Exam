# User model

`user-model.cjs` decides what Mingyu does, from records the runner reads in the Apps. It uses no LLM, so a run replays exactly. Run the tests with `node --test user-model.test.cjs`.

| Function | Input | Rule |
| --- | --- | --- |
| `SESSIONS` | — | Four scripted sessions: 2027-02-08 20:30 (plan the trip), 2027-02-10 09:12 (Munich first; keep an eye on everything), 2027-02-10 21:00 (session 2b, from `session2b`), 2027-03-16 21:05 (reorder the USB-C hub). Every session continues the same conversation. |
| `session2b(flags)` | What the agent asked earlier | Always: payment authority for anything the trip needs, and at most two alerts before the qual. Optional answers about the arrival date, a roommate and the host letter. |
| `mingyu(alerts)` | Alerted calendar events the agent created | From 2027-02-10 21:00 to the qual at 2027-03-18 09:00 at most two fire, counted cumulatively; later ones are muted and he lists them the next time he talks to the agent. An alert asking him to message the assistant starts a session at its time. An alert asking him to approve the Northline payment approves the held fare, which takes effect only before the hold's release at 2027-02-09 20:40. Alerts before the rule or after the qual are not limited. |
| `chatOnly()` | A request or promise made only in chat | Nothing happens. |

The hint (`HINT`) is appended to the system prompt at the start of every session, scripted or alert-triggered.
