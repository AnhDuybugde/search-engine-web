import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getConfig } from "@/lib/config";
import { getDb } from "./client";
import { users } from "./schema";
import { getSupabaseAdmin, sbError, toIso } from "./supabase";
import { memUsers, type MemUser } from "./memory";

export type PublicUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type UserRecord = PublicUser & {
  passwordHash: string;
};

export const USERS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);`;

let ensuredSql = false;
let sqlUsersAvailable: boolean | null = null;
let supabaseUsersAvailable: boolean | null = null;

export function isUsersTableMissing(): boolean {
  return sqlUsersAvailable === false && supabaseUsersAvailable === false;
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function toPublic(u: UserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    createdAt: u.createdAt,
  };
}

function isMissingUsersTableError(error: unknown): boolean {
  const text =
    typeof error === "string"
      ? error
      : error instanceof Error
        ? error.message
        : error && typeof error === "object"
          ? JSON.stringify(error)
          : String(error);
  return (
    /PGRST205/i.test(text) ||
    (/users/i.test(text) &&
      (/schema cache/i.test(text) ||
        /does not exist/i.test(text) ||
        /Could not find the table/i.test(text) ||
        /relation .*users.* does not exist/i.test(text)))
  );
}

function memFindByEmail(normalized: string): UserRecord | null {
  for (const u of memUsers.values()) {
    if (u.email === normalized) {
      return {
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        passwordHash: u.passwordHash,
        createdAt: u.createdAt,
      };
    }
  }
  return null;
}

function memFindById(id: string): UserRecord | null {
  const u = memUsers.get(id);
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    passwordHash: u.passwordHash,
    createdAt: u.createdAt,
  };
}

function memCreate(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): PublicUser {
  if (memFindByEmail(input.email)) {
    throw new Error("Email already registered");
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const row: MemUser = {
    id,
    email: input.email,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    createdAt: now,
    updatedAt: now,
  };
  memUsers.set(id, row);
  return toPublic({
    id,
    email: input.email,
    displayName: input.displayName,
    passwordHash: input.passwordHash,
    createdAt: now,
  });
}

/** Ensure users table exists on DATABASE_URL Postgres (local Docker etc.). */
export async function ensureUsersTable(): Promise<boolean> {
  const cfg = getConfig();
  if (!cfg.DATABASE_URL) {
    sqlUsersAvailable = false;
    return false;
  }
  if (ensuredSql && sqlUsersAvailable) return true;

  try {
    const db = getDb();
    // drizzle doesn't expose raw easily — use postgres client underneath via execute
    await db.execute(
      // drizzle sql template
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import("drizzle-orm")).sql.raw(USERS_TABLE_SQL) as any,
    );
    ensuredSql = true;
    sqlUsersAvailable = true;
    console.info("[users] ensured public.users on DATABASE_URL");
    return true;
  } catch {
    // Fallback: open raw postgres for multi-statement DDL
    try {
      const postgres = (await import("postgres")).default;
      const local =
        /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(cfg.DATABASE_URL) ||
        process.env.DB_SSL === "disable";
      const sql = postgres(cfg.DATABASE_URL, {
        prepare: false,
        max: 1,
        connect_timeout: 10,
        ssl: local ? false : "require",
      });
      try {
        await sql.unsafe(USERS_TABLE_SQL);
        ensuredSql = true;
        sqlUsersAvailable = true;
        console.info("[users] created public.users via raw postgres");
        return true;
      } finally {
        await sql.end({ timeout: 1 });
      }
    } catch (err2) {
      sqlUsersAvailable = false;
      console.warn(
        "[users] could not ensure SQL users table:",
        err2 instanceof Error ? err2.message : err2,
      );
      return false;
    }
  }
}

async function sqlFindByEmail(normalized: string): Promise<UserRecord | null> {
  if (sqlUsersAvailable === false) return null;
  if (!(await ensureUsersTable())) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    createdAt: toIso(row.createdAt),
  };
}

async function sqlFindById(id: string): Promise<UserRecord | null> {
  if (sqlUsersAvailable === false) return null;
  if (!(await ensureUsersTable())) return null;
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    passwordHash: row.passwordHash,
    createdAt: toIso(row.createdAt),
  };
}

async function sqlCreate(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<PublicUser | null> {
  if (!(await ensureUsersTable())) return null;
  const id = randomUUID();
  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(users).values({
    id,
    email: input.email,
    passwordHash: input.passwordHash,
    displayName: input.displayName,
    createdAt: new Date(now),
    updatedAt: new Date(now),
  });
  return { id, email: input.email, displayName: input.displayName, createdAt: now };
}

async function sbFindByEmail(normalized: string): Promise<UserRecord | null> {
  if (supabaseUsersAvailable === false) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("users")
    .select("id,email,password_hash,display_name,created_at")
    .eq("email", normalized)
    .maybeSingle();
  if (error) {
    if (isMissingUsersTableError(error) || isMissingUsersTableError(sbError(error))) {
      supabaseUsersAvailable = false;
      return null;
    }
    throw new Error(`Find user failed: ${sbError(error)}`);
  }
  supabaseUsersAvailable = true;
  if (!data) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    displayName: data.display_name as string,
    passwordHash: data.password_hash as string,
    createdAt: toIso(data.created_at),
  };
}

async function sbFindById(id: string): Promise<UserRecord | null> {
  if (supabaseUsersAvailable === false) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const { data, error } = await sb
    .from("users")
    .select("id,email,password_hash,display_name,created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (isMissingUsersTableError(error) || isMissingUsersTableError(sbError(error))) {
      supabaseUsersAvailable = false;
      return null;
    }
    throw new Error(`Find user failed: ${sbError(error)}`);
  }
  supabaseUsersAvailable = true;
  if (!data) return null;
  return {
    id: data.id as string,
    email: data.email as string,
    displayName: data.display_name as string,
    passwordHash: data.password_hash as string,
    createdAt: toIso(data.created_at),
  };
}

async function sbCreate(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<PublicUser | null> {
  if (supabaseUsersAvailable === false) return null;
  const sb = getSupabaseAdmin();
  if (!sb) return null;
  const id = randomUUID();
  const now = new Date().toISOString();
  const { error } = await sb.from("users").insert({
    id,
    email: input.email,
    password_hash: input.passwordHash,
    display_name: input.displayName,
    created_at: now,
    updated_at: now,
  });
  if (error) {
    const msg = sbError(error);
    if (isMissingUsersTableError(error) || isMissingUsersTableError(msg)) {
      supabaseUsersAvailable = false;
      return null;
    }
    if (msg.toLowerCase().includes("duplicate") || msg.includes("23505")) {
      throw new Error("Email already registered");
    }
    throw new Error(`Create user failed: ${msg}`);
  }
  supabaseUsersAvailable = true;
  return {
    id,
    email: input.email,
    displayName: input.displayName,
    createdAt: now,
  };
}

export async function findUserByEmail(
  email: string,
): Promise<UserRecord | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  // 1) Local/SQL DATABASE_URL (we can auto-create table here)
  try {
    const viaSql = await sqlFindByEmail(normalized);
    if (viaSql) return viaSql;
    // table exists but no row — still SQL backend
    if (sqlUsersAvailable) return null;
  } catch (err) {
    if (!isMissingUsersTableError(err)) {
      console.warn("[users] SQL findByEmail:", err);
    }
    sqlUsersAvailable = false;
  }

  // 2) Supabase REST
  try {
    const viaSb = await sbFindByEmail(normalized);
    if (viaSb) return viaSb;
    if (supabaseUsersAvailable) return null;
  } catch (err) {
    console.warn("[users] Supabase findByEmail:", err);
  }

  // 3) Memory
  return memFindByEmail(normalized);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  if (!id) return null;

  try {
    const viaSql = await sqlFindById(id);
    if (viaSql) return viaSql;
    if (sqlUsersAvailable) return null;
  } catch {
    sqlUsersAvailable = false;
  }

  try {
    const viaSb = await sbFindById(id);
    if (viaSb) return viaSb;
    if (supabaseUsersAvailable) return null;
  } catch {
    /* fall through */
  }

  return memFindById(id);
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  displayName: string;
}): Promise<PublicUser> {
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim() || email.split("@")[0] || "User";
  if (!email || !email.includes("@")) {
    throw new Error("Valid email is required");
  }
  if (!input.passwordHash) throw new Error("Password hash is required");

  const existing = await findUserByEmail(email);
  if (existing) throw new Error("Email already registered");

  // Prefer SQL (auto-creates table on local Docker)
  try {
    const created = await sqlCreate({
      email,
      passwordHash: input.passwordHash,
      displayName,
    });
    if (created) return created;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("already")
    ) {
      throw err;
    }
    console.warn("[users] SQL create failed:", err);
  }

  // Supabase REST
  try {
    const created = await sbCreate({
      email,
      passwordHash: input.passwordHash,
      displayName,
    });
    if (created) return created;
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.toLowerCase().includes("already")
    ) {
      throw err;
    }
    console.warn("[users] Supabase create failed:", err);
  }

  // Memory last resort
  return memCreate({
    email,
    passwordHash: input.passwordHash,
    displayName,
  });
}
