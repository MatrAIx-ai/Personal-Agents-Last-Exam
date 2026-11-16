# [Task Proposal] [Money & insurance] Build and proactively maintain a personal investment policy

This proposal uses fictional people, synthetic financial data and simulated app records. Implementation and model evaluation will follow design approval.

## 1. Task and domains

**Authors / GitHub handles:** Nassim (@nassimberrada)

**Short task title:** Build and proactively maintain a personal investment policy

**Primary domain:** Money & insurance

**Secondary domains:** None

## 2. User persona and prior history

The user is a self-directed investor with assets spread across brokerage accounts, cash savings, and retirement accounts. Their financial goals, circumstances, risk preferences, and constraints are scattered across conversations and personal data sources.

They have several competing priorities: long-term wealth creation, a large purchase in the coming years, maintaining an adequate cash reserve, and managing exposure to individual stocks. Their income may be uneven, and their ability and willingness to take investment risk may differ.

Their circumstances can change materially over time. A job loss, pay rise, new dependent, unexpected expense, change in the timing of a major purchase or family event could affect their financial goals and the suitability of their portfolio.

The user wants an agent that understands their financial situation over time, helps define an Investment Policy Statement (IPS), and notices when changes in their life may mean that the policy or portfolio needs review.

## 3. Story outline

Across 5–6 sessions over a simulated period of 9–12 months, the agent builds and maintains an understanding of the user's financial life.

Initially, the agent reviews permitted information sources, asks targeted questions, and distinguishes confirmed facts from assumptions and unknowns. It learns about the user's goals, time horizons, income, assets, liabilities, liquidity needs, risk tolerance, risk capacity, preferences, and constraints.

It drafts an IPS covering these factors, including target allocation, liquidity requirements, risk limits, investment preferences, and review conditions. The user reviews and approves the policy.

The agent then monitors the portfolio and the data sources the user has explicitly permitted it to access. It looks for material changes in the user's circumstances, not just changes in market prices or portfolio weights.

For example, the user receives a termination notice from their employer. The agent detects this information in an authorised data source, recognises that expected income and liquidity needs may have changed, and assesses the potential impact on the user's financial plans. It updates its planning assumptions, checks whether planned goals remain feasible, and assesses the implications for the overall portfolio.

The agent proactively contacts the user, explains what it detected, why it may matter, and what assumptions it used. It asks the user to confirm the information and discusses whether the IPS should change. It does not silently change the approved IPS or execute trades.

Other scenarios include a a new dependent, an unexpected expense, a change in the timing of a home purchase, a shift in the user's risk preferences, or a significant personal event.

When the user confirms a change, the agent updates the relevant assumptions, proposes revisions to the IPS, records the approved changes, and reassesses the portfolio against the revised policy.

## 4. What makes this distinct and personal?

The task tests whether an agent can maintain an evolving understanding of a user's financial life, rather than simply answer questions using a static profile.

The same portfolio may be suitable for one person and unsuitable for another. Its suitability depends on the user's goals, time horizons, income stability, liquidity needs, risk capacity, risk tolerance, and preferences.

The agent must also recognise that a portfolio can become unsuitable because the user's circumstances have changed, even when the portfolio itself has not changed.

Key challenges include:

- **Personal context:** Retrieve relevant facts from past interactions and permitted data sources. Distinguish explicit statements, inferred information, outdated details, and unknowns.
- **Proactive awareness:** Detect potentially material life events in authorised data streams and identify when they may affect the user's financial plan.
- **Materiality assessment:** Work out whether an event is significant enough to warrant contacting the user. Avoid excessive alerts about minor or uncertain signals.
- **Verification:** Explain the evidence behind a detected event and confirm uncertain information with the user before relying on it.
- **Policy construction:** Translate the user's goals and constraints into a clear, usable IPS.
- **Policy maintenance:** Propose updates when circumstances change, preserve prior versions, and record why each approved change was made.
- **Portfolio assessment:** Evaluate the whole portfolio against the user's current IPS, including allocation, concentration, liquidity, risk, and goal feasibility.
- **User control:** Keep the user involved in decisions. The agent can detect, analyse, explain, and propose, but cannot silently change the approved IPS or execute trades.

The central evaluation question is: can a personal agent notice when a user's financial life has changed, understand the implications, and initiate a useful conversation before the user asks for help?

## 5. Construction plan and effort

| Workstream | Plan and deliverables | Estimated effort |
|---|---|---:|
| Persona, history, and workspace | Create 10–15 evidence items across conversations, notes, financial records, and portfolio data. Include explicit, ambiguous, outdated, and conflicting information. Define user goals and constraints. | 2 days |
| User rollout and scenario script | Build 5–6 sessions across 9–12 months of simulated time. Cover initial discovery, IPS drafting, portfolio review, life events, proactive outreach, policy revision, and final assessment. Include confirmation, disagreement, and no-response branches. Estimated 25k–45k tokens. | 2–3 days |
| Environment integration | Reuse the personal-agent environment. Provide synthetic holdings, balances, income, expenses, goals, and IPS versions. Add permitted data streams with simulated life events, plus read/write actions for analysis and policy updates. No live brokerage or trading access. | 2–3 days |
| Rubrics, reference, and hints | Define rubrics for context retrieval, question quality, risk profiling, IPS completeness, event detection, materiality, evidence verification, proactive outreach, policy versioning, and portfolio assessment. Include privacy and action-boundary checks. | 2 days |
| Agent rollouts and analysis | Run at least 3 unhinted rollouts per designated GPT, Claude, and Gemini model, plus hinted runs under the validation protocol. Analyse failures and compare agent behaviour across scenarios. | 2–3 days |

### Milestones, owners, and dependencies

Owners: Nassim (@nassimberrada).

1. Define the persona, financial history, and initial IPS requirements.
2. Build the multi-session scenario and simulated life-event data streams.
3. Implement the synthetic financial environment and permitted agent actions.
4. Create reference answers, rubrics, and safety checks.
5. Run agent evaluations and analyse results.

The scenario and environment should be ready before the final evaluation runs.

### Resources and total effort

**Estimated effort:** 10–13 person-days over 2–3 calendar weeks.

Use synthetic financial and personal data. No paid market-data feeds or live financial accounts are required. Model/API costs should be estimated after a pilot.

### Scope boundaries and open questions

In scope: personal financial context, IPS creation and maintenance, proactive detection of material life events, portfolio assessment, and user-approved policy changes.

Out of scope: tax preparation, detailed retirement planning, security selection, guaranteed investment outcomes, and execution of trades or account changes.

The agent must not treat every detected signal as fact. It should consider source reliability, confidence, relevance, and materiality before contacting the user. It must explain what it detected and allow the user to correct or dismiss its interpretation.

Monitoring must be permission-based. The user should explicitly choose which data sources the agent can access and what it may monitor. Access to a source must not be treated as permission to inspect unrelated personal information.

The agent may update provisional planning assumptions to assess an event's impact, but it must not silently change the approved IPS. Policy changes require discussion and user approval.

The exact personal-agent environment and available integrations remain to be confirmed. The initial implementation should use deterministic synthetic data streams and simulated events.

### Data provenance and privacy

All user histories, financial records, portfolio holdings, income details, and life events should be fictional and synthetically generated.

No real account credentials, private messages, or identifiable third-party data should be involved. Source and reuse terms for any external reference material should be documented.

The environment should model explicit permissions for each data source. Evaluation should test whether the agent stays within those permissions, avoids exposing unrelated information, and explains the evidence behind proactive alerts.