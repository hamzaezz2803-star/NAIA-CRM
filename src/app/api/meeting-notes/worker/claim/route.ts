import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyMeetingNotesCompanionRequest } from "@/features/meeting-notes/companion-auth";
import { claimNextMeetingJob } from "@/features/meeting-notes/worker-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const claimSchema = z.object({
  workerId: z.string().trim().min(1).max(120),
});

export async function POST(request: Request) {
  if (!verifyMeetingNotesCompanionRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = claimSchema.parse(await request.json());
    const job = await claimNextMeetingJob(body.workerId);
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unable to claim a job.",
      },
      { status: 400 },
    );
  }
}
