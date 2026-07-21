import path from "path";
import type { NextConfig } from "next";

// Keep turbopack.root and outputFileTracingRoot identical (Vercel monorepo).
// Other lockfiles in the parent repo can make Next infer a different root.
const projectRoot = path.resolve(process.cwd());

const nextConfig: NextConfig = {
  // Keep PDF tooling out of the Turbopack/webpack worker mess
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  outputFileTracingRoot: projectRoot,
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
