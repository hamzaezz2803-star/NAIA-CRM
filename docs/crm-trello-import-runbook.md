# CRM pipeline and one-shot Trello import

## Safety status

The importer is implemented for local dry-runs only until the confidentiality
migration has been reviewed and applied through the normal deployment path.
No live import was run while building this feature.

Hard boundaries:

- never persist the raw Trello export;
- never persist Trello member profiles, emails, actions, cookies, or tokens;
- never download attachments (metadata and sanitized HTTPS URL only);
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
   recruiting, candidate, intern, or trainee vocabulary;
4. an orphaned or unknown reference is always `cofounders`.

Any failed rule produces `cofounders`. Free-text keyword detection is therefore
an additional guard, not the sole protection. Before live apply, founders must
review every `fail-closed:unreviewed-label` result and explicitly approve any
new organization-safe label. Do not weaken the fallback.

## Dry-run, apply, and rollback

1. Run `normalizeTrelloExport` locally and inspect only aggregate counts,
   warnings, duplicate groups, and privacy reasons.
2. Call `stageTrelloImportDryRun` only after the migration is deployed. It
   writes normalized rows to the founder-only ledger; it never writes the raw
   export.
3. Review counts, the three duplicate-title candidates, archived-card handling,
   and every founder-only classification.
4. A founder explicitly calls `applyStagedTrelloImport(runId)`. The database
   function locks the run and applies categories, tags, leads, and tag links in
   one transaction. Identical external references are no-ops; changed hashes
   become conflicts and never overwrite an existing imported record.
5. If needed, a founder calls `rollbackStagedTrelloImport(runId)`. Created rows
   and relationships receive `archived_at`; no row is deleted and the ledger
   remains available for recovery.

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

This validation created no derived export file and made no network or database
write.
