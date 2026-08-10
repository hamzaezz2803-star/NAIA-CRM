# CRM Feature Boundary

Hamza owns CRM business implementation inside this feature area.

Start here for CRM-only domain types, constants, feature services, and UI components. The route entry points live in `src/app/(app)/crm`.

Do not import provider SDKs directly in CRM code. Use platform integration contracts and workflow approval primitives so external actions remain human-reviewed.

The pipeline read model lives in `pipeline-data.ts`: one server-rendered
snapshot for blocking data, then one lazy auxiliary read. Read models must stay
side-effect-free.

The one-shot Trello migration contract is documented in
`docs/crm-trello-import-runbook.md`. Raw exports and provider credentials must
never enter the repository or the database.
