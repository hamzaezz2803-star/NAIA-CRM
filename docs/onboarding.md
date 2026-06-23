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

Open http://localhost:3000.

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

The app runs without hosted Supabase credentials, but real auth and database work require a Supabase project.

After Ali links the project:

```bash
supabase db push
```

Hosted project ref: `juqhonvapkrlylvseolu`.

Never commit `.env.local` or any service key.
