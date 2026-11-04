import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { canUseMeetingNotesEmail } from "@/features/meeting-notes/access-policy";
import { fetchMeetingIntelligenceAction } from "@/features/meeting-notes/actions";
import { getMeetingDayBounds } from "@/features/meeting-notes/calendar-day";
import type { MeetingIntelligenceState } from "@/features/meeting-notes/contracts";
import { MeetingIntelligenceWorkspace } from "@/features/meeting-notes/meeting-intelligence-workspace";
import { getAppSession } from "@/platform/auth/session";
import {
  listGoogleCalendarEvents,
  type GoogleCalendarEventSummary,
} from "@/platform/integrations/google-workspace";

async function fetchTodayGoogleCalendarEvents(): Promise<{
  events: GoogleCalendarEventSummary[];
  unavailable: boolean;
}> {
  try {
    const { timeMax, timeMin } = getMeetingDayBounds();
    return {
      events: await listGoogleCalendarEvents({
        maxResults: 50,
        timeMax,
        timeMin,
      }),
      unavailable: false,
    };
  } catch {
    // A missing or temporarily unavailable Google connection must not block a
    // manual meeting, but it must remain distinguishable from an empty day.
    return { events: [], unavailable: true };
  }
}

async function fetchFounderMeetingIntelligence(): Promise<MeetingIntelligenceState> {
  try {
    return await fetchMeetingIntelligenceAction();
  } catch (error) {
    return {
      configured: false,
      error:
        error instanceof Error
          ? error.message
          : "L'intelligence meeting est momentanément indisponible.",
      meetings: [],
    };
  }
}

export default async function MeetingsPage() {
  const session = await getAppSession();
  if (!canUseMeetingNotesEmail(session.user.email)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-md">
          <Link
            className="mb-4 inline-flex items-center gap-2 text-sm text-stone-500 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
            href="/dashboard"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Retour
          </Link>
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertCircle
              className="mt-0.5 h-5 w-5 shrink-0"
              aria-hidden="true"
            />
            <p>Connecte-toi pour accéder aux notes de meeting.</p>
          </div>
        </div>
      </main>
    );
  }

  const [calendar, meetingIntelligence] = await Promise.all([
    fetchTodayGoogleCalendarEvents(),
    fetchFounderMeetingIntelligence(),
  ]);

  return (
    <MeetingIntelligenceWorkspace
      calendarEvents={calendar.events}
      calendarUnavailable={calendar.unavailable}
      initialState={meetingIntelligence}
      variant="focus"
    />
  );
}
