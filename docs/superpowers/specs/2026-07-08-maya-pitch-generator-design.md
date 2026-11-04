# Maya Pitch Generator Design

Date: 2026-07-08

## Goal

Maya generates high-quality first-draft Qarizmi pitch decks as `.pptx` files for leads that move to `meeting-booked`. The output must live in the private Qarizmi Drive tree used by Ali and Nabil, and must fit the real workflow: Nabil downloads the Maya draft, edits it locally with his PowerPoint/Claude setup, then uploads the final version.

The system should learn from that final version so future drafts move closer to Nabil's preferred structure, wording, slide selection, and diagnostic logic.

## Confirmed Decisions

- Authorized human access: `ali@qarizmi.com` and `nabil@qarizmi.com`.
- Final deck naming convention: `202607XX_Qarizmi....._vF.pptx`.
- The generic deck remains the source of truth and is updated in place in the Pitch generator folder.
- Maya creates a folder per client under the private `Client development/Pitch` root, then a `Pitch` subfolder, stores the draft there, and watches for Nabil's final version.
- V1 output format is PPTX-first for best compatibility with the current Nabil workflow.

## Source Material

Current source library folder:

`/Users/ali/Library/CloudStorage/GoogleDrive-ali@qarizmi.com/Drive partagés/Qarizmi/Client development/Pitch/Pitch generator`

Drive folder:

Configured server-side through `MAYA_DRIVE_SOURCE_FOLDER_ID` (the real id is not stored in the repository).

Generated client folders should be created under the existing private `Client development/Pitch` root configured by `GOOGLE_DRIVE_CLIENT_FOLDER_PARENT_ID`, not inside the source library folder.

Source decks:

- `Qarizmi_Introduction_Service as a software_Generic.pptx`
- `20260609_Qarizmi_Introduction_Service as a software_Econosol.pptx`
- `20260611_Qarizmi_Introduction_Service as a software_ODM.pptx`
- `20260701_Qarizmi_Introduction_Service as a software_SPE portfolio.pptx`
- `20260706_Qarizmi_Introduction_Service as a software_Permis a point.pptx`
- `20260707_Qarizmi_Introduction_Service as a software_AKWA.pptx`

Observed source pattern:

- Part 1: Presentation Qarizmi. Reuse latest generic slides.
- Part 2: Offre Qarizmi. Reuse latest generic slides.
- Part 3: Credentials. Select only relevant credential slides from the generic deck.
- Part 4: Preliminary Diagnostic. Generate client-specific value chain, use cases, prioritization, roadmap, and appendix when useful.

## User Experience

On the Docs Generator page, Maya shows a queue of leads in `meeting-booked`.

For each lead, Maya shows:

- client and contact,
- CRM notes and meeting date,
- website link,
- inferred company type: single company, group, holding, PE/portfolio,
- missing information questions,
- draft status: not started, needs brief, generating, ready for Nabil, final uploaded, learned.

The user can generate a pitch only after confirming the brief. The generated deck link is attached to the CRM lead.

NAIA voice should be able to route a command such as:

> Maya, prépare le pitch pour HPS avec les notes CRM.

Maya should respond with a draft action, not create or share a file without validation.

## Core Workflow

1. Lead reaches `meeting-booked`.
2. Maya creates or updates a pitch brief from CRM data.
3. Maya asks smart follow-up questions if required fields are missing.
4. Maya indexes the latest generic deck and relevant historical decks.
5. Maya builds a deck plan:
   - keep Parts 1 and 2 from the latest generic,
   - select Part 3 credentials,
   - draft Part 4 diagnostics.
6. Maya creates a client folder and `Pitch` subfolder in the private Drive tree.
7. Maya writes the draft `.pptx` to the client `Pitch` folder.
8. Maya stores draft metadata and attaches the deck link to the CRM lead.
9. Nabil downloads, edits, and uploads the final `*_vF.pptx`.
10. Maya detects the final version, compares draft vs final, and stores learning signals.

## Data Model

Add tables scoped by `organization_id`.

`pitch_library_decks`

- id
- organization_id
- drive_file_id
- file_name
- file_version
- kind: `generic`, `example`, `maya_draft`, `nabil_final`
- client_name
- client_type
- industry_tags
- created_by
- created_at
- indexed_at

`pitch_library_slides`

- id
- organization_id
- deck_id
- slide_number
- section: `presentation`, `offre`, `credentials`, `diagnostic`, `appendix`, `unknown`
- title
- extracted_text
- tags
- source_hash

`pitch_briefs`

- id
- organization_id
- lead_id
- client_name
- website_url
- contact_name
- contact_role
- client_type
- industry
- crm_context
- meeting_objective
- missing_questions
- status
- created_at
- updated_at

`pitch_generation_runs`

- id
- organization_id
- lead_id
- brief_id
- generic_deck_id
- draft_drive_file_id
- draft_file_name
- final_drive_file_id
- final_file_name
- status
- model_used
- generation_notes
- created_at
- updated_at

`pitch_learning_events`

- id
- organization_id
- run_id
- event_type: `slide_removed`, `slide_added`, `slide_reordered`, `copy_changed`, `use_case_changed`, `credential_selection_changed`
- summary
- before_excerpt
- after_excerpt
- weight
- created_at

## Security

Pitch IP is cofounder-only.

App-level requirements:

- Only Ali and `nabil@qarizmi.com` can open Maya pitch library, generate pitch drafts, or view generated pitch links.
- Stagiaires can still use CRM modules they are allowed to access, but they must not see pitch source decks, generated draft links, final decks, or extracted slide content.
- Pitch routes and server actions must enforce authorization server-side, not only hide UI.
- Provider secrets stay server-only.
- Do not log raw deck text, prompts containing confidential deck content, or generated deck URLs in public logs.

Google Drive access options:

- Preferred for production: a server-side Maya Google service account shared only with the private Pitch root folders. This avoids depending on a human user's OAuth session. It introduces a non-human technical principal that must be explicitly shared on the folder.
- Fallback: Ali OAuth with expanded Drive read access. Current `drive.file` scope may not be enough to read existing non-app-created decks in the source folder.

## PPTX Generation Strategy

V1 should avoid rebuilding the whole visual system from scratch.

Recommended approach:

- Treat the generic deck as the visual source.
- Use PPTX package manipulation to copy/reorder/delete slides from the generic deck where possible.
- Generate Part 4 using inherited layouts from existing diagnostic slides.
- Produce a normal `.pptx` for Nabil to edit.
- Use LibreOffice or Google Drive preview as the QA/rendering path for generated output.

V1 does not need pixel-perfect autonomous final decks. Success is a draft that is roughly 80% useful and easy for Nabil to finish.

## Learning Loop

Maya should learn from Nabil's final decks by comparing a Maya draft to a matching `*_vF.pptx`.

Signals to store:

- which generic credentials were removed or kept,
- which Part 4 slides were rewritten heavily,
- which use cases survived,
- which use cases were removed,
- new use cases added by Nabil,
- recurring wording changes,
- section ordering changes,
- client-type differences between single company, group, and PE/portfolio decks.

Learning should be retrieval-based at first. Maya should not fine-tune a model in V1. It should retrieve the most relevant learning events and examples before generating the next deck.

## LLM Requirements

Groq can support demos and fast classification. For deck quality, Maya should support a higher-quality model provider through a server-only key or Vercel AI Gateway.

Generation should use structured outputs:

- brief JSON,
- credential selection JSON,
- deck plan JSON,
- slide content JSON,
- learning event JSON.

The UI should show which model produced a draft.

## Acceptance Criteria

- A lead in `meeting-booked` appears in Maya's pitch queue.
- Ali can create a pitch brief and answer missing questions.
- Maya identifies the latest generic deck from the source folder.
- Maya selects relevant credentials based on client profile.
- Maya creates a client folder and `Pitch` subfolder in the private Drive tree.
- Maya generates a PPTX draft in that folder.
- The draft link is attached to the CRM lead.
- Stagiaires cannot access the pitch generation page, deck links, source content, or server actions.
- A `*_vF.pptx` uploaded by Nabil can be matched to the draft.
- Maya records at least basic learning events from draft vs final comparison.
- Local CI passes.

## Implementation Phases

Phase 1: Secure library and brief foundation

- Add database schema.
- Add cofounder-only authorization helper.
- Add Drive folder config.
- Add deck indexing for local/Drive PPTX files.
- Add Maya pitch queue UI.

Phase 2: Draft generation

- Add brief generation and missing-question UI.
- Add generic-deck version detection.
- Add credential selection.
- Add PPTX draft generation.
- Upload draft to client `Pitch` folder.
- Attach draft link to CRM lead.

Phase 3: Learning loop

- Detect or manually register Nabil final files.
- Compare draft/final slide structure and text.
- Store learning events.
- Retrieve learning events in future generations.

Phase 4: Quality hardening

- Render generated decks for QA.
- Add tests for authorization and route actions.
- Add admin status screen for Drive/model readiness.
- Optional: import PPTX into native Google Slides after draft generation.

## Implementation Assumptions

- Ali's production account is `ali@qarizmi.com`.
- V1 should support service-account Drive access first, with Ali OAuth as fallback only if service-account sharing is blocked.
- Source decks stay in the `Pitch generator` folder; generated client folders go under the private `Client development/Pitch` root.
