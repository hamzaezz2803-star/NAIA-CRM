# Qarizmi Meeting Intelligence

## Product flow

1. A CRM lead in `meeting-booked` is synchronized into the first-class `meetings` table.
2. Ali or Nabil opens the one-step capture: Calendar/Meet prefills title, date, subject, attendees and linked Drive supports. Qarizmi/client attendees are shown separately. Calendar never starts a recording automatically.
3. The founder confirms informed consent, then uses the discreet two-state control to start, pause and resume. A separate final button ends the capture and queues processing. Live notes autosave to the founder-only meeting row while one-second audio chunks stay in IndexedDB for crash recovery. Uploads go directly to the private Supabase Storage bucket `meeting-recordings`; audio never crosses a Vercel request body.
4. The Mac companion claims the queued job over outbound HTTPS, runs the existing local Whisper engine, then uses Claude CLI under the founders' Claude Max account.
5. The transcript is the source of truth. The pitch deck and CRM history are context only and may never override what was actually said.
6. Notes, transcript, and structured analysis are stored in the cofounders-only `02_Meeting Notes` Drive folder and shown in Qarizmi OS for review.
7. The founder may run a read-only Gmail sync for exact Google Meet/Gemini notification senders. The email summary, linked notes document and recording link are deduplicated by Gmail message id. When the user has reconnected with `drive.readonly`, the exact linked Google Doc is exported as bounded text for private transcript/knowledge search. Ambiguous matches remain unassigned until a founder links them.
8. “Ask NAIA” searches the private reviewed notes, local transcripts and imported Gemini documents deterministically, with visible source excerpts and no paid AI call.
9. No recommendation changes CRM or Google Calendar until Ali or Nabil selects it and validates the reviewed output.

## One-time production setup

Apply these migrations to the production Supabase project, in order:

- `supabase/migrations/20260717090000_meeting_intelligence.sql` creates the private tables, RLS policies, durable job claim, CRM meeting synchronization, and private recording bucket.
- `supabase/migrations/20260809231500_meeting_one_step_capture.sql` adds bounded live notes, informed-consent/capture timestamps, and idempotent private support registration. It adds no broader RLS policy.
- `supabase/migrations/20260810001500_meeting_gemini_artifacts.sql` creates the founder-only, tenant-bound Gmail/Gemini artifact ledger. Authenticated founders receive select/insert/update only; no direct delete grant exists.

Generate a shared secret locally:

```bash
openssl rand -hex 32
```

Add the result to Vercel as `MEETING_NOTES_COMPANION_TOKEN` for Production and Preview, then redeploy. Put the same value in the companion's local `.env` file. Never prefix it with `NEXT_PUBLIC_` and never commit it.

The existing variables remain required for private Drive archival:

- `GOOGLE_SERVICE_ACCOUNT_KEY`
- `MAYA_DRIVE_OUTPUT_FOLDER_ID`
- `SUPABASE_SERVICE_ROLE_KEY`

## Mac companion

From the `qarizmi-meeting-notes` repository:

```bash
uv sync --extra mlx --extra pdf
claude auth status
# If loggedIn is false: run `claude`, then `/login` once.
claude -p "Réponds OK"
uv run meeting-notes-worker
```

Local `.env`:

```dotenv
QARIZMI_OS_URL=https://os.qarizmi.com
MEETING_NOTES_COMPANION_TOKEN=<same secret as Vercel>
MEETING_NOTES_CLAUDE_MODE=cli
MEETING_NOTES_COMPANION_ALLOW_API=false
MEETING_NOTES_WHISPER_BACKEND=mlx
```

The Mac must be awake with Claude CLI authenticated while processing. If it is offline, jobs stay safely queued and the web cockpit says that it is waiting for the companion. There is no inbound port, public tunnel, service-account credential, or Supabase key on the Mac.

The companion refuses an API-backed Claude mode unless both `MEETING_NOTES_CLAUDE_MODE=api` and `MEETING_NOTES_COMPANION_ALLOW_API=true` are set deliberately. If delivery fails after local processing, the result stays on the Mac and the next claim retries only the delivery. Failed analyses and delayed Drive archives can also be retried from the cockpit without uploading the audio again.

## Data boundaries

- Tables, recording objects, transcripts, notes, and outputs are restricted to `ali@qarizmi.com` and `nabil@qarizmi.com` through RLS plus server-side checks.
- Raw audio stays in private Supabase Storage in V1. Every chunk is ordered, size-bounded, and verified with SHA-256 before Whisper reads it. Human-readable outputs are archived in the private cofounder Drive.
- Browser crash recovery stays on the Mac in IndexedDB. A recoverable recording is surfaced to the founder before a new capture and is marked processed only after NAIA acknowledges the queued job. No meeting file is deleted automatically.
- Live notes and the explicit informed-consent timestamp remain on the founder-only `meetings` row. Google Calendar attendees are a prefill aid; Calendar/Meet access does not imply consent and cannot auto-start the microphone.
- Browser reminders require an explicit notification permission and fire 10 minutes before an event only while NAIA is open. They supplement Google Calendar; they are not a guaranteed background daemon.
- Gemini sync uses Gmail GET/list calls only, exact Google sender and subject allowlists, and never changes read state, labels, drafts or sent mail. The optional `drive.readonly` scope is used only for the exact Docs ids linked by those emails. Ali and Nabil must each reconnect Google once for their own linked documents; their Gmail tokens are never shared.
- Imported Gemini content is supporting evidence. A linked Google document may mix summary and transcript; the UI identifies it as a Gemini document and does not silently replace the timestamped local transcript as source of truth.
- An uploaded support is limited to one PDF/TXT/MD file of 25 MB, stored in the same private bucket and hash-checked by the companion. Export PPTX/Keynote slides to text-bearing PDF first.
- Pitch slide text is fetched only while a job is claimed and sent to the local Claude process as context. It is not copied into general CRM rows.
- A selected `crm-note` or `proposal-input` recommendation becomes visible to normal CRM members. The review UI makes that boundary explicit before approval.
- No recommendation is selected automatically. Every effect, proposed CRM status, due date, and transcript evidence is shown before validation. An action without a real matching timestamp and quote in the transcript is rejected. A durable execution record prevents duplicate writes after retries or concurrent clicks.
- Worker endpoints require a timing-safe bearer-token check and only the Vercel server can use the Supabase service role.
