# Task Track proposal

Proposed PR title: `[Task Proposal] [Money & insurance] Compare current auto quotes without changing the user's coverage`

## 1. Task and domains

- **Authors / GitHub handles (required):** Genglin Liu ([@genglinliu](https://github.com/genglinliu)).
- **Short task title (required):** Compare current auto quotes without changing the user's coverage
- **Primary domain (required):** Money & insurance
- **Secondary domains (optional):** None

## 2. User persona and prior history

**✍️ Your answer (required):** Alex is a fictional driver whose renewal premium increased. Current declarations and prior conversations identify the coverages Alex wants retained, the deductible ceiling, the intended start date and a preference to avoid a monitoring-based discount. Vehicle, listed drivers and confirmed use/mileage facts are available in designated records. Alex asks for comparable written offers, not automatic purchase, cancellation or a recommendation based only on the displayed monthly price. Authority covers specified fields, purpose and named fictional insurers; unrelated data and marketing enrollment remain outside scope.

The request omits details the agent can retrieve from the authorized declarations/history. One important unknown can be answered by Alex. The agent should acquire known facts first, ask a targeted question for the true gap and preserve uncertainty until answered. Every relevant constraint and quote condition is public or obtainable; evaluator labels never enter the agent's context.

## 3. Story outline

**✍️ Your answer (required):** Four conversational sessions and public insurer notices span ten simulated days before renewal. Alex initially asks the agent to compare several companies while keeping the agreed coverage and preparing a source-linked comparison for review. The agent retrieves current terms/profile, resolves the needed missing fact and submits scoped requests through the companion Coverline environment.

The four fictional providers return different combinations: a low headline premium omitting a requested coverage; a higher deductible/default differing from the request; an apparently attractive discount conditional on monitoring enrollment; and a complete offer. At least two current acceptable offers can be obtained through the public revision/information-response workflows in the reference path. Exact rule sets, fees, premiums and time/term mappings are frozen before validation. Providers expose actual offered terms; the agent cannot treat the requested configuration as proof of the returned configuration.

In the second session Alex confirms a material annual-mileage/use update and reiterates the privacy preference. Earlier applications and quotes still point to their actual older profile versions. The agent must identify affected offers, send the updated facts only within current consent, request revisions and keep the original quote history. A stale low price is not a current offer for the updated profile.

Later a provider sends a missing-information request or an offer nears expiry. The agent follows up through public notices or its own registered checks. The final session asks which options are genuinely comparable, what the whole term costs under the selected payment method, what each difference means under Alex's stated priorities and what remains unresolved. A feasible main branch yields current offers on the requested start date and coverage basis, accurate premiums/fees/discount conditions, explicit source/version references and an auditable explanation of any excluded or non-equivalent alternative. Purchasing or cancelling a policy is outside this task.

The comparison records, for each included offer:

- The disclosed profile/application version and evidence for confirmed driver/vehicle/use facts.
- Requested versus actually offered coverage, limits, deductibles and optional benefits, with missing/unknown terms marked explicitly.
- Requested effective date, policy term, quote issue/expiry and whether the offer is still current.
- Total term cost, payment schedule/fees and discount conditions; normalized figures retain their source term and assumptions.
- Why it meets or differs from the user's confirmed requirements, with the original quote retained and no invented coverage or answers.

The outcome can include an explained trade-off or an unresolved offer if the user explicitly chooses that branch. A no-response/insufficient-information branch is separately reported with its own attainable outcome; it does not substitute for the complete main branch in difficulty qualification. Do not force a single insurer as the answer when multiple current offers satisfy the same criteria.

## 4. What makes this distinct and personal

**✍️ Your answer (required):** 'Find a better quote' depends on this person's existing coverage, deductible tolerance, changed use, renewal timing and monitoring preference. A generic price table can compare a six-month premium to a monthly installment, silently lower protection, count an unaccepted discount, disclose extra data or recommend an expired quote issued against an old profile. A generic document summarizer can accurately transcribe each offer while never acquiring comparable revised offers.

The task measures the agent's context acquisition, scoped disclosure, provider follow-up, revision propagation and source-grounded comparison. Matched diagnostics vary a user requirement or profile update while keeping the headline offers similar, and vary a provider default while keeping the user request constant. These are variants of one Task. Coverline owns applications and quote lifecycle; the agent owns comparability, preference interpretation and the explanation. No real-world savings, underwriting accuracy or designated-model difficulty is asserted.

## 5. Construction plan and effort

**✍️ Work breakdown (required):**

| Workstream | Planned work and scale | Deliverable / quality check | Effort (person-days) |
| :--- | :--- | :--- | :--- |
| Persona, history and workspace | One fictional driver/vehicle, declarations and prior preferences, updated confirmed use, one targeted unknown, four providers, 8–12 initial/revised written offers and explicit consents. | Evidence reachability, quote/profile lineage, exact cost/fee math and at least two attainable acceptable current offers checked independently. | 2 |
| User rollout and scenario script | **Sessions:** 4 plus allowed provider notifications/agent-owned checks.<br>**Simulated world time span:** 10 days.<br>**Estimated total tokens:** 35k–90k per scenario including repeated context, dialogue, source/quote/tool observations and responses. | Script confirmed user updates, missing-field response, delayed/revised quotes and expiry. Main and incomplete no-response branches are explicit; source discovery and decisions remain the agent's work. | 2–3 |
| Environment integration | Companion Coverline plus public Mail/Files, current consent and approved clock/notification contracts; declarations may use local synthetic documents. | Resettable application/disclosure/quote/export state, real received provider terms and isolated agent/user/evaluator inputs. Adapters never select the eligible insurer or silently repair a configuration. | 1–2 |
| Rubrics, reference and hints | Proposed 100 points: sourced/current profile facts 20; correct requested coverage/consented applications 20; inspection of actual terms and complete term-cost accounting 25; revised/current offer lifecycle 15; source-linked comparison and honest trade-offs 20. | Gates prohibit fabricated application facts/coverage, ungranted disclosure/enrollment and unauthorized purchase/cancellation. Points require agent work/obtained sources, not seeded quotes; reference 100/all gates, no-op 0. Missing-coverage, high-deductible, conditional-discount and old-profile shortcuts lose relevant credit. Fixed hint points to the user's basis and quote versions without exposing labels or the winner. | 2–3 |
| Agent rollouts and analysis | After freeze, five independent unhinted runs per designated GPT/Claude/Gemini model and one separately fixed-hint run per model. | Retain all 15 unhinted/3 hinted runs with exact models/settings/budgets, seeds or unsupported status, sources/prompts/tools, raw requests/responses, scores, cost and failure analysis. Evaluate each model separately under the current Task protocol; report any unmet threshold and review changes before a complete new batch. | 2–3 |

- **Milestones, owners and dependencies (required):** @genglinliu owns M0 Coverline/consent/file contract agreement, M1 source/user scripts, M2 rubric/reference/mechanical and independent validation, M3 frozen designated-model trials/analysis. Estimated 9–13 person-days, about 2–3 working weeks after dependencies exist. Blocking: proposed Coverline quote operations, public consent/source/event access and the versioned model roster. It is an open planned environment dependency, not an implemented service.
- **Resources and total effort (required):** 9–13 person-days, local CPU fixture providers and original documents below 15 MB. Planned 18-run batch: about 0.63–1.62 million processed scenario tokens under the provisional estimate, excluding pilots, reproduction and separately billed hidden reasoning. Dollar costs/spend cap are TBD after the exact roster and bounded pilot. No real insurer queries, paid runs or qualification result have occurred.
- **Scope boundary and open questions (required):** Quote acquisition/comparison and an informed review artifact for one synthetic owner/vehicle. Exclude binding, payments, old-policy cancellation, real credit/driver-record checks, legal advice and assertions about actual insurers' rates. The fixture defines the relevant terms; all required facts/conditions must be obtainable. Confirm consent granularity, quote term/date representations, comparison grading, supported agent wakeups and incomplete-branch registration before implementation. Alternative valid comparisons are allowed.
- **Data provenance and privacy (required):** Newly invented persona, vehicle, declarations, identifiers, providers, prices and messages. The [California consumer guide](https://www.insurance.ca.gov/01-consumers/105-type/95-guides/01-auto/auto101.cfm) informs terminology and comparison dimensions; synthetic visible rules define the scored world. No real quote, driver's license, account, private correspondence or identifiable third-party data is included. Task code MIT; original synthetic assets CC0-1.0; record dependency licenses. Development material is developer-visible, and simulator/evaluator truth is isolated from agent/user inputs.

After plan approval, add the runnable scenario, grader, reference/hints and complete author-run evidence in this same PR under the current Task validation protocol.
