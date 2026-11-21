# SubmissionDesk 0.1.0

An original synthetic scholarly submission App for personal agents. Owner: Hanson Tang (@hansontang). Approved MCP-only scope: [proposal #148](https://github.com/MatrAIx-ai/Personal-Agents-Last-Exam/pull/148), approved content at `ec0dfd8cd6f2550263e8566e7e51d5a6436dffe2`. Runtime 1.6.0 / Core API 1.2.0. No real portal, real research, external network or model API is required.

From this App directory, `npm test` and `npm run example` run standalone domain checks. From the public checkout root:

```sh
node runtime/build-contracts.cjs --check
node runtime/cli.cjs verify --app apps/submissiondesk --output .artifacts/submissiondesk-public.json
node apps/submissiondesk/tests/runtime.cjs
```

Start separate public MCP processes with `node apps/submissiondesk/service.cjs --role infra --run demo --state-dir .state`, then the equivalent command with `--role agent`. An App copied outside the checkout can set `PALE_RUNTIME_ROOT` to the public runtime directory. The business package has no runtime imports or third-party packages; the runtime integration test intentionally uses the public host.

The App defines immutable text materials, derived material provenance, content/author bundles, participant requests/replies, abstract registrations, actual received snapshots, replacement and withdrawal receipts. Participant replies are controlled external events. A request acknowledgement is not approval; the portal deliberately does not infer a participant's semantic authority or check whether content is safe to publish.

One account is loaded per App instance. The binding defines people and account owners. `fixtures/minimal.json`, `account-jun.json` and `account-ali.json` are three independently loadable seeds, not simultaneous account access. Use separate run/state roots for isolation, or explicit Infra `env.load_seed` with the matching binding. Never give an Agent the Infra connection.

The seed contains 19 original business records, five known people and a historical received snapshot; no file assets are included. Business JSON is bounded at 512 KiB, and one material's UTF-8 section JSON is bounded at 64 KiB. These are App limits, separate from the public host's decoded-asset limit. Fixtures contain no Task answer keys or hidden user/actor state.

Identical-content bundles, repeated independent participant requests and retained snapshots may have different identities. The dataset permits duplicate record bodies for those valid business effects; the model still rejects duplicate IDs, broken provenance/digests, future replies and branched receipt histories. The original fixture has no duplicate-body padding.

Included modify/cancel paths: derive a new material, create a new bundle, replace a received submission atomically, withdraw with a new historical receipt, cancel an unanswered request, and cancel an unused abstract while its window is open. Deferred: mutable drafts, reopening withdrawals, policy/access-change events, approval revocation, outgoing notifications, GUI and cross-App integrations. No extra Core administrative operation is implemented.

Infra event examples use the public `{event_id, at, operation, payload}` envelope. `examples/scenario.json` demonstrates `record.add`; the example and tests demonstrate exact-digest `approval.reply` and `material.add`. All times are offset-bearing and controlled by the public clock; business calls do not advance time.

Business writes return `{value: ...}` to Core, which supplies `status`, `app_id`, and the committed epoch/revision. Domain history correlates object IDs with the caller's `request_id` or event ID; received snapshots preserve full actual content. Export an Infra snapshot and execution evidence before reset. `env.reset` restores only this App instance's loaded business/time baseline and clears Core receipts/audit according to the host contract; snapshots do not imply arbitrary restore.

The complete operation/evidence map and release verification report are maintained under `docs/validation/submissiondesk-v0.1.0.md` in the public checkout. Local reference checks are implementation evidence, not maintainer acceptance, final merge, model difficulty qualification or deployed authentication.
