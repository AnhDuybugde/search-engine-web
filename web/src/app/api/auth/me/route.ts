import {
  getSessionClaimsFromRequest,
  requireAppAuth,
} from "@/lib/auth";
import { findUserById } from "@/lib/db/users-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;

  const claims = getSessionClaimsFromRequest(req);
  if (!claims || claims.userId === "legacy") {
    return Response.json({
      user: null,
      mode: claims?.userId === "legacy" ? "legacy" : "anonymous",
    });
  }

  try {
    const user = await findUserById(claims.userId);
    if (!user) {
      return Response.json({ user: null, mode: "stale" });
    }
    return Response.json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      mode: "user",
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to load user" },
      { status: 500 },
    );
  }
}
