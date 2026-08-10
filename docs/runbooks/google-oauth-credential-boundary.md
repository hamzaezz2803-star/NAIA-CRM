# Google OAuth credential boundary

Migration `20260810012953_google_oauth_credential_boundary.sql` removes every
browser write grant and table-level read grant from
`integration_connections`. Authenticated users can read only their own safe
status, account-label and scope metadata. Credential envelopes and server
review reasons remain service-role only.

## Existing connections

Every Google connection that was `connected` before the migration becomes
`needs-review` with reason `legacy-unattested`. The credential is retained so
NAIA can either prove it safe or perform a proven Google revocation. NAIA must
not call Gmail, Calendar or Drive while the row is quarantined.

Use the one-shot operator after the migration:

```bash
npm run google:oauth-reattest -- dry-run
npm run google:oauth-reattest -- apply --confirm-apply
```

The operator requires server-only Supabase service-role and Google OAuth
variables. It refreshes the credential, asks Google tokeninfo to attest the
exact audience and least-privilege scopes, and verifies the Google account via
the read-only Gmail profile endpoint against the server-side NAIA profile.
Founder-only `drive.meet.readonly` is accepted only for Ali or Nabil while they
still have an owner membership. Output contains aggregate counts only; token,
scope and account values are never printed.

Rows that cannot be proven remain `needs-review`. Reconnect those users through
the ordinary Google connection screen. Ali or Nabil must separately use the
Meeting Intelligence connection intent to grant `drive.meet.readonly`. The
ordinary flow never requests `gmail.send`, broad Calendar/Gmail/Drive scopes,
or grant merging. Every new connection also reads the exact Gmail profile and
requires its normalized email to match the authenticated Supabase user. A
mismatch remains quarantined as `identity-attestation-failed` and is never
reactivated by the one-shot operator; the user must reconnect the correct
Google account.

## Revocation fallback

A manual local neutralization is accepted only after the same connection has a
server-authored `revocation-failed` reason from a failed confirmed revocation
attempt. A legacy quarantine or scope-attestation failure alone is not enough.
The user first removes NAIA in Google Account permissions, then uses the second
explicit manual confirmation in NAIA.
