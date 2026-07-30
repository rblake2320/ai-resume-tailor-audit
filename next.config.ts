import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf"],
  // A stray lockfile higher up the tree can make Next mis-infer the workspace
  // root; this repo is always its own root.
  outputFileTracingRoot: import.meta.dirname,
};

export default nextConfig;
