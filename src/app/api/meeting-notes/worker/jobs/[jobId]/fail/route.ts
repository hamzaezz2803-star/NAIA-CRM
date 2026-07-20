import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyMeetingNotesCompanionRequest } from "@/features/meeting-notes/companion-auth";
import {
  markMeetingJobFailed,
  MeetingJobLeaseError,
} from "@/features/meeting-notes/worker-service";

export const runtime = "nodejs";

const failureSchema = z.object({
  error: z.string().trim().min(1).max(4000),
  leaseToken: z.string().uuid(),
  workerId: z.string().trim().min(1).max(120),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!verifyMeetingNotesCompanionRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { jobId } = await context.params;
    const body = failureSchema.parse(await request.json());
    await markMeetingJobFailed(
      jobId,
      body.workerId,
      body.leaseToken,
      body.error,
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to fail job.",
      },
      { status: error instanceof MeetingJobLeaseError ? 409 : 400 },
    );
  }
}
