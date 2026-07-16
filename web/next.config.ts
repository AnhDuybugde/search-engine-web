import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep PDF tooling out of the Turbopack/webpack worker mess
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
};

export default nextConfig;
