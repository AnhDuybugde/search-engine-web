import { z } from "zod";
import {
  sessionCookieHeader,
  signUserSessionToken,
  verifyPassword,
} from "@/lib/auth";
import { findUserByEmail } from "@/lib/db/users-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(500),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return Response.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  try {
    const user = await findUserByEmail(parsed.data.email);
    if (!user || !verifyPassword(parsed.data.password, user.passwordHash)) {
      return Response.json(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const token = signUserSessionToken(user.id);
    return Response.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
      },
      {
        status: 200,
        headers: {
          "Set-Cookie": sessionCookieHeader(token),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    return Response.json(
      {
        error:
          err instanceof Error ? err.message : "Login failed",
      },
      { status: 500 },
    );
  }
}
