import { AlertCircle, ArrowLeft } from "lucide-react";
import Link from "next/link";

import { canUseMeetingNotesEmail } from "@/features/meeting-notes/access-policy";
import { fetchMeetingIntelligenceAction } from "@/features/meeting-notes/actions";
import { MeetingHistory } from "@/features/meeting-notes/meeting-history";
import { getAppSession } from "@/platform/auth/session";

export default async function MeetingHistoryPage() {
  const session = await getAppSession();
  if (!canUseMeetingNotesEmail(session.user.email)) {
    return (
      <main className="flex min-h-dvh items-center justify-center px-6">
        <div className="w-full max-w-md">
          <Link
            className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-stone-500 hover:text-stone-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-600"
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
            <p>Connecte-toi pour accéder aux comptes rendus.</p>
          </div>
        </div>
      </main>
    );
  }

  const state = await fetchMeetingIntelligenceAction();
  return (
    <MeetingHistory
      meetings={state.meetings.filter((meeting) =>
        Boolean(meeting.output || meeting.job),
      )}
    />
  );
}
