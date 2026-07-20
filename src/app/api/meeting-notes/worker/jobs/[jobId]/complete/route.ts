import { NextResponse } from "next/server";

import { verifyMeetingNotesCompanionRequest } from "@/features/meeting-notes/companion-auth";
import {
  completeMeetingJob,
  MeetingJobLeaseError,
} from "@/features/meeting-notes/worker-service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!verifyMeetingNotesCompanionRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobId } = await context.params;
    const result = await completeMeetingJob(jobId, await request.json());
    return NextResponse.json({ result, success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to complete job.",
      },
      { status: error instanceof MeetingJobLeaseError ? 409 : 400 },
    );
  }
}
