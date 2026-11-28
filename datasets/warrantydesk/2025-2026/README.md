# Continuous manufacturer/service histories — dataset 2.0.0

This revision addresses the dataset review of the 1.0.0 supplement. The approved MCP-only App package and proposal remain byte-identical. The new delivery changes evaluation data, generators, verification and evidence only; independent maintainer acceptance remains pending.

## Actual account histories and business variation

Eli, Maya and Ren each have one cumulative 2025–2026 service account, rather than isolated copies of one return. Manufacturer-side history includes dated purchase proofs, registrations, protection invoices with actual coverage periods and renewal prices, support contacts/decisions (including inquiries that create no new remedy), and owner follow-up records. These sources retain product serials and ticket/invoice references; they are not a note on the first of each month to fill a calendar.

Nine distinct remedy cases cover different work handsets, household tablets and personal handsets. Holds range from USD 145 to USD 355 and have case-specific serials, deadlines and courier windows. Three normal returns, three pre-dispatch withdrawals and three shipped-replacement withdrawals have different physical and financial histories. Normal cases retain failed independent work checks, refused initial IT requests, later successful enrollment, fresh login checks and subsequent erasure at separate times. Two first pickup windows are missed, two actual manufacturer receipts are late, and all release postings remain separate from courier collection. All three profiles retain purchases, monthly coverage periods and different support topics across every month.

Off-case months contain actual synthetic manufacturer invoices, distinct support contacts/decisions and relevant ownership/coverage evidence. Monthly billing is naturally recurring; purchase, support and remedy records have their own dates and meanings. The data do not invent a new phone fault each month. Each profile has three remedy cases over two years, with original/replacement custody and financial history preserved.

## Coverage and provenance

The dataset is **fully synthetic**. No records are observed customer, manufacturer or transport-provider history, and no real anchor is claimed or required. People, tickets, devices, prices and providers are invented. Generation is dated 2026-11-27; represented December 2026 events are explicitly synthetic, not collected future facts. Code/data attribution: Hanson Tang (@hansontang), under the repository/App license.

The represented window is **2025-01-01 through 2026-12-31 inclusive**, counted in **Etc/UTC**. Every account covers every month; the global count is 264 distinct dates. This corpus count is not a Task's selected pre-session history and must not be substituted for one.

| Account | Distinct dates | Covered months | Earliest | Latest |
| --- | ---: | ---: | --- | --- |
| warranty-eli | 120 | 24 | 2025-01-01 | 2026-12-31 |
| warranty-maya | 113 | 24 | 2025-01-01 | 2026-12-31 |
| warranty-ren | 116 | 24 | 2025-01-01 | 2026-12-31 |

`coverage.json` reports 902 object/history rows, 887 dated facts, per-account/month/source/date distributions, inactivity dates, structural exclusions and zero unresolved date errors. Native objects, actor replies and ordered history are separately labelled sources. Multiple records or fields on one day count once globally. Scheduled deadlines and windows, generation dates and filesystem modification times are not counted as occurred activity. The report contains an explicit fully-synthetic statement.

Each account is directly loadable as a single seed; no concatenation of independently reset ledgers is needed. `source_catalog` qualifies source-record types and actors, and `date_fields` identifies the actual authoritative occurrence field in each collection. The App package pin is `f875affe5e5dd90938a263a8bd238151a116ab791726441bf5067e64ec58da39` at source revision `f8c675cdbe7a560654f2ee74b934a359c3d79644`. Source hashes cover this dataset's configuration/generation code and its own App inputs. `config.json` is per-dataset; another App's revision is not hard-coded into this dataset's tooling.

## Reproduce, count and read back

With Node.js 18+ and built-ins only, from a checkout containing the pinned App and public runtime:

```sh
node datasets/warrantydesk/2025-2026/generate.cjs
node datasets/warrantydesk/2025-2026/coverage.cjs --check
node datasets/warrantydesk/2025-2026/verify.cjs
```

The generator imports original source metadata and calls the App's actual business entrypoints/events in chronological order. It is author-side synthesis, not a replacement Core, model rollout or MCP transaction transcript. The verifier separately uses real Agent/Infra MCP processes, loads all three account histories, reads every source list and full business receipt/proof/ledger fields, compares persisted state, checks reset, and rejects corrupted history atomically. Reports are `mcp-readback.json` and `base-mcp-readback.json`. Set `PALE_RUNTIME_ROOT` to an independent pristine `runtime` directory for the latter, passing its output path as the verifier's first argument.

`standalone-mcp-readback.json` repeats the checks from an isolated directory with only this App package and this dataset, using explicit `PALE_APP_ROOT` and an external pristine `PALE_RUNTIME_ROOT`. App/fixture source pins are resolved against that supplied package; no other App's private state is copied or read. `manifest.json` pins all evidence files and both runtime source trees. After checking, set `PALE_BASE_RUNTIME_ROOT` to the exact pristine runtime used and run `node datasets/warrantydesk/2025-2026/manifest.cjs` to reproduce the manifest.

## Obtain a Task history before its first session

For a Task starting inside the coverage window, materialize a valid historical prefix by replaying only the source imports and actions preceding its first-session cutoff:

```sh
node datasets/warrantydesk/2025-2026/generate.cjs --before 2026-06-15T12:00:00Z --output task-prefix.json
```

The command supports cutoffs from 2026-01-01 through 2027-01-01. It leaves the committed full corpus unchanged. Source occurrence times and completed actions in the output precede the cutoff; already published future service/contract windows can remain known. Pending requests, open obligations and coherent reference/financial state are retained as they existed then. The full final snapshot is not merely filtered into orphaned rows. The verifier actually generates this prefix, loads and reads all three resulting accounts, and resets to those selected baselines.

To load one selected account, use these fields on the **Infra** connection, with `expected_version` from the current `env.snapshot`:

```javascript
const selected = prefix.seeds.find(s => s.account_id === 'warranty-eli');
await infra.call('env.load_seed', {
  expected_version: observed.version,
  data: selected.data,
  binding: prefix.binding,
  virtual_now: selected.load_at
});
```

For a Task beginning after 2026, the full corpus ends before its first session: load the selected full history at 2027-01-01, then use Core's Infra-only `env.advance_time` to the declared session time before adding authorized scenario events. For earlier Tasks, use the prefix command. Recount only the actual selected context/seed before the Task cutoff, including any separately supplied personal history, rather than reporting the whole Environment corpus's total. The Agent cannot load, reset or inject its own history.

## Approved-v1 limitations

Approved v1 rejects a wrong-serial collection or receipt without recording a manufacturer-side “wrong item received” business fact. Such rejected attempts can be examined in execution traces; Task authors must not expect a mismatch receipt in case state. The App models replacement coordination and the private check journal. Coverage invoices and other support contacts are source records, not new insurance, repair, banking or billing operations. No additional capture, overdue fee or live authentication behavior is added.

Coverage and readback do not establish model difficulty, production deployment or final acceptance. The original App business/MCP evidence remains in `docs/validation/warrantydesk-v0.1.0.md`. This dataset's review baseline is the #260 evidence policy at `6933c430942c64f94874083815829e4a4b20920a`; the reviewed main revision also includes unrelated Mail maintenance, with no App/Core changes needed for these data.
