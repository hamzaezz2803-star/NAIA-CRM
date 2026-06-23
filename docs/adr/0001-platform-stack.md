# ADR 0001: Platform Stack

## Status

Accepted

## Context

Hamza is preparing CRM Sprint 1 with a baseline of Next.js, TypeScript, Supabase, Vercel, and future OpenAI APIs. Qarizmi needs rapid delivery, low operational overhead, and clear module boundaries.

## Decision

Use a modular monolith built with:

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase
- Vercel
- npm
- Vitest
- ESLint and Prettier

## Consequences

This gives the team a simple deployment path and keeps shared concerns in one repository. It also requires discipline around module boundaries because the application is not split into separate services.

CRM business work is isolated under `src/features/crm` and `src/app/(app)/crm`.
