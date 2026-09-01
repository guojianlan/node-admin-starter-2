import type { NextConfig } from "next";
import { networkInterfaces } from "node:os";

const localIpv4Origins = Object.values(networkInterfaces())
  .flatMap((addresses) => addresses ?? [])
  .filter((address) => address.family === "IPv4" && !address.internal)
  .map((address) => address.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: [...new Set(["127.0.0.1", ...localIpv4Origins])],
  agentRules: false,
  devIndicators: false,
  typedRoutes: false,
};

export default nextConfig;
