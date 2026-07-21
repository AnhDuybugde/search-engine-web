import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const APP_SESSION_COOKIE = "app_session";

export async function middleware(req: NextRequest) {
  const authDisabled = process.env.AUTH_DISABLED === "1";
  const { pathname } = req.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/api/health" ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth/")
  ) {
    return NextResponse.next();
  }

  if (authDisabled) {
    return NextResponse.next();
  }

  const bearer = req.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  const appPassword = (process.env.APP_PASSWORD || "").trim();
  if (bearer && appPassword && timingSafeEqualString(bearer, appPassword)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(APP_SESSION_COOKIE)?.value;
  if (token && (await verifySessionTokenEdge(token))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
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

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function verifySessionTokenEdge(token: string): Promise<boolean> {
  const parts = token.split(".");
  const secret =
    process.env.APP_SESSION_SECRET?.trim() ||
    process.env.APP_PASSWORD?.trim() ||
    "dev-insecure-session-secret";

  // Multi-user: v2.exp.userId.nonce.sig
  if (parts.length === 5 && parts[0] === "v2") {
    const [, expStr, userId, nonce, sig] = parts;
    if (!/^\d+$/.test(expStr) || !userId || !nonce || !sig) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const payload = `v2.${expStr}.${userId}.${nonce}`;
    const expected = await hmacHex(secret, payload);
    return timingSafeEqualString(sig, expected);
  }

  // Legacy shared session: exp.nonce.sig
  if (parts.length === 3) {
    const [expStr, nonce, sig] = parts;
    if (!/^\d+$/.test(expStr) || !nonce || !sig) return false;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return false;
    const payload = `${expStr}.${nonce}`;
    const expected = await hmacHex(secret, payload);
    return timingSafeEqualString(sig, expected);
  }

  return false;
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return bufferToHex(sig);
}

function bufferToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
