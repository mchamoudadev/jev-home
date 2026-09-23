import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Let Cloudflare quick tunnels (random *.trycloudflare.com hosts) load dev assets and HMR.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
