import { getAppSession } from "@/platform/auth/session";

export async function GET() {
  try {
    const session = await getAppSession();
    const firstName = session.user.name.split(" ")[0] ?? "Ali";
    return Response.json({ name: firstName });
  } catch {
    return Response.json({ name: "Ali" });
  }
}
