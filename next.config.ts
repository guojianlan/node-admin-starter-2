import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  agentRules: false,
  devIndicators: false,
  typedRoutes: false,
};

export default nextConfig;
