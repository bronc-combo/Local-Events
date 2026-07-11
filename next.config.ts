import type { NextConfig } from "next";

const isStaticExport =
  process.env.DASHBOARD_DATA_MODE === "snapshot" ||
  process.env.ENABLE_STATIC_EXPORT === "true";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "";

const nextConfig: NextConfig = {
  output: isStaticExport ? "export" : undefined,
  images: {
    unoptimized: isStaticExport,
  },
};

if (basePath) {
  nextConfig.basePath = basePath;
  nextConfig.assetPrefix = basePath;
}

export default nextConfig;
