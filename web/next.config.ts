import path from "path";
import type { NextConfig } from "next";

/**
 * Vercel monorepo note:
 * The full git repo is cloned to /vercel/path0; Root Directory is usually `web/`.
 * If outputFileTracingRoot stays on `web/` only, relativeAppDir becomes "" and
 * some Vercel/Next steps look for `/vercel/path0/.next/package.json` (ENOENT).
 *
 * Point both roots at the monorepo root so relativeAppDir is `web` and
 * `.next` resolves to `/vercel/path0/web/.next`.
 */
const monorepoRoot = path.join(__dirname, "..");

const nextConfig: NextConfig = {
  // Keep PDF tooling out of the Turbopack/webpack worker mess
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
