# CRM pipeline and one-shot Trello import

## Safety status

The importer is implemented for local dry-runs only until the confidentiality
migration has been reviewed and applied through the normal deployment path.
No live import was run while building this feature.

Hard boundaries:

- never persist the raw Trello export;
- never persist Trello member profiles, emails, actions, cookies, or tokens;
- never download attachments (metadata and sanitized HTTPS URL only); URL
  userinfo, fragments, tokens, API keys, credentials, sessions, and signatures
  are removed before staging, and only the reviewed `download`, `dl`, or
  `inline` query switches are retained;
- never truncate a field accepted by the Trello schema: the normalized value is
  preserved in full or the input is rejected explicitly by schema validation;
- never delete CRM or ledger rows during import or rollback;
- only Ali and Nabil, matched against exact emails in `auth.users`, can read or
  operate the import ledger or `cofounders` CRM rows;
- applying and rolling back are explicit founder operations, never a side
  effect of opening the CRM.

## Pipeline loading

The CRM page is a Server Component that resolves the current user and
organization once, then reads leads and categories in parallel. The resulting
plain JSON snapshot is passed to the interactive Client Component. Google
connection state, tags, and team members are loaded as one non-blocking
secondary request after the Kanban is already visible. Navigation counts use
one compact summary instead of three full CRM reads.

Read paths do not seed categories, create companies/contacts, or backfill
leads. Any future legacy migration must be an explicit, audited command.

## Normalization contract

`normalizeTrelloExport` accepts the standard Trello board JSON and emits only
bounded staging records:

- open lists become dynamic CRM categories with deterministic status keys;
- cards become leads and retain title, description, due date, closed state,
  labels, checklist text, the first incomplete checklist item as the next
  action, attachment metadata/URL, and external assignment IDs;
- named labels become tags;
- closed cards remain traceable as `dead-end` rather than being discarded;
- unknown lists/cards are routed to a founder-only review category;
- duplicate titles are reported for review but not merged automatically;
- Trello IDs plus stable SHA-256 hashes make repeated dry-runs idempotent.

Before writing staging rows, the service compares active categories, tags, and
leads with the existing organization CRM. Status keys reconcile categories;
normalized names reconcile tags; normalized titles reconcile leads. Exactly one
same-scope candidate is linked without overwriting it. Multiple candidates,
multiple staged leads competing for one existing title, multiple staged labels
competing for one existing tag name, or a scope mismatch add a validation error
and block `apply`. The database repeats those checks inside the transaction so
direct staging writes cannot bypass the preflight. Existing rows and Trello
references are read in stable, complete pages rather than relying on the
PostgREST default row limit.

Trello audit actions are intentionally excluded. The validated source had no
`commentCard` action, so excluding the action history did not remove comments.

The visual list structure is preserved using one category per Trello list.
Downstream business aliases may be used for analytics without collapsing the
visible columns:

| Trello stage family                        | Business alias    |
| ------------------------------------------ | ----------------- |
| Backlog, To be contacted, Today, Cold call | `lead-to-contact` |
| Contacted                                  | `contacted`       |
| A relancer, En attente                     | `to-follow-up`    |
| Meeting booked                             | `meeting-booked`  |
| Presentation, Proposal, Contract           | `proposal-sent`   |
| Done                                       | `won`             |
| Lost, archived cards                       | `dead-end`        |

## Privacy classification

Each staging row stores `access_scope` and an explicit `privacy_reasons` audit
array. Classification is fail-closed:

1. a list must match the explicit sales-stage allowlist;
2. every attached label must match the explicit sales-label allowlist;
3. neither the card nor its checklist/attachment metadata may match the HR,
   recruiting, candidat/candidate, CV, PFE, alternant, apprentice, intern,
   internship, or trainee vocabulary;
4. an orphaned or unknown reference is always `cofounders`.

Any failed rule produces `cofounders`. Free-text keyword detection is therefore
an additional guard, not the sole protection. Before live apply, founders must
review every `fail-closed:unreviewed-label` result and explicitly approve any
new organization-safe label. Do not weaken the fallback.

The same vocabulary boundary is enforced by a database trigger for every
manual company, contact, lead, category, tag, and task write, regardless of the
UI or API route used. `trainee`, `apprentice`, `alternance`, and their common
French/English variants are included. A sensitive write is automatically
changed to `cofounders`; RLS then permits it only for Ali or Nabil. Confidential
scope is deliberately one-way: an edit cannot downgrade it. This is the safe
product default until a separately audited founder-only declassification flow
is designed.

Company/contact/lead/task relationships are validated in both directions. A
cross-organization parent link, or moving a parent while descendants would be
stranded in another organization, aborts the transaction. Escalating a parent
also escalates existing descendants atomically. The migration performs a
read-only consistency assertion before enabling these triggers and aborts for
manual review instead of rewriting tenant ownership.

## Dry-run, apply, and rollback

The production operator uses the audited TypeScript runner. The export path is
optional only because the private Application Support path is the default; any
other file still has to match the reviewed byte size and SHA-256 exactly.

```bash
npm run crm:trello-import -- dry-run
npm run crm:trello-import -- apply --confirm-apply
```

If the Supabase link lives in another checkout, pass only its directory (never
a database URL or token):

```bash
npm run crm:trello-import -- dry-run --database-workdir /absolute/repo/path
```

The runner sends every SQL statement to `supabase db query` through
`/dev/stdin`. SQL, normalized rows, CRM snapshots, provider stdout, and provider
stderr remain captured in memory. Terminal output is restricted to reviewed
hashes, aggregate counts, booleans, and the import run UUID. Do not add shell
tracing, `tee`, `--debug`, or provider output logging around this command.

`dry-run` is read-only: it verifies the exact export, migration/grant/RLS
contract, founder context, in-memory CRM reconciliation, and deterministic
attestation. `apply` repeats those gates, then stages and applies explicitly.
It checks founder and non-founder RLS, all mappings, expected tag relations,
scope/hash consistency, row deltas, conflicts, and an exact idempotent replay.
If a newly applied run fails a postcondition, the runner invokes the
soft-archive rollback and verifies it; it never emits a `DELETE` statement.

1. Run `normalizeTrelloExport` locally and inspect only aggregate counts,
   warnings, duplicate groups, and privacy reasons.
2. Call `stageTrelloImportDryRun` only after the migration is deployed. It
   sends the normalized rows, expected item count, and deterministic staging
   SHA-256 to one database RPC. Run creation and every staging insert commit in
   the same transaction; it never writes the raw export.
3. Review counts, duplicate-title candidates, existing-CRM deterministic
   matches, every `existing-crm:*` validation error, archived-card handling,
   and every founder-only classification.
4. A founder explicitly calls `applyStagedTrelloImport(runId)`. The database
   function locks the run and applies categories, tags, leads, and tag links in
   one transaction. Identical external references are no-ops; changed hashes
   become conflicts and never overwrite an existing imported record.
5. If needed, a founder calls `rollbackStagedTrelloImport(runId)`. Created or
   revived rows and relationships receive `archived_at`; a relation that was
   already archived before the import gets its prior timestamp restored. No row
   is deleted and the ledger remains available for recovery.
6. Staging the exact export again after rollback creates a new active run. Apply
   revives importer-owned rows and references with the same per-item hash. A
   changed rolled-back item is a validation error and requires an explicit new
   reconciliation rather than silently overwriting history.

Every staging/change/reference row is tied to its run by a composite
`(run_id, organization_id)` foreign key. The `security definer` functions repeat
the organization predicate on every ledger read and business-row mutation.
Authenticated clients receive read-only ledger table grants; only the staging,
apply, and rollback RPCs may mutate it. `apply` recomputes and checks both the
expected row count and staging hash before any CRM write, including on a replay.

## Latest local validation (aggregate only)

- 14 lists and 221 cards normalized into 238 staging items;
- 192 open and 29 archived cards;
- 28 due dates and 47 descriptions preserved;
- 5 checklists containing 13 items preserved;
- 1 attachment preserved as metadata plus sanitized HTTPS URL, without a
  download;
- 1 member assignment preserved as an external ID; member profile data was
  excluded;
- 3 duplicate-title groups (3 extra rows) flagged for review;
- 0 duplicate Trello list/card/label IDs and 0 validation errors;
- 1,000 audit actions ignored, including 0 `commentCard` actions.

The full migration chain was also rebuilt in an isolated local Supabase
Postgres instance. `supabase/tests/crm_confidentiality_boundary.sql` verified
cross-organization rejections, manual sensitivity escalation and propagation,
non-founder RLS denial, atomic staging rollback, tamper detection, full
category/tag/lead apply, and soft rollback. The test transaction was rolled
back; no live database write or derived export file was created.
