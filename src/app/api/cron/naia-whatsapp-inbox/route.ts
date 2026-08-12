import { timingSafeEqual } from "node:crypto";

import { processWhatsAppInboundMessage } from "@/platform/naia/whatsapp-inbound";
import { drainWhatsAppInboundQueue } from "@/platform/naia/whatsapp-inbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainWhatsAppInboundQueue({
    maxMessages: 4,
    processMessage: processWhatsAppInboundMessage,
  });

  return Response.json(
    { ok: result.failed === 0, result },
    {
      status: result.failed > 0 ? 503 : 200,
    },
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
