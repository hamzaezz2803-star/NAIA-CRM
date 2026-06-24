# Onboarding

## Prerequisites

- Node.js compatible with Next.js 16
- npm
- Git
- Access to the private GitHub repository once it is created
- Supabase CLI when database work begins

## First Run

```bash
git clone <repository-url>
cd qarizmi-os
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 and sign in with a Supabase Auth user that is
allowed by the local access policy. The production login supports emailed magic
links for approved Qarizmi users.

Production app: https://os.qarizmi.com.

## Quality Checks

Run the same checks as CI:

```bash
npm run ci
```

During development, use:

```bash
npm run lint
npm run typecheck
npm run test
```

## Development Workflow

Create a feature branch for each meaningful change.

```bash
git switch -c <name>/<short-task>
```

Open a pull request into `main` after checks pass.

## Supabase

The app requires hosted Supabase credentials for internal routes. Copy the
public project URL and publishable key into `.env.local`.

After Ali links the project:

```bash
supabase db push
```

Hosted project ref: `juqhonvapkrlylvseolu`.

In production, keep Supabase public email signups disabled and create or invite
users from the Supabase Auth dashboard. Use `AUTH_ALLOWED_EMAILS` when access
should be restricted to an exact list of people.

Current production admins are `ali@qarizmi.com`, `nabil@qarizmi.com`,
`hamza@qarizmi.com`, and `wissal@qarizmi.com`.

Never commit `.env.local` or any service key.
