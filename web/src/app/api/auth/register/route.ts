import { z } from "zod";
import {
  hashPassword,
  sessionCookieHeader,
  signUserSessionToken,
} from "@/lib/auth";
import {
  createUser,
  isUsersTableMissing,
  USERS_TABLE_SQL,
} from "@/lib/db/users-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(80).optional(),
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
      {
        error:
          "Provide a valid email and password (min 8 characters). Display name is optional.",
      },
      { status: 400 },
    );
  }

  try {
    const passwordHash = hashPassword(parsed.data.password);
    const user = await createUser({
      email: parsed.data.email,
      passwordHash,
      displayName:
        parsed.data.displayName?.trim() ||
        parsed.data.email.split("@")[0] ||
        "User",
    });

    const token = signUserSessionToken(user.id);
    return Response.json(
      {
        ok: true,
        user: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
        },
        /** True when public.users is missing — account is in-memory until SQL migration runs */
        ephemeral: isUsersTableMissing(),
        ...(isUsersTableMissing()
          ? {
              warning:
                "Users table missing in Supabase — account stored in server memory for this process only. Run drizzle/0003_users.sql in Supabase SQL Editor for durable accounts.",
              migrationSql: USERS_TABLE_SQL,
            }
          : {}),
      },
      {
        status: 201,
        headers: {
          "Set-Cookie": sessionCookieHeader(token),
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Registration failed";
    const status = message.toLowerCase().includes("already") ? 409 : 400;
    const missingTable =
      /users/i.test(message) &&
      (/PGRST205/i.test(message) || /schema cache|does not exist/i.test(message));
    return Response.json(
      {
        error: missingTable
          ? "Database is missing the users table. Open Supabase → SQL Editor and run migration 0003_users.sql (CREATE TABLE users …), then try again."
          : message,
        ...(missingTable ? { migrationSql: USERS_TABLE_SQL } : {}),
      },
      { status },
    );
  }
}
