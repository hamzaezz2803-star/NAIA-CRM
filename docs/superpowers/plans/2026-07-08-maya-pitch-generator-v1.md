# Maya Pitch Generator V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a cofounder-only Maya pitch generator that indexes Qarizmi PPTX decks, prepares pitch briefs for `meeting-booked` CRM leads, creates PPTX drafts in the private Drive workflow, and records Nabil final-version learning signals.

**Architecture:** Add a focused `src/features/maya` module for contracts, authorization, PPTX indexing, deck planning, draft generation, and learning comparison. Keep Docs Generator UI thin and route all writes through server actions/API handlers with server-side cofounder authorization. V1 supports local synced Drive folders for development and a Drive-service abstraction ready for production service-account/OAuth upload.

**Tech Stack:** Next.js App Router, Supabase server actions/RLS, Vitest, PPTX OpenXML package parsing, local filesystem development adapter, Google Drive API adapter, Groq/LLM-compatible structured planning hooks.

---

## File Structure

- Create `supabase/migrations/20260708090000_maya_pitch_generator.sql`: pitch tables, RLS, helper function for cofounder-only access.
- Create `src/features/maya/contracts.ts`: shared types, constants, status enums.
- Create `src/features/maya/access.ts`: server-only cofounder authorization helpers.
- Create `src/features/maya/pptx/indexer.ts`: PPTX text extraction and section classification.
- Create `src/features/maya/pptx/indexer.test.ts`: tests against the local sample decks.
- Create `src/features/maya/planning.ts`: brief defaults, client-type inference, credential selection, draft plan.
- Create `src/features/maya/planning.test.ts`: deterministic plan tests.
- Create `src/features/maya/storage.ts`: local/Drive storage abstraction and folder naming.
- Create `src/features/maya/storage.test.ts`: folder/file naming and local draft path tests.
- Create `src/features/maya/generator.ts`: create V1 PPTX draft by filtering the latest generic deck, appending diagnostic slides, and writing a generation manifest.
- Create `src/features/maya/generator.test.ts`: generates a real PPTX file in a temp folder.
- Create `src/features/maya/learning.ts`: compare draft/final extracted slide text and summarize changes.
- Create `src/features/maya/learning.test.ts`: detects added/removed/changed slides.
- Create `src/features/maya/actions.ts`: server actions for queue, brief save, draft generation, final registration.
- Modify `src/app/(app)/proposals/page.tsx`: replace placeholder Docs Generator with Maya queue UI.
- Modify `src/features/naia/orchestrator.ts`: add Maya pitch action for pitch commands and meeting-booked leads.
- Modify `src/app/api/naia/orchestrate/route.ts`: sign/execute Maya action with validation.
- Update `docs/architecture.md` and `docs/crm-handoff.md`: document Maya V1, security, and Drive constraints.

## Task 1: Database And Access Contract

**Files:**

- Create: `supabase/migrations/20260708090000_maya_pitch_generator.sql`
- Create: `src/features/maya/contracts.ts`
- Create: `src/features/maya/access.ts`
- Test: `src/features/maya/access.test.ts`

- [ ] **Step 1: Write failing access tests**

```ts
import { describe, expect, it } from "vitest";
import { PITCH_COFUNDER_EMAILS, canUsePitchGeneratorEmail } from "./access";

describe("pitch generator access", () => {
  it("allows only Ali and Nabil by email", () => {
    expect(canUsePitchGeneratorEmail("ali@qarizmi.com")).toBe(true);
    expect(canUsePitchGeneratorEmail("nabil@qarizmi.com")).toBe(true);
    expect(canUsePitchGeneratorEmail("hamza@qarizmi.com")).toBe(false);
    expect(canUsePitchGeneratorEmail("wissal@qarizmi.com")).toBe(false);
  });

  it("normalizes email case and spacing", () => {
    expect(canUsePitchGeneratorEmail(" NABIL@QARIZMI.COM ")).toBe(true);
  });

  it("keeps the allowlist explicit", () => {
    expect(PITCH_COFUNDER_EMAILS).toEqual([
      "ali@qarizmi.com",
      "nabil@qarizmi.com",
    ]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/features/maya/access.test.ts`

Expected: fails because `src/features/maya/access.ts` does not exist.

- [ ] **Step 3: Implement contracts and access helpers**

Create `src/features/maya/contracts.ts` with exported enums for deck kinds, slide sections, brief status, generation status, learning event types, and the default local source folder path.

Create `src/features/maya/access.ts` with:

```ts
import "server-only";

import { getCurrentSupabaseUser } from "@/platform/auth/supabase-server";

export const PITCH_COFUNDER_EMAILS = [
  "ali@qarizmi.com",
  "nabil@qarizmi.com",
] as const;

export function canUsePitchGeneratorEmail(email?: string | null) {
  if (!email) return false;
  const normalized = email.trim().toLocaleLowerCase("fr-FR");
  return (PITCH_COFUNDER_EMAILS as readonly string[]).includes(normalized);
}

export async function requirePitchGeneratorAccess() {
  const user = await getCurrentSupabaseUser();
  if (!canUsePitchGeneratorEmail(user?.email)) {
    throw new Error("Pitch generator access is restricted to Ali and Nabil.");
  }
  return user;
}
```

- [ ] **Step 4: Add migration**

Create tables from the design spec, all scoped by `organization_id`, with RLS select/insert/update policies requiring a new function `public.is_pitch_cofounder(target_organization_id uuid)` based on current authenticated profile email in `profiles`.

- [ ] **Step 5: Verify**

Run: `npm run test -- src/features/maya/access.test.ts`

Expected: passing.

## Task 2: PPTX Library Indexing

**Files:**

- Create: `src/features/maya/pptx/indexer.ts`
- Create: `src/features/maya/pptx/indexer.test.ts`

- [ ] **Step 1: Write failing indexer tests**

Test against the synced Pitch generator folder. Expected behavior:

- finds 6 `.pptx` decks,
- identifies `Qarizmi_Introduction_Service as a software_Generic.pptx` as generic,
- extracts 44 slides from the generic deck,
- classifies generic slides 1-9 as presentation/offre intro material, 16-43 as credentials, 44 as closing,
- extracts at least one AKWA diagnostic slide.

- [ ] **Step 2: Run failing test**

Run: `npm run test -- src/features/maya/pptx/indexer.test.ts`

Expected: fails because indexer does not exist.

- [ ] **Step 3: Implement PPTX extraction**

Implement OpenXML parsing with Node built-ins and a small ZIP dependency if needed. If no ZIP dependency exists, add a lightweight package such as `yauzl` or `fflate` only after checking package size and compatibility.

Functions:

- `listPitchDeckFiles(folderPath: string): Promise<PitchDeckFile[]>`
- `extractPptxSlides(filePath: string): Promise<PitchExtractedSlide[]>`
- `classifySlideSection(slide: PitchExtractedSlide): PitchSlideSection`
- `indexPitchDeck(filePath: string): Promise<PitchIndexedDeck>`
- `findLatestGenericDeck(decks: PitchDeckFile[]): PitchDeckFile | null`

- [ ] **Step 4: Verify**

Run: `npm run test -- src/features/maya/pptx/indexer.test.ts`

Expected: passing.

## Task 3: Brief And Deck Planning

**Files:**

- Create: `src/features/maya/planning.ts`
- Create: `src/features/maya/planning.test.ts`

- [ ] **Step 1: Write failing planning tests**

Tests cover:

- HPS/Mistral-style notes infer `single-company`.
- SPE-style portfolio notes infer `portfolio`.
- missing website produces a smart question.
- credential selection prefers Healthcare for ODM, Industrials/Energy/Retail for AKWA, Financial Services for SPE.
- draft plan always keeps presentation and offer sections from latest generic.

- [ ] **Step 2: Implement deterministic planning**

Implement:

- `buildPitchBriefFromLead(lead)`
- `inferClientType(input)`
- `buildMissingPitchQuestions(brief)`
- `selectCredentialSlides({ brief, genericDeck, examples })`
- `buildPitchDeckPlan({ brief, genericDeck, examples, learningEvents })`

V1 uses deterministic rules first; LLM hooks are optional and can be added behind `generatePitchDeckPlanWithModel` later.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/features/maya/planning.test.ts`

Expected: passing.

## Task 4: Draft Storage And Folder Naming

**Files:**

- Create: `src/features/maya/storage.ts`
- Create: `src/features/maya/storage.test.ts`

- [ ] **Step 1: Write failing storage tests**

Tests cover:

- client folder safe names such as `HPS` and `AKWA Group`,
- draft filename convention `YYYYMMDD_Qarizmi_Introduction_Service as a software_<Client>_vDraft.pptx`,
- final filename detection `*_vF.pptx`,
- local adapter creates `<client>/Pitch` and writes files.

- [ ] **Step 2: Implement storage**

Implement:

- `sanitizePitchClientName(name: string)`
- `buildPitchDraftFileName({ date, clientName })`
- `isNabilFinalPitchFileName(fileName: string)`
- `createLocalPitchStorageAdapter(rootPath: string)`
- interface `PitchStorageAdapter` for future Google Drive adapter.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/features/maya/storage.test.ts`

Expected: passing.

## Task 5: PPTX Draft Generation

**Files:**

- Create: `src/features/maya/generator.ts`
- Create: `src/features/maya/generator.test.ts`

- [ ] **Step 1: Write failing generator test**

Use a temp output root and the real generic deck. Generate a draft for `HPS`, assert:

- file exists,
- file extension is `.pptx`,
- file is larger than 1 MB,
- a `maya-generation-manifest.json` is written next to it,
- manifest includes selected credential slide numbers and diagnostic outline,
- generated PPTX has fewer slides than the generic deck,
- generated PPTX contains editable preliminary diagnostic/use-case text.

- [ ] **Step 2: Implement reliable generation**

V1 starts from the latest generic deck, removes credential slides not selected by the plan, appends editable preliminary diagnostic/use-case slides, and writes a manifest with the exact deck plan. This keeps Qarizmi's branded core slides intact while making the output materially client-specific.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/features/maya/generator.test.ts`

Expected: passing.

## Task 6: Learning Loop

**Files:**

- Create: `src/features/maya/learning.ts`
- Create: `src/features/maya/learning.test.ts`

- [ ] **Step 1: Write failing learning tests**

Use extracted slide arrays from two known decks and assert:

- removed slides are detected,
- added client-specific slides are detected,
- heavily changed slide text is detected,
- summary is safe and does not include huge raw deck text.

- [ ] **Step 2: Implement comparison**

Implement:

- `comparePitchDecks({ draft, final })`
- `summarizePitchLearningEvents(events)`

Use slide text hashes and similarity scoring; keep excerpts under 500 characters.

- [ ] **Step 3: Verify**

Run: `npm run test -- src/features/maya/learning.test.ts`

Expected: passing.

## Task 7: Server Actions And Docs Generator UI

**Files:**

- Create: `src/features/maya/actions.ts`
- Modify: `src/app/(app)/proposals/page.tsx`
- Optional create: `src/features/maya/pitch-generator-dashboard.tsx`

- [ ] **Step 1: Write server-action tests where practical**

Add tests for pure helpers and use local adapter tests for generation. Avoid brittle server-action tests if the repo has no server-action harness.

- [ ] **Step 2: Implement server actions**

Implement:

- `fetchPitchQueueAction()`
- `preparePitchBriefAction(leadId)`
- `generatePitchDraftAction(leadId, briefInput)`
- `registerNabilFinalPitchAction(runId, finalFileName)`

Every action calls `requirePitchGeneratorAccess()` first.

- [ ] **Step 3: Replace placeholder UI**

Docs Generator page shows:

- cofounder-only restricted state for non-authorized users,
- queue of meeting-booked leads,
- brief form/questions,
- generate draft button,
- draft/final status cards,
- source library status.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck`

Expected: passing.

## Task 8: NAIA Orchestration

**Files:**

- Modify: `src/features/naia/orchestrator.ts`
- Modify: `src/app/api/naia/orchestrate/route.ts`
- Modify tests: `src/features/naia/orchestrator.test.ts`, `src/app/api/naia/orchestrate/route.test.ts`

- [ ] **Step 1: Write failing NAIA tests**

Tests cover:

- command `Maya prépare le pitch pour HPS` creates a pitch-generation draft action,
- action is approval-required,
- execution requires signed approval token,
- execution calls pitch action only after validation.

- [ ] **Step 2: Implement action type**

Add `pitch.generateDraft` to `NaiaActionDraft` and route to Maya.

- [ ] **Step 3: Implement route execution**

Execute by calling `generatePitchDraftAction` with the lead/brief payload.

- [ ] **Step 4: Verify**

Run: `npm run test -- src/features/naia/orchestrator.test.ts src/app/api/naia/orchestrate/route.test.ts`

Expected: passing.

## Task 9: Documentation And Full CI

**Files:**

- Modify: `docs/architecture.md`
- Modify: `docs/crm-handoff.md`

- [ ] **Step 1: Update docs**

Document:

- cofounder-only pitch IP,
- local synced folder vs production Drive access,
- service account recommendation,
- V1 slide filtering, diagnostic slide insertion, and manifest behavior,
- Nabil final learning loop.

- [ ] **Step 2: Run full verification**

Run: `npm run ci`

Expected: format, lint, typecheck, tests, and build pass.

- [ ] **Step 3: Commit and push**

Commit all changes and push `ali/maya-pitch-generator-v1`.
