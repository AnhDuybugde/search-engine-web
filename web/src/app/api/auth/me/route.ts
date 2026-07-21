import {
  getSessionClaimsFromRequest,
  requireAppAuth,
} from "@/lib/auth";
import { findUserById } from "@/lib/db/users-repo";
import { updateUserDisplayName } from "@/lib/db/users-repo";
import { z } from "zod";

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

const patchSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
});

export async function PATCH(req: Request) {
  const denied = requireAppAuth(req);
  if (denied) return denied;
  const claims = getSessionClaimsFromRequest(req);
  if (!claims || claims.userId === "legacy") {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Display name must be 1–80 characters." }, { status: 400 });
  }

  try {
    const user = await updateUserDisplayName(claims.userId, parsed.data.displayName);
    if (!user) return Response.json({ error: "User not found" }, { status: 404 });
    return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to update profile" },
      { status: 500 },
    );
  }
}
