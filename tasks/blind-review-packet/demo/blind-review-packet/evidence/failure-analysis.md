# Control results and grader checks

Harbor ran both sessions for each control in a fresh Docker environment. The controller transcripts contain the initial App snapshots, every exposed tool result and delivered message, the world event, and both deadline snapshots. The evidence manifest records the input identities, actual run times and per-step results. Each compressed trace expands to the verifier's original JSON bytes. [Run manifest](manifest.json)

| Control | Morning A1 | Noon B1 | Score | Full pass |
| --- | --- | --- | ---: | --- |
| Primary reference | A1 counted with R-410 | B3 open | 100 | Yes |
| Alternate reference | A3 open | B3 open | 100 | Yes |
| Empty packet | Empty | Empty | 0 | No |

In the primary history Ren locked A1 before seeing a source, so the lock remains usable after the meeting. B1 has only an autosave and needs a reserve at noon. In the alternate history the same lock follows Ren's own labelled Harbor edit. The reference reads the changed message through Mail and selects a summary reserve. It uses the same code, tool permissions and scoring rules in both trials.

The deterministic replay matrix exercises all 12 valid combinations of same-category reserve choices across the two histories. Replacing both meeting pairs loses the valid lock and scores 75. Counting the B1 autosave at both deadlines scores 70. A duplicate slot can score 95 while failing the structural gate. Repairing a packet after writing a model alias still fails F1. The old card names alone pass. A message that picks a winner fails F2, and a potentially identifying paraphrase is held for review. [Case-by-case grader output](grader-validation.json)

The controls establish that the task is solvable and that specific mistakes produce the expected outcomes. Measured difficulty for the designated GPT, Claude and Gemini models is pending. The proposed batch contains six pilots and eighteen formal trials once the roster and runner interfaces are available.
