import { timingSafeEqual } from "node:crypto";

import { runConfiguredDailyBriefs } from "@/features/naia/daily-brief";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = await runConfiguredDailyBriefs();
  const summary = {
    failed: results.filter((result) => result.status === "failed").length,
    sent: results.filter((result) => result.status === "sent").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };

  return Response.json(
    { ok: summary.failed === 0, summary },
    { status: summary.failed > 0 ? 503 : 200 },
  );
}

function isAuthorizedCronRequest(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : "";

  if (!authorization || !expected) return false;

  const actualBuffer = Buffer.from(authorization);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}
