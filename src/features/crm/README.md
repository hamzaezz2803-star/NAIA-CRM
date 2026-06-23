# CRM Feature Boundary

Hamza owns CRM business implementation inside this feature area.

Start here for CRM-only domain types, constants, feature services, and UI components. The route entry points live in `src/app/(app)/crm`.

Do not import provider SDKs directly in CRM code. Use platform integration contracts and workflow approval primitives so external actions remain human-reviewed.
