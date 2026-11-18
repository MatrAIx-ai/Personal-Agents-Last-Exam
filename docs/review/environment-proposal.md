# Environment proposal review

Review a plan for useful, reusable App behavior. Working implementation or completed Agent rollouts are not prerequisites at this stage. The repository's [contribution process](../../CONTRIBUTING.md#review-and-implementation) governs approval: a maintainer records the approved scope and commit; implementation continues in the same PR.

## Review baseline

Read the proposal, PR body, comments, explicitly related tasks/environments and current template. Record exact revision and review scope. The public App/runtime is a reference profile, not permanently frozen infrastructure. Distinguish blocking dependencies, optional reuse and merely related work. See the [extension boundaries](../environment-architecture.md).

When proposals overlap, notify the author and link the existing work; suggest collaboration or a clear division of scope. Approval does not reserve ownership or prevent parallel implementation. Do not reject solely because another proposal is approved. Once related work merges, assess later submissions for additional value. Only a validated merge counts as an accepted contribution.

| Dimension | Evidence to request | Reason for the check |
| --- | --- | --- |
| Usefulness and reuse | Intended workflows, task demand or independent rationale, overlap and added value | An App should expose reusable behavior rather than encode one task's answer. Overlap alone does not reserve ownership. |
| Complete declared workflows | Entities, transitions, reads/writes, applicable confirm/modify/cancel/error paths | Page count or a screenshot does not establish operational completeness. Scope need not reproduce every feature of the reference product. |
| Entry points and callers | MCP/API/GUI modes, Agent business operations, Infra setup/history/reset/events | Keep privileged management separate. A reviewer console is not automatically an Agent CUA interface. |
| State and lifecycle | App/account/run isolation; seed/history; commit evidence, retries, concurrency and reset/restore boundaries | Prevent duplicate effects, silent conflicts and irreproducible state. Snapshot alone does not promise restore. |
| Events, time and messaging | Accepted events, business timeout effects, independent send/receive directions, relevant receiver-owned contracts | Tasks choose scenario content/timing; Apps define effects; Infra schedules and binds accounts. Mail is only one possible receiver. |
| Data and media | IDs/references, formats/bytes/counts, collection/synthesis, provenance, licenses and missing-data behavior | A schema accepting a MIME string does not establish runtime support or usable original assets. |
| Dependencies and effort | Required versus optional services, owners, sequence, effort and resource costs | Attribute platform dependencies correctly instead of calling them contributor defects. |
| Verifiability | Core success/error examples, expected state/receipt, business tests, public-runtime checks and human review | An independent reviewer needs observable acceptance criteria rather than a promised test count. |

## Integration expectations

Authors should consult the [existing App contracts](../app-integrations.md) and reuse receiver business interfaces. They implement their own business, publish declarations and compatible messages; they do not implement a replacement personal inbox/calendar just to connect to it. A required receiver/channel that does not exist is an explicit dependency.

For each planned connection, check the linked App/tool/receive-schema version, whether the dependency is required or optional, the direction and data/file formats, and the observable outcome in the receiving App. The plan should identify who supplies a missing capability and how the integration will be demonstrated. A sender's successful return alone is not a sufficient acceptance criterion.

### Verify the dependency, not only its name

Inventory the personal Apps needed by the declared workflows, including Apps the Agent calls separately rather than through Messaging. Also list other receiving/sending Apps. For each connection, record:

| Workflow and required effect | App and required/optional scope | Reviewed implementation revision and public interface | Capability check and planned evidence | Missing capability, owner and fallback |
| --- | --- | --- | --- | --- |
| Example: order confirmation reaches an inbox | Mail; required for this workflow | Pinned App package, receive declaration, operation and payload/wire schema | Check the example against the receiver schema; later verify the actual inbox record and receipt | Record any missing feature; do not infer it from the App name |

This is a reviewer evidence table, not a second App registry or an extra author configuration file. Use the proposal's existing connections, integrations and validation fields to request missing information.

1. **Check availability at the reviewed revision.** Open the package and interface files; distinguish an implemented capability from a proposal, test fixture or planned adapter. At the introduction of this check, the canonical personal App examples are Mail and Calendar under `examples/apps/`. Recheck the current tree for each review; the template's mention of Contacts does not establish an implementation. A shared person/account binding is not a Contacts App.
2. **Check the specific effect and caller.** An existing App may lack the required feature. Calendar has business tools and Infra event handlers but currently no Messaging receiver. Distinguish Agent tool use, authorized business-client calls, task-supplied seed/events and App-to-App messages. Do not infer automatic Calendar updates from an email or require every App to connect to Mail.
3. **Read the contract, not just its identifier.** Check input/output shape, required fields, file support, receive operation and version against the proposed use. When an example is supplied, compare it with the actual schema; use the public validator when feasible and record the result. A payload fragment is not a full wire message. If no concrete example is supplied, record compatibility as unverified and request only the detail needed to judge the design. Proposal review does not require a finished App or integration test.
4. **Check completion and failure semantics.** Separate sender commit, receiver commit and any business result returned to the caller. Delivery acknowledgement does not imply a payment decision, a Calendar update or rollback of the sender. Check rejection, retry and unknown outcomes for the proposed workflow. Identify required platform support explicitly rather than assuming a cross-App transaction or request/response interface.
5. **Close or bound the gap.** An unavailable receiver/operation needs an owner, sequence and feasible fallback, or exclusion from the initial scope. Optional future links do not block an independently useful first version. If a linked Task requires the optional connection, record that Task's narrower dependency separately.

Keep diagnostic traces separate from business mutations and grading evidence. For a proposal that needs evaluator-only records of reads or rejected attempts, identify the recording hook and persistence path. The reference Core rejects business-data mutation from read tools; optional best-effort `ctx.log` is not automatically a durable evaluator record. A missing evidence adapter is a platform dependency to resolve, not a reason to weaken read-only guarantees.

Public Core/Messaging makes reference integration reproducible by contributors. Authors identify intended checks and required runtime capabilities in the existing Validation and reset workstream. Do not require token policies, TLS deployment, log retention design or completed tests in a proposal. Optional step logging becomes a delivery requirement only when included in approved scope.

## Findings and outcome

Separate:

- **Design gaps:** core behavior cannot complete, authority contradicts requirements, or an essential dependency has no feasible path. Ask for a specific design/range change.
- **Clarifications/platform decisions:** ambiguous timeout, retry, interface mapping, format budget or responsibility. State the concrete consequence, owner and smallest useful clarification.
- **Optional improvements:** outside first-version scope; do not expand acceptance silently.

For each core workflow, write a precondition → action/event → expected business outcome → relevant failure/control example. Record source, finding, consequence, requested change and follow-up evidence. Existing author questions are acknowledged as open decisions, not misrepresented as omissions.

Recommend ready for scope approval, needs design changes, or insufficient evidence. The recommendation does not itself approve or merge. Substantial scope changes require another design review. Do not invent numeric proposal thresholds or reuse Task three-model/difficulty requirements as Environment proposal gates.

After implementation, apply the separate [App acceptance review](app-implementation.md).
