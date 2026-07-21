import { clearSessionCookieHeader } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookieHeader(),
        "Cache-Control": "no-store",
      },
    },
  );
}
