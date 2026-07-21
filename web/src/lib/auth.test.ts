import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  hashPassword,
  parseSessionToken,
  requireAppAuth,
  signUserSessionToken,
  verifyPassword,
  verifySessionToken,
  APP_SESSION_COOKIE,
} from "./auth";
import { createUser, findUserByEmail } from "./db/users-repo";
import { memUsers } from "./db/memory";

describe("password hashing", () => {
  it("hashes and verifies passwords with scrypt", () => {
    const hash = hashPassword("correct-horse-battery");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("correct-horse-battery", hash)).toBe(true);
    expect(verifyPassword("wrong-password", hash)).toBe(false);
  });
});

describe("user session tokens", () => {
  it("signs and verifies multi-user tokens with userId claims", () => {
    const token = signUserSessionToken("user-abc-123");
    expect(verifySessionToken(token)).toBe(true);
    const claims = parseSessionToken(token);
    expect(claims?.userId).toBe("user-abc-123");
    expect(claims?.exp).toBeGreaterThan(Date.now());
    expect(verifySessionToken("bad.token.here")).toBe(false);
    expect(verifySessionToken(token.slice(0, -2) + "00")).toBe(false);
  });
});

describe("users-repo register + login path (memory)", () => {
  beforeEach(() => {
    memUsers.clear();
  });

  it("creates a user and finds by email", async () => {
    const created = await createUser({
      email: "Demo@Example.com",
      passwordHash: hashPassword("password123"),
      displayName: "Demo",
    });
    expect(created.email).toBe("demo@example.com");
    const found = await findUserByEmail("demo@example.com");
    expect(found?.id).toBe(created.id);
    expect(found?.displayName).toBe("Demo");
    expect(verifyPassword("password123", found!.passwordHash)).toBe(true);
  });

  it("rejects duplicate email", async () => {
    await createUser({
      email: "a@b.com",
      passwordHash: hashPassword("password123"),
      displayName: "A",
    });
    await expect(
      createUser({
        email: "a@b.com",
        passwordHash: hashPassword("password123"),
        displayName: "B",
      }),
    ).rejects.toThrow(/already/i);
  });
});

describe("requireAppAuth with user session cookie", () => {
  const prevAuthDisabled = process.env.AUTH_DISABLED;

  beforeEach(() => {
    delete process.env.AUTH_DISABLED;
  });

  afterEach(() => {
    if (prevAuthDisabled === undefined) delete process.env.AUTH_DISABLED;
    else process.env.AUTH_DISABLED = prevAuthDisabled;
  });

  it("rejects missing credentials", () => {
    const res = requireAppAuth(
      new Request("http://localhost/api/search/sessions", { method: "GET" }),
    );
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  it("accepts user session cookie", () => {
    const token = signUserSessionToken("user-1");
    const res = requireAppAuth(
      new Request("http://localhost/api/search/sessions", {
        method: "GET",
        headers: {
          cookie: `${APP_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
      }),
    );
    expect(res).toBeNull();
  });

  it("does not leak secrets in 401 body", async () => {
    const res = requireAppAuth(new Request("http://localhost/api/x"));
    const body = await res!.json();
    expect(body.error).toBe("Unauthorized");
  });
});
