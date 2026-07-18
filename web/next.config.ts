import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PDF tooling out of the Turbopack/webpack worker mess
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
