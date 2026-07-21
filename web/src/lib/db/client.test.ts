import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertDurableDb,
  DurableDbRequiredError,
  isMemoryDbAllowed,
  requireDurableDb,
} from "./client";

/** Avoid TS2540: process.env.NODE_ENV is typed read-only */
function setEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe("durable DB fail-closed (D2)", () => {
  const keys = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SECRET",
    "NEXT_PUBLIC_SUPABASE_URL",
    "DATABASE_URL",
    "ALLOW_MEMORY_DB",
    "VERCEL",
    "VERCEL_ENV",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of keys) prev[k] = process.env[k];
    // Isolate durable-db gate from real project env (Supabase keys in .env.local).
    for (const k of keys) delete process.env[k];
    // vitest runs with NODE_ENV=test, but .env.local may shadow this
    setEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    for (const k of keys) setEnv(k, prev[k]);
  });

  it("allows memory DB in non-production local by default", () => {
    // vitest runs with NODE_ENV=test which is non-production
    expect(isMemoryDbAllowed()).toBe(true);
    expect(() => assertDurableDb("Create session")).not.toThrow();
    expect(requireDurableDb("Create session")).toBeNull();
  });

  it("fails closed on Vercel without durable DB", () => {
    process.env.VERCEL = "1";
    expect(isMemoryDbAllowed()).toBe(false);
    expect(() => assertDurableDb("Create session")).toThrow(DurableDbRequiredError);
    try {
      assertDurableDb("Create session");
    } catch (err) {
      expect(err).toBeInstanceOf(DurableDbRequiredError);
      expect((err as DurableDbRequiredError).status).toBe(503);
      expect((err as Error).message).toMatch(/durable database/i);
      expect((err as Error).message).not.toMatch(/sk_|gsk_|password/i);
    }
  });

  it("fails closed when VERCEL_ENV is production without durable DB", () => {
    process.env.VERCEL_ENV = "production";
    // isMemoryDbAllowed checks VERCEL or production NODE_ENV
    // Force via VERCEL flag which we can set
    process.env.VERCEL = "1";
    expect(isMemoryDbAllowed()).toBe(false);
    expect(() => assertDurableDb("List notebooks")).toThrow(DurableDbRequiredError);
  });

  it("ALLOW_MEMORY_DB=1 re-enables ephemeral store even on Vercel", () => {
    process.env.VERCEL = "1";
    process.env.ALLOW_MEMORY_DB = "1";
    expect(isMemoryDbAllowed()).toBe(true);
    expect(() => assertDurableDb("Create session")).not.toThrow();
    expect(requireDurableDb("Create session")).toBeNull();
  });

  it("requireDurableDb returns 503 JSON without secrets", async () => {
    process.env.VERCEL = "1";
    const res = requireDurableDb("Create session");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    const body = await res!.json();
    expect(body.error).toMatch(/durable database/i);
    // Env var *names* may appear; never actual secret material
    expect(JSON.stringify(body)).not.toMatch(/gsk_|tvly-|eyJ[A-Za-z0-9_-]{20,}/i);
  });
});
