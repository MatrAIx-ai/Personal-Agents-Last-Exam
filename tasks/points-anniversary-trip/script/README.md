# User model

`user-model.cjs` decides what Daniel and Mei do, from records the runner reads in the Apps. It uses no LLM, so a run replays exactly. Run the tests with `node --test user-model.test.cjs`.

| Function | Input | Rule |
| --- | --- | --- |
| `SESSIONS` | — | Three scripted sessions: 2027-08-24 21:00 (book the trip), 2027-09-12 10:30 (Sapphire Reserve statement balance and due date), 2027-10-03 11:00 (Kikunoi dinner on the calendar, plus a rundown of the trip, so E7's trip report answers a request). |
| `answer(question)` | A question the agent asks Daniel in session 1 | Fixed replies: Mei's points → yes; the bonus → "You know my rule."; anything tonight → "Not tonight. Grant."; otherwise "I trust you." |
| `daniel(alerts)` | Alerted calendar events the agent created | From 2027-08-24 21:00 to 2027-10-01 17:00 at most two fire, counted cumulatively; later ones are muted and he complains next time. An alert in 23:30–07:00 is muted but counts. An alert asking him to message the assistant starts a session at its time. A Progressive payment runs only if the alert names it; on the Hilton Amex only if the alert names that card (otherwise his debit card), posting two business days later. |
| `mei(texts)` | Texts the agent sent Mei | `classify` calls a text exact when it names an amount (a number or "all"), the Combine points method and Daniel as destination. During her night shifts she reads at 07:30 and 15:00: an exact text is done at 07:40 (or 15:00 if it arrived later); a vague one gets "how many and where exactly?" back. She sends the amount asked, capped at her 171,900. |

The approved proposal left the session start after an alert with small tasks open; here the session starts at the alert's time. Asking Mei for all of her points is accepted (E6); Aeroplan family sharing has no tool in #193, so it is not modeled.
