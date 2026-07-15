import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export: moot is a pure client-side SPA (all `use client`, no server
  // routes/actions), so `next build` emits a CDN-servable bundle to `out/`.
  // Hosted on Azure Static Web Apps. When SSR lands (roadmap Phase 4), switch
  // the output target and move to Container Apps.
  output: "export",
};

export default nextConfig;
