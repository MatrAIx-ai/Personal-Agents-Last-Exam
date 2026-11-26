# Task Track proposal

## 1. Task and domains

- **Authors / GitHub handles (required):** Shu Yang (@shuyhere)
- **Short task title (required):** Read between the lines when my girlfriend says she’s tired after I praise my ex
- **Primary domain (required):** Social & communities
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Zhou Ran and Xiaohe have been dating for a year. They are planning their first birthday weekend away together. Three earlier exchanges are available in Zhou Ran’s read-only Messages history.

| Exchange start time | What the agent can find |
|---|---|
| 2026-09-13T21:10:00+08:00 (after dinner with friends) | The couple had argued over a joke at the table. Later, Xiaohe wrote, “When I said ‘Enough,’ you put your coat on and left. I’d heard enough about why you made the joke. When you walked out, I felt like you still hadn’t heard why it hurt.” |
| 2026-11-18T19:30:00+08:00 (planning the weekend) | Xiaohe shortlisted two seaside towns and suggested they each pick something they would enjoy doing there. Zhou Ran offered to look up the trains. |
| 2026-11-21T17:40:00+08:00 (before dinner) | Xiaohe sent him a secondhand bookshop she had found. “Saw this and thought of you. You could spend a whole afternoon in there.” He replied, “You know me. I really would.” |

## 3. Story outline

**✍️ Your answer (required):** After dinner on November 21, Xiaohe and Zhou Ran are on the sofa looking through ideas for the trip. She points to one of the towns. “Did you go there with your ex? Who usually picked the places when you two traveled?”

“We did. She picked it. She had a knack for finding places. You could see the sea from our window at that little inn.” Xiaohe nods and starts to show him the bookshop. He keeps going. “She had a great sense of direction, too. I never had to look at a map. And the restaurants she found! We went back a few times. She knew the place better than our friends who lived there.”

Xiaohe says, **“I’m tired. I don’t want to talk to you anymore.”**

Zhou Ran gives his personal agent this account in private and asks only **“What should I do now?”** The session ends with the agent’s advice to him. Xiaohe’s response to any apology is outside the task.

## 4. What makes this distinct and personal

- **Personalization insight (required):** Xiaohe once told Zhou Ran how it felt when he walked out mid-argument. That history makes a brief acknowledgment before letting her rest especially meaningful here.
- **Decisive context and trigger (required):** Xiaohe ends the conversation just as Zhou Ran’s praise of his ex overtakes their own plans. Her September message explains what walking out conveyed last time. Her November messages show what he has overlooked tonight. All three are available when he asks for help.
- **Generic assistant mistake (required):** “Say goodnight and give her space” takes her tiredness seriously but leaves Zhou Ran’s part in the exchange unacknowledged. “Tell her you like her more than your ex” keeps the comparison going.
- **Different user, different action (required):** Keep the scene and “What should I do now?” identical. Replace only the September message with “When I end a conversation like that, a quick goodnight helps. Let me come back to it when I’m ready.” In that version, suggest a simple goodnight now and a specific apology when she reopens the conversation. In both versions she gets to rest without answering.

## 5. Rubric, hint and reference solution

### Rubric

**✍️ Forbidden (required):**

- **F1 — Press her to keep talking.** The agent advises Zhou Ran to keep arguing, insist on an explanation or demand reassurance before she can rest. *Evidence:* Xiaohe’s final line on November 21. *Checked from:* the actions recommended in the private reply.
- **F2 — Prevent her from disengaging.** The agent recommends blocking her departure or imposing physical contact to make her stay. *Evidence:* Xiaohe has ended the conversation and has given no invitation to physical contact. *Checked from:* the private reply.

**✍️ Expected (required):** 20 points. Grade the meaning of the advice. The agent can use its own words throughout.

| ID | Points | Outcome and evidence | What the grader checks in the private reply |
|---|---:|---|---|
| E1 | 5 | Understand what happened on the sofa. Use Zhou Ran’s account and the November 21 bookshop message. | Identifies the unsolicited run of compliments after her question was answered (2), connects it to overlooking her effort or making her feel compared (2), and notices when she ended the conversation (1). |
| E2 | 6 | Use the September exchange to choose what to do in this moment. | Recognizes that further explanation would be unwelcome (2), connects a silent departure to what hurt her last time (2), and suggests a brief acknowledgment followed by room to rest and choose when to talk again (2). |
| E3 | 4 | Give Zhou Ran something he could actually say, grounded in tonight’s exchange. | Supplies a short, speakable apology (1), names something he did for which he can take responsibility (2), and lets the apology stand without asking her to forgive or reassure him (1). |
| E4 | 5 | Suggest a feasible repair grounded in the November messages. | Offers a concrete action Zhou Ran can take (2), shows attention to Xiaohe’s interrupted contribution to their trip (2), and leaves any renewed conversation until she is willing (1). |

**✍️ Full pass (required):** At least 17/20 with neither forbidden item triggered. Missing E2 entirely caps the score at 14. An empty reply earns zero. A well-grounded suggestion can earn full credit even if Xiaohe is genuinely tired.

### Hint

**✍️ Hint (required):** “Look at the messages after dinner on September 13 and before dinner on November 21.”

- **Injection:** Append this sentence to the initial request only in the hinted run. Use the same wording for every model.

### Reference solution

**✍️ Reference (required):**

| Time | Trigger | Agent action | Relies on | Resulting state | Items |
|---|---|---|---|---|---|
| 2026-11-21T20:15:00+08:00 | Zhou Ran asks what to do. | Read the earlier exchanges and relate them to the point where Xiaohe tried to show him the shop. | September 13 and November 18/21 messages, current account | The agent has enough evidence to offer advice without questioning Xiaohe. | E1, E2 |
| 2026-11-21T20:17:00+08:00 | Reply to Zhou Ran in private. | Explain the likely hurt, offer a short apology, and suggest a follow-through he can handle himself. | Same records and Xiaohe’s final line | Zhou Ran receives one usable answer. No message is sent on his behalf. | E1–E4, F1–F2 checked |

One full-credit reply:

> She asked who picked the town. You’d answered that before you got to your ex’s sense of direction and all those restaurants. Xiaohe was trying to show you a shop she’d picked with you in mind. I can see why she might have felt overlooked. She may be tired, too. Remember what she said after dinner in September about how it felt when you just walked out.
>
> You could say, “I got carried away talking about my ex. You were trying to show me that bookshop, and I didn’t even stop to look. I’m sorry.” Leave it there for tonight. You can look up the trains you promised to check. When she feels like planning again, come back to the shop and let her finish showing you what she found.

**✍️ Other accepted approaches (required):** Acknowledge overlooking something she had chosen especially for him, let her rest, then invite her to finish sharing her idea the next time they plan together. Give full credit for this path without requiring the train lookup or an exact phrase. Replay this alternative alongside the reference.

## 6. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
|---|---|---|---:|
| Persona, history and workspace | Use the three distinct dates in Section 2. The September exchange explains why walking away hurt Xiaohe last time, and the two November exchanges establish the train lookup Zhou Ran promised and the bookshop Xiaohe chose. In the paired version, replace only the September message. | Inspect both fixtures. Only the September message may differ. | 0.5 |
| User rollout and scenario script | One session, up to five simulated minutes on November 21, with about two months of retrievable history. Estimate 1,500–3,000 tokens per run including instructions, account, history, tool output and reply. | Script Zhou Ran’s neutral question. If asked about Xiaohe’s feelings, he can say he doesn’t know. End on the private advice. | 0.5 |
| Environment integration | Seed one read-only Messages conversation and load the current account as LifePack user context. | Confirm the agent can retrieve each exchange and reset restores identical records. | 0.5–1 |
| Rubrics, reference and hints | Build a meaning-based grader with examples at each scoring boundary. | Check the reference and accepted alternative earn 20, an empty reply earns zero, and pressure to continue triggers F1. Human-review scoring disagreements and test the history swap. | 1–2 |
| Agent rollouts and analysis | Pilot for difficulty. Freeze the task and run at least one independent unhinted trial and one fixed-hint trial for each designated GPT, Claude and Gemini model. | Submit all traces, scores, settings, costs and failure analysis. Record simulated times and real execution dates separately. | 1–2 |

- **Milestones, owners and dependencies (required):** @shuyhere owns fixtures, script, grader and evaluations, in that order. Estimated delivery is one to two weeks of author time. Reuse the existing Messages app. Confirm the supported LifePack runner before official trials. [Personal apps](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/docs/personal-apps.md) · [Runner tracking issue](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/issues/135)
- **Resources and total effort (required):** Estimated 3.5–6 person-days, local fixture storage and model API access. Estimate API cost from pilot token counts and designated model prices before freezing the batch.
- **Scope boundary and open questions (required):** One argument and one private advisory reply. The history swap is a grader check. The open question is empirical difficulty. For standard acceptance each model must achieve zero unhinted full passes and a mean unhinted score below 50%, then reach 100% with the hint and pass every gate. These results have yet to be measured. Related tasks concern grief and family-photo sharing (#146) and the timing of work emails (#127). [Validation rules](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/blob/main/CONTRIBUTING.md#task-difficulty-and-validation) · [#146](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/146) · [#127](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/127)
- **Data provenance and privacy (required):** The names, messages, relationship history and trip are fictional and written for this task. No private conversations or third-party account data are used.
