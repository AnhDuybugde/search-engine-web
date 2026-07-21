import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep the dev-only Next.js indicator from competing with the app account UI.
  devIndicators: false,
  // Keep PDF tooling out of the Turbopack/webpack worker mess
  serverExternalPackages: ["unpdf", "pdfjs-dist"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
