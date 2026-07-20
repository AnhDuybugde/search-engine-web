import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "crypto";

export const APP_SESSION_COOKIE = "app_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;

export type SessionClaims = {
  userId: string;
  exp: number;
  nonce: string;
};

function secretKey(): string {
  return (
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    "dev-insecure-session-secret"
  );
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

/** Multi-user auth is always on unless AUTH_DISABLED=1 (tests/local escape hatch). */
export function isAuthRequired(): boolean {
  if (process.env.AUTH_DISABLED === "1") return false;
  return true;
}

/** @deprecated shared app password — kept only for health diagnostics / optional admin bearer */
export function isAuthGateEnabled(): boolean {
  return Boolean((process.env.APP_PASSWORD || "").trim());
}

export function verifyAppPassword(candidate: string): boolean {
  const expected = (process.env.APP_PASSWORD || "").trim();
  if (!expected) return false;
  return safeEqual(candidate.trim(), expected);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  try {
    const parts = encoded.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4], "hex");
    const expected = Buffer.from(parts[5], "hex");
    if (!Number.isFinite(N) || !salt.length || !expected.length) return false;
    const actual = scryptSync(password, salt, expected.length, { N, r, p });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * User session token: v2.exp.userId.nonce.sig
 * Edge middleware can verify with Web Crypto HMAC.
 */
export function signUserSessionToken(
  userId: string,
  now = Date.now(),
): string {
  if (!userId) throw new Error("userId required");
  const exp = now + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `v2.${exp}.${userId}.${nonce}`;
  const sig = createHmac("sha256", secretKey()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function parseSessionToken(
  token: string | undefined | null,
): SessionClaims | null {
  if (!token) return null;
  const parts = token.split(".");
  // v2.exp.userId.nonce.sig → 5 parts
  if (parts.length === 5 && parts[0] === "v2") {
    const [, expStr, userId, nonce, sig] = parts;
    if (!/^\d+$/.test(expStr) || !userId || !nonce || !sig) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const payload = `v2.${expStr}.${userId}.${nonce}`;
    const expected = createHmac("sha256", secretKey())
      .update(payload)
      .digest("hex");
    if (!safeEqual(sig, expected)) return null;
    return { userId, exp, nonce };
  }

  // Legacy shared-password session: exp.nonce.sig (no user)
  if (parts.length === 3) {
    const [expStr, nonce, sig] = parts;
    if (!/^\d+$/.test(expStr) || !nonce || !sig) return null;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const payload = `${expStr}.${nonce}`;
    const expected = createHmac("sha256", secretKey())
      .update(payload)
      .digest("hex");
    if (!safeEqual(sig, expected)) return null;
    return { userId: "legacy", exp, nonce };
  }

  return null;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  return Boolean(parseSessionToken(token));
}

/** @deprecated use signUserSessionToken */
export function signSessionToken(now = Date.now()): string {
  return signUserSessionToken("legacy", now);
}

function parseCookieHeader(header: string | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function getSessionTokenFromRequest(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.get("cookie"));
  return cookies[APP_SESSION_COOKIE] || null;
}

export function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || null;
}

export function getSessionClaimsFromRequest(req: Request): SessionClaims | null {
  return parseSessionToken(getSessionTokenFromRequest(req));
}

/**
 * Returns null if authorized; otherwise a 401 Response.
 * Accepts user session cookie or optional APP_PASSWORD bearer (admin/health tools).
 */
export function requireAppAuth(req: Request): Response | null {
  if (!isAuthRequired()) return null;

  const bearer = getBearerToken(req);
  if (bearer && verifyAppPassword(bearer)) return null;

  const claims = getSessionClaimsFromRequest(req);
  if (claims) return null;

  return Response.json(
    { error: "Unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Bearer realm="search-engine"',
        "Cache-Control": "no-store",
      },
    },
  );
}

export function sessionCookieHeader(
  token: string,
  maxAgeSec = SESSION_TTL_MS / 1000,
): string {
  const secure =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";
  const parts = [
    `${APP_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeSec)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookieHeader(): string {
  return `${APP_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
